import { NextRequest, NextResponse } from "next/server";
import {
  UPLOAD_LIMITS,
  UploadError,
  ingestUserDocument,
  listUserDocuments,
} from "@/lib/rag/user-docs";
import { SUPPORTED_LABEL, UnsupportedFileError, isSupportedFile } from "@/lib/rag/parsers";
import { checkUploadRateLimit } from "@/lib/rate-limit";
import { isValidSessionId } from "@/lib/session";
import { UpstreamError, logUpstream, toUpstreamError } from "@/lib/errors";

// The PDF and DOCX readers need Node APIs, and embedding a long document takes
// longer than the default function budget allows.
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/documents?sessionId=… — the session's own uploads. */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "";

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "A valid sessionId is required." }, { status: 400 });
  }

  try {
    const documents = await listUserDocuments(sessionId);
    return NextResponse.json({
      documents,
      limits: {
        maxDocs: UPLOAD_LIMITS.maxDocsPerSession,
        maxFileMb: UPLOAD_LIMITS.maxFileBytes / 1024 / 1024,
        retentionDays: UPLOAD_LIMITS.retentionDays,
      },
    });
  } catch (error) {
    console.error("[Documents API] Failed to list documents:", error);
    return NextResponse.json({ error: "Could not load your documents." }, { status: 500 });
  }
}

/** POST /api/documents — multipart upload of one file for a session. */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Upload must be sent as multipart/form-data." },
      { status: 400 }
    );
  }

  const sessionId = String(form.get("sessionId") || "");
  const file = form.get("file");

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: "A valid sessionId is required." }, { status: 400 });
  }

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  }

  if (!isSupportedFile(file.name)) {
    return NextResponse.json(
      { error: `"${file.name}" isn't a supported format. Upload a ${SUPPORTED_LABEL} file.` },
      { status: 415 }
    );
  }

  if (file.size > UPLOAD_LIMITS.maxFileBytes) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
          UPLOAD_LIMITS.maxFileBytes / 1024 / 1024
        } MB.`,
      },
      { status: 413 }
    );
  }

  const rl = checkUploadRateLimit(sessionId);
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.resetMs / 1000);
    return NextResponse.json(
      {
        error: `That's a lot of uploads at once. Please wait ${retryAfter} seconds and try again.`,
        retryAfterMs: rl.resetMs,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const document = await ingestUserDocument({ sessionId, filename: file.name, buffer });

    return NextResponse.json({
      success: true,
      document,
      message: `"${document.title}" is ready — ${document.chunkCount} searchable section${
        document.chunkCount === 1 ? "" : "s"
      }.`,
    });
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof UnsupportedFileError) {
      return NextResponse.json({ error: error.message }, { status: 415 });
    }

    // Embedding runs against Gemini, so quota and outage failures land here.
    const upstream = error instanceof UpstreamError ? error : maybeUpstream(error);
    if (upstream) {
      logUpstream("Documents API] Embedding upload", upstream);
      return NextResponse.json({ error: upstream.publicMessage }, { status: upstream.status });
    }

    console.error("[Documents API] Upload failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "That file could not be processed. Please try a different one.",
      },
      { status: 500 }
    );
  }
}

/** Recognise a provider failure without swallowing ordinary parse errors. */
function maybeUpstream(error: unknown): UpstreamError | null {
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return null;
  if (!/quota|RESOURCE_EXHAUSTED|rate limit|429|API key|PERMISSION_DENIED/i.test(message)) {
    return null;
  }
  return toUpstreamError(error, "embedding");
}
