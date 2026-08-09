import { NextRequest, NextResponse } from "next/server";
import { runFullIngestion } from "@/lib/rag/ingestor";
import { invalidateLocalIndex } from "@/lib/rag/retriever";
import { requireAdmin } from "@/lib/admin-auth";
import { UpstreamError, logUpstream } from "@/lib/errors";

// A full re-embed of every knowledge base chunk.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const report = await runFullIngestion();
    invalidateLocalIndex();

    return NextResponse.json({
      success: true,
      message: `Re-indexed ${report.totalDocs} documents (${report.totalChunks} total section chunks).`,
      report,
    });
  } catch (error) {
    if (error instanceof UpstreamError) {
      logUpstream("Admin Reindex API", error);
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }

    console.error("[Admin Reindex API] Error:", error);
    return NextResponse.json(
      { error: "Failed to re-index knowledge base." },
      { status: 500 }
    );
  }
}
