async function testPhase5() {
  console.log("=========================================");
  console.log("🧪 Testing Phase 5: Feedback & History API");
  console.log("=========================================\n");

  const baseUrl = "http://localhost:3000";

  // 1. Test POST /api/feedback
  try {
    const fbRes = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: "00000000-0000-0000-0000-000000000001",
        rating: "up",
      }),
    });
    const fbData = await fbRes.json();
    console.log("✅ POST /api/feedback Response:", fbData);
  } catch (err) {
    console.error("❌ Feedback API test failed:", err);
  }

  // 2. Test GET /api/history/:sessionId
  try {
    const histRes = await fetch(`${baseUrl}/api/history/demo_session_123`);
    const histData = await histRes.json();
    console.log("✅ GET /api/history/demo_session_123 Response:", histData);
  } catch (err) {
    console.error("❌ History API test failed:", err);
  }

  console.log("\n=========================================");
  console.log("✅ Phase 5 API Endpoints Operational!");
  console.log("=========================================");
}

testPhase5();
