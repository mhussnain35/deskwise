import { NextResponse } from "next/server";
import { runFullIngestion } from "@/lib/rag/ingestor";

export async function POST() {
  try {
    const report = await runFullIngestion();
    return NextResponse.json({
      success: true,
      message: `Re-indexed ${report.totalDocs} documents (${report.totalChunks} total section chunks).`,
      report,
    });
  } catch (error: any) {
    console.error("[Admin Reindex API] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to re-index knowledge base" },
      { status: 500 }
    );
  }
}
