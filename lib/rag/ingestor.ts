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
 * Shared Knowledge Base Ingestion Engine
 * Reusable by CLI scripts (scripts/ingest.ts) and Admin API endpoints (/api/admin/reindex).
 */
export async function runFullIngestion(): Promise<IngestionReport> {
  if (!fs.existsSync(KB_DOCS_DIR)) {
    fs.mkdirSync(KB_DOCS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(KB_DOCS_DIR).filter((f) => f.endsWith(".md"));
  const qdrantActive = await ensureCollectionExists();

  let totalChunksIngested = 0;
  const docReports: { filename: string; chunkCount: number }[] = [];

  for (const filename of files) {
    const filePath = path.join(KB_DOCS_DIR, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const chunks: Chunk[] = chunkMarkdown(filename, content);

    let docId = crypto.randomUUID();

    // 1. Database Document Record
    if (db) {
      try {
        const existingDoc = await db
          .select()
          .from(docs)
          .where(eq(docs.title, filename))
          .limit(1);

        if (existingDoc.length > 0) {
          docId = existingDoc[0].id as any;
        } else {
          const [insertedDoc] = await db
            .insert(docs)
            .values({
              id: docId as any,
              title: filename,
              sourceUrl: `/kb-docs/${filename}`,
            })
            .returning();
          docId = insertedDoc.id as any;
        }
      } catch (dbErr) {
        console.warn(`[Ingestor] Neon DB doc insert warning:`, dbErr);
      }
    }

    // 2. Chunk & Embed
    const qdrantPoints = [];

    for (const chunk of chunks) {
      const pointId = crypto.randomUUID();
      const vector = await embedText(chunk.content);

      if (db) {
        try {
          await db.insert(docChunks).values({
            id: crypto.randomUUID() as any,
            docId: docId as any,
            content: chunk.content,
            section: chunk.section,
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
          title: chunk.title,
          section: chunk.section,
          content: chunk.content,
          source_url: `/kb-docs/${filename}`,
        },
      });

      totalChunksIngested++;
    }

    // 3. Upsert to Qdrant Cloud
    if (qdrant && qdrantActive && qdrantPoints.length > 0) {
      try {
        await qdrant.upsert(COLLECTION_NAME, {
          wait: true,
          points: qdrantPoints,
        });
      } catch (qdrantErr) {
        console.error(`[Ingestor] Qdrant upsert error:`, qdrantErr);
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
