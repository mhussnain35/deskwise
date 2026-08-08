import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chunkMarkdown, Chunk } from "./chunker";
import { embedText } from "../ai/embeddings";
import { qdrant, ensureCollectionExists, COLLECTION_NAME } from "../qdrant/client";
import { db } from "../db";
import { docs, docChunks } from "../db/schema";
import { eq } from "drizzle-orm";

const KB_DOCS_DIR = path.join(process.cwd(), "kb-docs");

export interface IngestionReport {
  success: boolean;
  totalDocs: number;
  totalChunks: number;
  documents: { filename: string; chunkCount: number }[];
}

/**
 * Deterministic point id for a chunk, so re-indexing overwrites the existing
 * Qdrant point instead of inserting a new random one and orphaning the old.
 * Formatted as a UUID because Qdrant only accepts UUIDs or unsigned integers.
 */
function chunkPointId(filename: string, index: number): string {
  const hex = crypto.createHash("md5").update(`${filename}#${index}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Stable doc id derived from the filename, used when Postgres is unavailable. */
function fallbackDocId(filename: string): string {
  return chunkPointId(filename, -1);
}

/**
 * Remove points written before chunk ids became deterministic.
 *
 * Every earlier re-index minted fresh random point ids and never deleted the
 * previous generation, so the collection accumulated a full duplicate set of
 * stale vectors on each run — all of them still returned by search. Legacy
 * points are identifiable by the absence of the `filename` payload key, which
 * only the current writer sets.
 */
async function pruneLegacyPoints(qdrantActive: boolean): Promise<void> {
  if (!qdrant || !qdrantActive) return;

  try {
    await qdrant.delete(COLLECTION_NAME, {
      wait: true,
      filter: { must: [{ is_empty: { key: "filename" } }] },
    });
  } catch (err) {
    console.warn("[Ingestor] Legacy point prune skipped:", err);
  }
}

/**
 * Shared Knowledge Base Ingestion Engine
 * Reusable by CLI scripts (scripts/ingest.ts) and Admin API endpoints (/api/admin/reindex).
 */
export async function runFullIngestion(): Promise<IngestionReport> {
  if (!fs.existsSync(KB_DOCS_DIR)) {
    fs.mkdirSync(KB_DOCS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(KB_DOCS_DIR).filter((f) => f.endsWith(".md"));
  const qdrantActive = await ensureCollectionExists();

  await pruneLegacyPoints(qdrantActive);

  let totalChunksIngested = 0;
  const docReports: { filename: string; chunkCount: number }[] = [];

  for (const filename of files) {
    const filePath = path.join(KB_DOCS_DIR, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const chunks: Chunk[] = chunkMarkdown(filename, content);

    let docId = fallbackDocId(filename);

    // 1. Embed everything for this document up front.
    //
    // Indexing replaces a document's existing chunks, so embedding has to
    // succeed before anything is deleted. Embedding inline with the writes
    // meant a mid-loop quota failure left the document with its old chunks
    // already dropped and only some of the new ones written.
    const embedded: { chunk: Chunk; pointId: string; vector: number[] }[] = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      embedded.push({
        chunk: chunks[idx],
        pointId: chunkPointId(filename, idx),
        vector: await embedText(chunks[idx].content),
      });
    }

    // 2. Database Document Record
    if (db) {
      try {
        const existingDoc = await db
          .select()
          .from(docs)
          .where(eq(docs.title, filename))
          .limit(1);

        if (existingDoc.length > 0) {
          docId = existingDoc[0].id;
          await db
            .update(docs)
            .set({ scope: "kb", filename, fileType: "md", chunkCount: chunks.length })
            .where(eq(docs.id, docId));
        } else {
          const [insertedDoc] = await db
            .insert(docs)
            .values({
              id: docId,
              title: filename,
              sourceUrl: `/kb-docs/${filename}`,
              scope: "kb",
              filename,
              fileType: "md",
              sizeBytes: Buffer.byteLength(content, "utf-8"),
              chunkCount: chunks.length,
            })
            .returning();
          docId = insertedDoc.id;
        }

        // Re-indexing replaces a document's chunks. Without this delete, every
        // run appended a fresh copy of all 47 chunks and the table grew without
        // bound while /api/history resolved citations against stale rows.
        await db.delete(docChunks).where(eq(docChunks.docId, docId));
      } catch (dbErr) {
        console.warn(`[Ingestor] Neon DB doc insert warning:`, dbErr);
      }
    }

    // 3. Persist chunks
    const qdrantPoints = [];

    for (let idx = 0; idx < embedded.length; idx++) {
      const { chunk, pointId, vector } = embedded[idx];

      if (db) {
        try {
          await db.insert(docChunks).values({
            docId,
            title: chunk.title,
            content: chunk.content,
            section: chunk.section,
            chunkIndex: idx,
            scope: "kb",
            qdrantPointId: pointId,
          });
        } catch (dbErr) {
          console.warn(`[Ingestor] Neon chunk insert warning:`, dbErr);
        }
      }

      qdrantPoints.push({
        id: pointId,
        vector: vector,
        payload: {
          doc_id: docId,
          filename,
          chunk_index: idx,
          title: chunk.title,
          section: chunk.section,
          content: chunk.content,
          source_url: `/kb-docs/${filename}`,
        },
      });

      totalChunksIngested++;
    }

    // 3. Upsert to Qdrant Cloud
    if (qdrant && qdrantActive) {
      // Drop points left over from a previous, longer version of this doc —
      // deterministic ids overwrite chunks 0..n-1 but never clean up beyond n.
      // Kept separate from the upsert so a failed cleanup can't skip indexing.
      try {
        await qdrant.delete(COLLECTION_NAME, {
          wait: true,
          filter: {
            must: [{ key: "filename", match: { value: filename } }],
            must_not: [{ key: "chunk_index", range: { lt: chunks.length } }],
          },
        });
      } catch (pruneErr) {
        console.warn(`[Ingestor] Qdrant prune skipped for ${filename}:`, pruneErr);
      }

      if (qdrantPoints.length > 0) {
        try {
          await qdrant.upsert(COLLECTION_NAME, {
            wait: true,
            points: qdrantPoints,
          });
        } catch (qdrantErr) {
          console.error(`[Ingestor] Qdrant upsert error:`, qdrantErr);
        }
      }
    }

    docReports.push({ filename, chunkCount: chunks.length });
  }

  return {
    success: true,
    totalDocs: files.length,
    totalChunks: totalChunksIngested,
    documents: docReports,
  };
}
