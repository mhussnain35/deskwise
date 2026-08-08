import { NextRequest, NextResponse } from "next/server";
import { UploadError, deleteUserDocument } from "@/lib/rag/user-docs";
import { isValidSessionId } from "@/lib/session";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE /api/documents/:docId?sessionId=… — remove one of your own uploads. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "";

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "A valid sessionId is required." }, { status: 400 });
  }

  if (!UUID_PATTERN.test(docId)) {
    return NextResponse.json({ error: "Unknown document." }, { status: 400 });
  }

  try {
    // The delete is scoped to the session, so a mismatched id is reported as
    // not found rather than confirming that someone else's document exists.
    const removed = await deleteUserDocument(sessionId, docId);
    if (!removed) {
      return NextResponse.json({ error: "Document not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, id: docId });
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("[Documents API] Delete failed:", error);
    return NextResponse.json({ error: "Could not remove that document." }, { status: 500 });
  }
}
