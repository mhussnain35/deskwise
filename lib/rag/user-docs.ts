/**
 * Session-scoped document uploads.
 *
 * End users upload their own files and ask questions about them. Those files
 * are never written to /kb-docs: serverless deployments mount the application
 * read-only, and one visitor's upload must not become part of the company
 * knowledge base every other visitor is answered from.
 *
 * Instead each upload is chunked, embedded, and stored in Postgres with its
 * vector alongside the text, scoped to the uploader's session id. Retrieval for
 * a session reads those rows directly, so an upload is queryable on the very
 * next message with no re-indexing step and no Qdrant collection churn.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { docs, docChunks } from "../db/schema";
import { embedTexts } from "../ai/embeddings";
import { chunkDocument } from "./chunker";
import { parseDocument, extensionOf } from "./parsers";
import { cosineSimilarity, compactVector } from "./vector";

/** Per-session and per-file ceilings that keep the free tiers intact. */
export const UPLOAD_LIMITS = {
  maxDocsPerSession: 5,
  maxFileBytes: 8 * 1024 * 1024, // 8 MB — comfortably fits a long PDF
  maxChunksPerDoc: 40,
  maxTextChars: 200_000,
  /** Uploaded documents are demo data; they're swept after this many days. */
  retentionDays: 7,
} as const;

export class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

export interface UserDocument {
  id: string;
  title: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedAt: string;
}

function requireDb() {
  if (!db) {
    throw new UploadError(
      "Document uploads need a database connection. Set DATABASE_URL to enable them.",
      503
    );
  }
  return db;
}

/** Strip directory components and control characters from a client filename. */
function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() || "document";
  return base.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
}

/** Human title: filename without extension, separators turned into spaces. */
function titleFromFilename(filename: string): string {
  return (
    filename
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || filename
  );
}

export async function countUserDocuments(sessionId: string): Promise<number> {
  const database = requireDb();
  const rows = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(docs)
    .where(and(eq(docs.scope, "user"), eq(docs.sessionId, sessionId)));
  return rows[0]?.count ?? 0;
}

export async function listUserDocuments(sessionId: string): Promise<UserDocument[]> {
  if (!db) return [];

  const rows = await db
    .select()
    .from(docs)
    .where(and(eq(docs.scope, "user"), eq(docs.sessionId, sessionId)))
    .orderBy(desc(docs.uploadedAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    filename: row.filename || row.title,
    fileType: row.fileType || "",
    sizeBytes: row.sizeBytes || 0,
    chunkCount: row.chunkCount,
    uploadedAt: row.uploadedAt.toISOString(),
  }));
}

/** Delete one of the session's own documents. Returns false if it isn't theirs. */
export async function deleteUserDocument(sessionId: string, docId: string): Promise<boolean> {
  const database = requireDb();

  const deleted = await database
    .delete(docs)
    .where(and(eq(docs.id, docId), eq(docs.scope, "user"), eq(docs.sessionId, sessionId)))
    .returning({ id: docs.id });

  return deleted.length > 0;
}

/**
 * Parse, chunk, embed and store an uploaded file for one session.
 * Throws UploadError with a user-facing message for anything the client can fix.
 */
export async function ingestUserDocument(params: {
  sessionId: string;
  filename: string;
  buffer: Buffer;
}): Promise<UserDocument> {
  const database = requireDb();
  const { sessionId, buffer } = params;
  const filename = safeFilename(params.filename);

  if (buffer.byteLength === 0) {
    throw new UploadError("That file is empty.");
  }

  if (buffer.byteLength > UPLOAD_LIMITS.maxFileBytes) {
    throw new UploadError(
      `That file is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${
        UPLOAD_LIMITS.maxFileBytes / 1024 / 1024
      } MB.`,
      413
    );
  }

  const existingCount = await countUserDocuments(sessionId);
  if (existingCount >= UPLOAD_LIMITS.maxDocsPerSession) {
    throw new UploadError(
      `You can keep ${UPLOAD_LIMITS.maxDocsPerSession} documents at a time. Remove one before uploading another.`,
      409
    );
  }

  const parsed = await parseDocument(filename, buffer);
  const text = parsed.text.slice(0, UPLOAD_LIMITS.maxTextChars);

  if (text.trim().length < 40) {
    throw new UploadError(
      "There wasn't enough readable text in that file to answer questions from."
    );
  }

  const title = titleFromFilename(filename);
  const allChunks = chunkDocument({ filename, title, text, segments: parsed.segments });

  if (allChunks.length === 0) {
    throw new UploadError("That file could not be split into searchable sections.");
  }

  // Truncating rather than rejecting keeps a long report usable — the first
  // N sections are indexed and the response reports how many were kept.
  const chunks = allChunks.slice(0, UPLOAD_LIMITS.maxChunksPerDoc);
  const vectors = await embedTexts(chunks.map((chunk) => chunk.content));

  const [inserted] = await database
    .insert(docs)
    .values({
      title,
      filename,
      fileType: extensionOf(filename).replace(".", ""),
      sizeBytes: buffer.byteLength,
      chunkCount: chunks.length,
      scope: "user",
      sessionId,
      sourceUrl: null,
    })
    .returning();

  await database.insert(docChunks).values(
    chunks.map((chunk, index) => ({
      docId: inserted.id,
      title: chunk.title,
      content: chunk.content,
      section: chunk.section,
      chunkIndex: index,
      scope: "user",
      sessionId,
      embedding: compactVector(vectors[index]),
    }))
  );

  void sweepExpiredUploads();

  return {
    id: inserted.id,
    title,
    filename,
    fileType: inserted.fileType || "",
    sizeBytes: buffer.byteLength,
    chunkCount: chunks.length,
    uploadedAt: inserted.uploadedAt.toISOString(),
  };
}

export interface UserChunkMatch {
  id: string;
  docId: string;
  title: string;
  section: string;
  content: string;
  score: number;
}

/**
 * Cosine search across one session's uploaded chunks.
 *
 * A session holds at most 5 documents × 40 chunks, so scoring the whole set in
 * process costs well under a millisecond and avoids putting per-visitor vectors
 * into the shared Qdrant collection, where nothing would ever clean them up.
 */
export async function searchUserChunks(
  sessionId: string,
  queryVector: number[],
  topK: number
): Promise<UserChunkMatch[]> {
  if (!db || !sessionId) return [];

  try {
    const rows = await db
      .select({
        id: docChunks.id,
        docId: docChunks.docId,
        title: docChunks.title,
        section: docChunks.section,
        content: docChunks.content,
        embedding: docChunks.embedding,
      })
      .from(docChunks)
      .where(and(eq(docChunks.scope, "user"), eq(docChunks.sessionId, sessionId)));

    return rows
      .filter((row) => Array.isArray(row.embedding))
      .map((row) => ({
        id: row.id,
        docId: row.docId,
        title: row.title || "Uploaded document",
        section: row.section || "",
        content: row.content,
        score: cosineSimilarity(queryVector, row.embedding as number[]),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  } catch (err) {
    console.warn("[UserDocs] Session chunk search failed:", err);
    return [];
  }
}

/** Best-effort sweep of uploads past the retention window. Never throws. */
async function sweepExpiredUploads(): Promise<void> {
  if (!db) return;
  try {
    await db
      .delete(docs)
      .where(
        and(
          eq(docs.scope, "user"),
          sql`${docs.uploadedAt} < now() - make_interval(days => ${UPLOAD_LIMITS.retentionDays})`
        )
      );
  } catch (err) {
    console.warn("[UserDocs] Retention sweep skipped:", err);
  }
}
