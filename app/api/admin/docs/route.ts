import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { chunkMarkdown } from "@/lib/rag/chunker";
import { runFullIngestion } from "@/lib/rag/ingestor";
import { invalidateLocalIndex } from "@/lib/rag/retriever";
import { requireAdmin } from "@/lib/admin-auth";
import { UpstreamError, logUpstream } from "@/lib/errors";

const KB_DOCS_DIR = path.join(process.cwd(), "kb-docs");

// Upload allowlist — uploaded markdown is fed verbatim into the model's
// grounding context, so both the filename and the payload are constrained.
const MAX_DOC_BYTES = 100 * 1024;
const ALLOWED_EXTENSION = ".md";
const SAFE_FILENAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function GET() {
  try {
    if (!fs.existsSync(KB_DOCS_DIR)) {
      return NextResponse.json({ totalDocs: 0, totalChunks: 0, docs: [] });
    }

    const files = fs.readdirSync(KB_DOCS_DIR).filter((f) => f.endsWith(ALLOWED_EXTENSION));

    const documentList = files.map((filename) => {
      const filePath = path.join(KB_DOCS_DIR, filename);
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf-8");
      const chunks = chunkMarkdown(filename, content);

      return {
        id: filename,
        filename,
        title: chunks[0]?.title || filename,
        sizeBytes: stats.size,
        chunkCount: chunks.length,
        updatedAt: stats.mtime,
      };
    });

    return NextResponse.json({
      totalDocs: documentList.length,
      totalChunks: documentList.reduce((acc, d) => acc + d.chunkCount, 0),
      docs: documentList,
    });
  } catch (error) {
    console.error("[Admin API] Error reading docs:", error);
    return NextResponse.json({ error: "Failed to load documents." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const { filename, title, content } = await req.json();

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Document content is required" }, { status: 400 });
    }

    if (Buffer.byteLength(content, "utf-8") > MAX_DOC_BYTES) {
      return NextResponse.json(
        { error: `Document exceeds the ${MAX_DOC_BYTES / 1024} KB limit.` },
        { status: 413 }
      );
    }

    const slug = String(filename || title || "custom-doc")
      .toLowerCase()
      .replace(/\.md$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64)
      .replace(/-$/, "");

    if (!SAFE_FILENAME.test(slug)) {
      return NextResponse.json(
        { error: "Title must contain at least one letter or number." },
        { status: 400 }
      );
    }

    const safeFilename = slug + ALLOWED_EXTENSION;
    const targetPath = path.join(KB_DOCS_DIR, safeFilename);

    // Defence in depth: the slug regex already excludes separators, but confirm
    // the resolved path never escapes the knowledge base directory.
    if (path.dirname(path.resolve(targetPath)) !== path.resolve(KB_DOCS_DIR)) {
      return NextResponse.json({ error: "Invalid document name." }, { status: 400 });
    }

    try {
      fs.mkdirSync(KB_DOCS_DIR, { recursive: true });
      fs.writeFileSync(targetPath, content, "utf-8");
    } catch (writeErr) {
      const code = (writeErr as NodeJS.ErrnoException).code;
      // Serverless platforms (Vercel included) mount the deployment read-only;
      // only /tmp is writable and it does not persist. Surface that as a clear
      // 503 instead of an opaque 500.
      if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
        console.error("[Admin API] Knowledge base directory is read-only:", writeErr);
        return NextResponse.json(
          {
            error:
              "The knowledge base directory is read-only in this environment. Commit new documents to kb-docs/ and redeploy, or run the admin panel locally.",
          },
          { status: 503 }
        );
      }
      throw writeErr;
    }

    invalidateLocalIndex();

    // Automatically trigger re-indexing
    let report;
    try {
      report = await runFullIngestion();
    } catch (ingestErr) {
      // The markdown is already on disk; only the embedding pass failed. Say so
      // precisely rather than reporting a generic upload failure.
      if (ingestErr instanceof UpstreamError) {
        logUpstream("Admin API] Re-index after upload", ingestErr);
        return NextResponse.json(
          {
            error: `${safeFilename} was saved but could not be indexed: ${ingestErr.publicMessage} Use "Re-index All Docs" to retry.`,
          },
          { status: ingestErr.status }
        );
      }
      throw ingestErr;
    }

    return NextResponse.json({
      success: true,
      filename: safeFilename,
      chunkCount: report.documents.find((d) => d.filename === safeFilename)?.chunkCount || 0,
      message: `Successfully uploaded ${safeFilename} and re-indexed knowledge base (${report.totalChunks} total section chunks).`,
    });
  } catch (error) {
    console.error("[Admin API] Error uploading doc:", error);
    return NextResponse.json({ error: "Failed to upload document." }, { status: 500 });
  }
}
