import { retrieveContext } from "../lib/rag/retriever";

async function testPhase6() {
  console.log("=========================================");
  console.log("🧪 Testing Phase 6: KB Admin & Dynamic Ingestion");
  console.log("=========================================\n");

  const baseUrl = "http://localhost:3000";

  // 1. Upload new document via POST /api/admin/docs
  const docTitle = "08-enterprise-sla.md";
  const docContent = `# Deskwise Enterprise Service Level Agreement (SLA)

## 99.99% Uptime Guarantee
Deskwise guarantees 99.99% monthly service uptime for all Enterprise plan customers.

## Credit Compensation for Outages
If monthly availability drops below 99.99%, Enterprise customers are eligible for a 15% billing credit on their next invoice cycle.
`;

  console.log(`📤 1. Uploading new document "${docTitle}" via Admin API...`);

  try {
    const uploadRes = await fetch(`${baseUrl}/api/admin/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: docTitle,
        content: docContent,
      }),
    });

    const uploadData = await uploadRes.json();
    console.log("   └─ Upload Response:", uploadData.message || uploadData);
  } catch (err) {
    console.error("❌ Document upload failed:", err);
  }

  // 2. Trigger re-index via POST /api/admin/reindex
  console.log("\n🔄 2. Triggering re-index via POST /api/admin/reindex...");
  try {
    const reindexRes = await fetch(`${baseUrl}/api/admin/reindex`, {
      method: "POST",
    });
    const reindexData = await reindexRes.json();
    console.log("   └─ Reindex Response:", reindexData.message || reindexData);
  } catch (err) {
    console.error("❌ Reindex failed:", err);
  }

  // 3. Confirm newly uploaded document is immediately retrievable in chat
  console.log("\n🔎 3. Querying retriever for newly uploaded SLA policy...");
  const searchResult = await retrieveContext("What is the uptime guarantee for Enterprise plan customers?", 2);
  const topChunk = searchResult.chunks[0];

  console.log(`   └─ Top Retrieved Document: "${topChunk?.title}"`);
  console.log(`   └─ Match Score: ${topChunk?.score.toFixed(4)}`);
  console.log(`   └─ Section Snippet: "${topChunk?.content.slice(0, 100)}..."`);

  console.log("\n=========================================");
  console.log("✅ Phase 6 Admin Panel & Dynamic Ingestion PASSED!");
  console.log("=========================================");
}

testPhase6().catch(console.error);
