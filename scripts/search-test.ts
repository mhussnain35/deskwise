import "./load-env";
import { retrieveContext, CONFIDENCE_THRESHOLD } from "../lib/rag/retriever";
import { HYBRID_ALPHA } from "../lib/rag/keyword";

/**
 * CLI retrieval probe.
 *
 *   npx tsx scripts/search-test.ts "how do refunds work?"
 *   npx tsx scripts/search-test.ts "hotel cap in London?" session_abc123
 *
 * Passing a session id also searches the documents uploaded by that session,
 * which is the quickest way to confirm an upload is queryable.
 */
async function main() {
  const query = process.argv[2] || "What is your refund policy for annual plans?";
  const sessionId = process.argv[3];

  console.log("=========================================");
  console.log("🔎 Deskwise hybrid retrieval probe");
  console.log(`❓ Query: "${query}"`);
  if (sessionId) console.log(`👤 Session uploads: ${sessionId}`);
  console.log(`⚖️  Hybrid alpha: ${HYBRID_ALPHA} (dense weight)`);
  console.log("=========================================\n");

  const result = await retrieveContext(query, 5, { sessionId });

  console.log(`🎯 Top dense score: ${result.topScore.toFixed(4)}`);
  console.log(`🛡️  Confidence threshold: ${CONFIDENCE_THRESHOLD}`);
  console.log(
    `✅ Confidence passed: ${result.confidencePassed ? "YES" : "NO (fallback triggered)"}`
  );
  console.log(`📎 Used session uploads: ${result.usedUserDocs ? "YES" : "no"}\n`);

  console.log(`📚 Top ${result.chunks.length} chunks (ranked by hybrid score):\n`);
  result.chunks.forEach((chunk, index) => {
    console.log(
      `--- [${index + 1}] hybrid ${chunk.hybridScore.toFixed(4)} ` +
        `(dense ${chunk.score.toFixed(4)} · keyword ${chunk.keywordScore.toFixed(4)}) ` +
        `[${chunk.scope === "user" ? "USER UPLOAD" : "knowledge base"}] ---`
    );
    console.log(`📄 Document: ${chunk.title}`);
    console.log(`📌 Section:  ${chunk.section}`);
    console.log(`💬 Snippet:  ${chunk.content.slice(0, 150).replace(/\n/g, " ")}…\n`);
  });

  console.log("=========================================");
}

main().catch(console.error);
