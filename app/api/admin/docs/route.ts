import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { chunkMarkdown } from "@/lib/rag/chunker";
import { runFullIngestion } from "@/lib/rag/ingestor";

const KB_DOCS_DIR = path.join(process.cwd(), "kb-docs");

export async function GET() {
  try {
    if (!fs.existsSync(KB_DOCS_DIR)) {
      return NextResponse.json({ docs: [] });
    }

    const files = fs.readdirSync(KB_DOCS_DIR).filter((f) => f.endsWith(".md"));

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
  } catch (error: any) {
    console.error("[Admin API] Error reading docs:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load documents" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { filename, title, content } = await req.json();

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Document content is required" }, { status: 400 });
    }

    const safeFilename = (filename || title || "custom-doc")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") + ".md";

    if (!fs.existsSync(KB_DOCS_DIR)) {
      fs.mkdirSync(KB_DOCS_DIR, { recursive: true });
    }

    const targetPath = path.join(KB_DOCS_DIR, safeFilename);
    fs.writeFileSync(targetPath, content, "utf-8");

    // Automatically trigger re-indexing
    const report = await runFullIngestion();

    return NextResponse.json({
      success: true,
      filename: safeFilename,
      chunkCount: report.documents.find((d) => d.filename === safeFilename)?.chunkCount || 0,
      message: `Successfully uploaded ${safeFilename} and re-indexed knowledge base (${report.totalChunks} total section chunks).`,
    });
  } catch (error: any) {
    console.error("[Admin API] Error uploading doc:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to upload document" },
      { status: 500 }
    );
  }
}
