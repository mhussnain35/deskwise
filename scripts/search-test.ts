import { retrieveContext, CONFIDENCE_THRESHOLD } from "../lib/rag/retriever";

async function main() {
  const query = process.argv[2] || "What is your refund policy for annual plans?";

  console.log("=========================================");
  console.log(`🔎 Testing Deskwise RAG Retriever Engine`);
  console.log(`❓ User Query: "${query}"`);
  console.log("=========================================\n");

  const result = await retrieveContext(query, 3);

  console.log(`🎯 Top Score: ${result.topScore.toFixed(4)}`);
  console.log(`🛡️ Confidence Threshold: ${CONFIDENCE_THRESHOLD}`);
  console.log(`✅ Confidence Check Passed: ${result.confidencePassed ? "YES" : "NO (Fallback Triggered)"}\n`);

  console.log(`📚 Top ${result.chunks.length} Retrieved Chunks:\n`);
  result.chunks.forEach((chunk, index) => {
    console.log(`--- [Chunk ${index + 1}] Score: ${chunk.score.toFixed(4)} ---`);
    console.log(`📄 Document: ${chunk.title}`);
    console.log(`📌 Section:  ${chunk.section}`);
    console.log(`💬 Snippet:  ${chunk.content.slice(0, 150).replace(/\n/g, " ")}...\n`);
  });

  console.log("=========================================");
}

main().catch(console.error);
