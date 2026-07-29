import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chunkMarkdown, Chunk } from "../lib/rag/chunker";
import { embedText } from "../lib/ai/embeddings";
import { qdrant, ensureCollectionExists, COLLECTION_NAME } from "../lib/qdrant/client";
import { db } from "../lib/db";
import { docs, docChunks } from "../lib/db/schema";
import { eq } from "drizzle-orm";

const KB_DOCS_DIR = path.join(process.cwd(), "kb-docs");

async function runIngestion() {
  console.log("=========================================");
  console.log("🚀 Starting Deskwise Knowledge Base Ingestion");
  console.log("=========================================\n");

  if (!fs.existsSync(KB_DOCS_DIR)) {
    console.error(`❌ Directory not found: ${KB_DOCS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(KB_DOCS_DIR).filter((f) => f.endsWith(".md"));
  console.log(`📁 Found ${files.length} Markdown documents in /kb-docs\n`);

  // Ensure Qdrant collection exists if client configured
  const qdrantActive = await ensureCollectionExists();

  let totalChunksIngested = 0;

  for (const filename of files) {
    const filePath = path.join(KB_DOCS_DIR, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    console.log(`📄 Processing document: ${filename}`);

    const chunks: Chunk[] = chunkMarkdown(filename, content);
    console.log(`   └─ Split into ${chunks.length} semantic section chunks.`);

    let docId = crypto.randomUUID();

    // 1. Insert Document metadata into Neon DB (if available)
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
        console.warn(`   ⚠️ Neon DB warning:`, dbErr);
      }
    }

    // 2. Process & Embed each chunk
    const qdrantPoints = [];

    for (const chunk of chunks) {
      const pointId = crypto.randomUUID();
      const vector = await embedText(chunk.content);

      // Insert chunk to Neon DB
      if (db) {
        try {
          await db.insert(docChunks).values({
            id: crypto.randomUUID(),
            docId: docId,
            content: chunk.content,
            section: chunk.section,
            qdrantPointId: pointId,
          });
        } catch (dbErr) {
          console.warn(`   ⚠️ Neon chunk insert warning:`, dbErr);
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

    // 3. Upsert points into Qdrant Cloud
    if (qdrant && qdrantActive && qdrantPoints.length > 0) {
      try {
        await qdrant.upsert(COLLECTION_NAME, {
          wait: true,
          points: qdrantPoints,
        });
        console.log(`   └─ Successfully upserted ${qdrantPoints.length} vectors to Qdrant Cloud.\n`);
      } catch (qdrantErr) {
        console.error(`   ❌ Qdrant upsert error:`, qdrantErr);
      }
    } else {
      console.log(`   └─ Prepared ${qdrantPoints.length} chunk points (Qdrant Cloud unconfigured or offline).\n`);
    }
  }

  console.log("=========================================");
  console.log(`✅ Ingestion completed! Total chunks: ${totalChunksIngested}`);
  console.log("=========================================");
}

runIngestion().catch((err) => {
  console.error("Fatal ingestion error:", err);
  process.exit(1);
});
