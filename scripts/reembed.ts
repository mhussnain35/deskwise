import "./load-env";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { docChunks } from "../lib/db/schema";
import { embedTexts, EMBEDDING_MODEL, VECTOR_DIMENSION } from "../lib/ai/embeddings";
import { compactVector } from "../lib/rag/vector";
import { isMockMode } from "../lib/ai/provider";

/**
 * Re-embed documents that users uploaded, using the currently configured model.
 *
 *   npx tsx scripts/reembed.ts
 *
 * Why this exists: a vector is only comparable to vectors from the same model.
 * Change the embedding model and every stored vector silently becomes noise —
 * similarity collapses, every query falls under the confidence threshold, and
 * the agent starts refusing questions about documents the user can plainly see
 * in the sidebar. `scripts/ingest.ts` re-embeds the knowledge base from the
 * markdown on disk; this does the same for user uploads, whose only remaining
 * copy is the chunk text in Postgres.
 */
async function main() {
  console.log("=".repeat(58));
  console.log("♻️  Re-embedding user-uploaded documents");
  console.log(`   Model     : ${EMBEDDING_MODEL}`);
  console.log(`   Dimension : ${VECTOR_DIMENSION}`);
  console.log("=".repeat(58));

  if (!db) {
    console.error("❌ DATABASE_URL is not configured.");
    process.exit(1);
  }

  if (isMockMode()) {
    console.error("❌ No OPENROUTER_API_KEY — this would write mock vectors.");
    process.exit(1);
  }

  const rows = await db
    .select({ id: docChunks.id, content: docChunks.content })
    .from(docChunks)
    .where(and(eq(docChunks.scope, "user")));

  if (rows.length === 0) {
    console.log("\nNothing to do — no user-uploaded chunks are stored.");
    return;
  }

  console.log(`\nFound ${rows.length} chunk(s). Embedding…`);

  const vectors = await embedTexts(rows.map((row) => row.content));

  // Written one row at a time: the neon-http driver has no transaction here,
  // and a partial update leaves those rows re-embedded rather than corrupted.
  let updated = 0;
  for (let index = 0; index < rows.length; index++) {
    await db
      .update(docChunks)
      .set({ embedding: compactVector(vectors[index]) })
      .where(eq(docChunks.id, rows[index].id));
    updated++;
    if (updated % 10 === 0) console.log(`   …${updated}/${rows.length}`);
  }

  console.log(`\n✅ Re-embedded ${updated} chunk(s) with ${EMBEDDING_MODEL}.`);
  console.log("=".repeat(58));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
