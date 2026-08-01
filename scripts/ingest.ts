import "./load-env";
import { runFullIngestion } from "../lib/rag/ingestor";

async function main() {
  console.log("=========================================");
  console.log("🚀 Starting Deskwise Knowledge Base Ingestion");
  console.log("=========================================\n");

  const report = await runFullIngestion();

  console.log("=========================================");
  console.log(`✅ Ingestion completed!`);
  console.log(`📄 Total Documents: ${report.totalDocs}`);
  console.log(`🧩 Total Chunks: ${report.totalChunks}`);
  console.log("=========================================");
}

main().catch((err) => {
  console.error("Fatal ingestion error:", err);
  process.exit(1);
});
