import "./load-env";
import { embeddingDimension, generationModel, embeddingModel, isMockMode } from "../lib/ai/provider";
import { embedText } from "../lib/ai/embeddings";
import { streamAnswer } from "../lib/ai/llm";
import { cosineSimilarity } from "../lib/rag/vector";

/**
 * End-to-end check of whichever AI provider is configured.
 *
 *   npx tsx scripts/provider-check.ts
 *
 * Run this after changing provider, key, model or dimension — it exercises the
 * three things that must hold for retrieval to work, and reports the actual
 * vector width so EMBEDDING_DIMENSION can be set correctly before any indexing
 * happens.
 */
async function main() {
  console.log("=".repeat(60));
  console.log("🔌 Deskwise provider check (OpenRouter)");
  console.log(`   Chat model      : ${generationModel()}`);
  console.log(`   Embedding model : ${embeddingModel()}`);
  console.log(`   Dimension       : ${embeddingDimension()} (must match Qdrant)`);
  console.log("=".repeat(60));

  if (isMockMode()) {
    console.error("\n❌ No API key found. Set OPENROUTER_API_KEY in .env.local.");
    process.exit(1);
  }

  let failures = 0;

  // 1. Embeddings ----------------------------------------------------------
  console.log("\n1️⃣  Embeddings");
  let vector: number[] | null = null;
  try {
    vector = await embedText("How do I upgrade my subscription plan?");
    console.log(`   ✅ Returned ${vector.length} dimensions`);
  } catch (err) {
    failures++;
    console.error(`   ❌ ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Semantic sanity -----------------------------------------------------
  // A model that returns vectors of the right width can still be wired up
  // wrongly. Related text must score higher than unrelated text, or retrieval
  // is meaningless no matter what the dimensions say.
  if (vector) {
    console.log("\n2️⃣  Semantic sanity");
    try {
      const related = await embedText("What is the process for changing my plan tier?");
      const unrelated = await embedText("The migration patterns of Arctic terns");

      const relatedScore = cosineSimilarity(vector, related);
      const unrelatedScore = cosineSimilarity(vector, unrelated);

      console.log(`   Related  : ${relatedScore.toFixed(4)}`);
      console.log(`   Unrelated: ${unrelatedScore.toFixed(4)}`);

      if (relatedScore > unrelatedScore + 0.05) {
        console.log("   ✅ Related text scores meaningfully higher");
      } else {
        failures++;
        console.error("   ❌ Scores are too close — this model is not discriminating");
      }
    } catch (err) {
      failures++;
      console.error(`   ❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Streaming generation ------------------------------------------------
  console.log("\n3️⃣  Streaming generation");
  try {
    const stream = await streamAnswer({
      system: "You are a terse assistant. Reply with three words at most.",
      turns: [{ role: "user", content: "Say hello." }],
    });

    let answer = "";
    let chunks = 0;
    for await (const delta of stream) {
      answer += delta;
      chunks++;
    }

    if (answer.trim()) {
      console.log(`   ✅ Streamed ${chunks} chunk(s): "${answer.trim().slice(0, 60)}"`);
    } else {
      failures++;
      console.error("   ❌ Stream produced no text");
    }
  } catch (err) {
    failures++;
    console.error(`   ❌ ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\n" + "=".repeat(60));
  if (failures === 0) {
    console.log("✅ Provider is ready.");
    console.log('   Next: re-index with "npx tsx scripts/ingest.ts" if you changed');
    console.log("   the embedding model or dimension.");
  } else {
    console.error(`❌ ${failures} check(s) failed — see the messages above.`);
  }
  console.log("=".repeat(60));

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
