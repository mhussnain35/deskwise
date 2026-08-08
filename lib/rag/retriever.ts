import fs from "fs";
import path from "path";
import { and, desc, eq, sql } from "drizzle-orm";
import { embedText } from "../ai/embeddings";
import { qdrant, COLLECTION_NAME } from "../qdrant/client";
import { db } from "../db";
import { docChunks } from "../db/schema";
import { chunkMarkdown } from "./chunker";
import { HYBRID_ALPHA, fuseScores, scoreKeywordRelevance, tokenize } from "./keyword";
import { searchUserChunks } from "./user-docs";
import { cosineSimilarity } from "./vector";

export interface RetrievedChunk {
  id: string;
  docId: string;
  title: string;
  section: string;
  content: string;
  sourceUrl: string;
  /** Dense cosine similarity — what the confidence guardrail is measured on. */
  score: number;
  /** Normalised BM25 score over the candidate pool. */
  keywordScore: number;
  /** alpha·dense + (1-alpha)·keyword — the ranking score. */
  hybridScore: number;
  /** 'kb' for company documentation, 'user' for the visitor's own upload. */
  scope: "kb" | "user";
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  topScore: number;
  confidencePassed: boolean;
  /** True when at least one of the returned chunks came from a user upload. */
  usedUserDocs: boolean;
}

export interface RetrieveOptions {
  /** Session whose uploaded documents should be searched alongside the KB. */
  sessionId?: string;
}

// Confidence score threshold: queries scoring below this skip LLM and return human escalation fallback
export const CONFIDENCE_THRESHOLD = 0.55;

const KB_DOCS_DIR = path.join(process.cwd(), "kb-docs");

/** How many candidates each arm contributes before fusion. */
const DENSE_CANDIDATES = 15;
const SPARSE_CANDIDATES = 10;

/**
 * Hybrid retrieval over the company knowledge base plus the session's own
 * uploaded documents.
 *
 * Two arms feed one candidate pool:
 *   dense  — vector search (Qdrant, or an in-process cosine index as fallback)
 *   sparse — Postgres full-text search, which catches the exact tokens
 *            embeddings are weakest on: plan names, error codes, invoice ids
 *
 * Candidates are then rescored with BM25 across the pool and blended by
 * HYBRID_ALPHA. The dense cosine score is preserved separately because the
 * confidence guardrail and the match percentages in the UI are both calibrated
 * against it.
 */
export async function retrieveContext(
  query: string,
  topK: number = 5,
  options: RetrieveOptions = {}
): Promise<RetrievalResult> {
  const queryVector = await embedText(query);

  const pool = new Map<string, RetrievedChunk>();
  const add = (chunk: RetrievedChunk) => {
    const existing = pool.get(chunk.id);
    if (!existing || chunk.score > existing.score) pool.set(chunk.id, chunk);
  };

  // --- Dense arm ----------------------------------------------------------
  let denseHits = await qdrantSearch(queryVector, DENSE_CANDIDATES);
  const qdrantUsed = denseHits.length > 0;

  if (!qdrantUsed) {
    denseHits = await localCosineSearch(queryVector, DENSE_CANDIDATES);
  }
  denseHits.forEach(add);

  // --- Sparse arm ---------------------------------------------------------
  // Only meaningful against Qdrant results: the local fallback already scores
  // every chunk in the knowledge base, so nothing can be missing from the pool.
  if (qdrantUsed) {
    const sparseHits = await postgresKeywordSearch(query, SPARSE_CANDIDATES);
    const missing = sparseHits.filter((hit) => !pool.has(hit.id));
    const scored = await attachDenseScores(missing, queryVector);
    scored.forEach(add);
  }

  // --- Session uploads ----------------------------------------------------
  if (options.sessionId) {
    const userHits = await searchUserChunks(options.sessionId, queryVector, topK);
    for (const hit of userHits) {
      add({
        id: hit.id,
        docId: hit.docId,
        title: hit.title,
        section: hit.section,
        content: hit.content,
        sourceUrl: "",
        score: hit.score,
        keywordScore: 0,
        hybridScore: hit.score,
        scope: "user",
      });
    }
  }

  // --- Fusion -------------------------------------------------------------
  const candidates = Array.from(pool.values());
  const keywordScores = scoreKeywordRelevance(query, candidates);

  const ranked = candidates
    .map((candidate, index) => ({
      ...candidate,
      keywordScore: keywordScores[index],
      hybridScore: fuseScores(candidate.score, keywordScores[index], HYBRID_ALPHA),
    }))
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, topK);

  // The guardrail stays on dense similarity. Keyword overlap alone is a weak
  // signal of "we actually know this" — an out-of-scope question that happens
  // to share a word with a policy would otherwise sail past the threshold.
  const topScore = ranked.reduce((max, chunk) => Math.max(max, chunk.score), 0);

  return {
    query,
    chunks: ranked,
    topScore,
    confidencePassed: topScore >= CONFIDENCE_THRESHOLD,
    usedUserDocs: ranked.some((chunk) => chunk.scope === "user"),
  };
}

async function qdrantSearch(queryVector: number[], limit: number): Promise<RetrievedChunk[]> {
  if (!qdrant) return [];

  try {
    const results = await qdrant.search(COLLECTION_NAME, {
      vector: queryVector,
      limit,
      with_payload: true,
    });

    return results.map((item) => ({
      id: String(item.id),
      docId: String(item.payload?.doc_id || ""),
      title: String(item.payload?.title || "Knowledge Base Document"),
      section: String(item.payload?.section || ""),
      content: String(item.payload?.content || ""),
      sourceUrl: String(item.payload?.source_url || ""),
      score: item.score,
      keywordScore: 0,
      hybridScore: item.score,
      scope: "kb" as const,
    }));
  } catch (err) {
    console.warn("[Retriever] Qdrant search error, falling back to local index:", err);
    return [];
  }
}

/**
 * Postgres full-text search over the indexed knowledge base chunks.
 *
 * Terms are OR-ed rather than AND-ed (which is what plainto_tsquery and
 * websearch_to_tsquery both do) because a natural-language support question
 * carries far more words than any single policy section contains — an AND query
 * matches nothing on all but the shortest inputs.
 */
async function postgresKeywordSearch(
  query: string,
  limit: number
): Promise<Omit<RetrievedChunk, "score" | "hybridScore">[]> {
  if (!db) return [];

  const terms = Array.from(new Set(tokenize(query))).slice(0, 12);
  if (terms.length === 0) return [];

  const tsQuery = terms.join(" | ");

  try {
    const rows = await db
      .select({
        id: docChunks.qdrantPointId,
        docId: docChunks.docId,
        title: docChunks.title,
        section: docChunks.section,
        content: docChunks.content,
      })
      .from(docChunks)
      .where(
        and(
          eq(docChunks.scope, "kb"),
          sql`to_tsvector('english', coalesce(${docChunks.section}, '') || ' ' || ${docChunks.content}) @@ to_tsquery('english', ${tsQuery})`
        )
      )
      .orderBy(
        desc(
          sql`ts_rank_cd(to_tsvector('english', coalesce(${docChunks.section}, '') || ' ' || ${docChunks.content}), to_tsquery('english', ${tsQuery}))`
        )
      )
      .limit(limit);

    return rows
      .filter((row) => row.id)
      .map((row) => ({
        id: String(row.id),
        docId: row.docId,
        title: row.title || "Knowledge Base Document",
        section: row.section || "",
        content: row.content,
        sourceUrl: "",
        keywordScore: 0,
        scope: "kb" as const,
      }));
  } catch (err) {
    console.warn("[Retriever] Postgres keyword search skipped:", err);
    return [];
  }
}

/**
 * Give sparse-only candidates a real dense score by pulling their stored vectors
 * out of Qdrant. Without this they would enter fusion with a dense score of 0
 * and could never clear the confidence guardrail, no matter how exact the match.
 */
async function attachDenseScores(
  candidates: Omit<RetrievedChunk, "score" | "hybridScore">[],
  queryVector: number[]
): Promise<RetrievedChunk[]> {
  if (candidates.length === 0) return [];

  if (!qdrant) {
    return candidates.map((candidate) => ({ ...candidate, score: 0, hybridScore: 0 }));
  }

  try {
    const points = await qdrant.retrieve(COLLECTION_NAME, {
      ids: candidates.map((candidate) => candidate.id),
      with_vector: true,
      with_payload: true,
    });

    const vectors = new Map<string, number[]>();
    const sourceUrls = new Map<string, string>();
    for (const point of points) {
      if (Array.isArray(point.vector)) vectors.set(String(point.id), point.vector as number[]);
      if (point.payload?.source_url) sourceUrls.set(String(point.id), String(point.payload.source_url));
    }

    return candidates.map((candidate) => {
      const vector = vectors.get(candidate.id);
      const score = vector ? cosineSimilarity(queryVector, vector) : 0;
      return {
        ...candidate,
        sourceUrl: candidate.sourceUrl || sourceUrls.get(candidate.id) || "",
        score,
        hybridScore: score,
      };
    });
  } catch (err) {
    console.warn("[Retriever] Could not resolve vectors for keyword hits:", err);
    return candidates.map((candidate) => ({ ...candidate, score: 0, hybridScore: 0 }));
  }
}

// ---------------------------------------------------------------------------
// Local index cache
//
// The local fallback used to re-read every kb-doc and re-embed all 47 chunks on
// every single request — ~47 embedding round-trips per question, which both
// blew the 30s function budget and burned through the Gemini free-tier quota.
// The index is now built once per process and reused, keyed by a cheap
// signature of the kb-docs directory so uploads and re-indexes invalidate it.
// ---------------------------------------------------------------------------

interface IndexedChunk extends Omit<RetrievedChunk, "score" | "keywordScore" | "hybridScore"> {
  vector: number[];
}

let cachedIndex: IndexedChunk[] | null = null;
let cachedSignature = "";
let indexBuild: Promise<IndexedChunk[]> | null = null;

function kbSignature(): string {
  if (!fs.existsSync(KB_DOCS_DIR)) return "empty";
  return fs
    .readdirSync(KB_DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `${f}:${fs.statSync(path.join(KB_DOCS_DIR, f)).mtimeMs}`)
    .join("|");
}

/** Drop the cached local index — called after an upload or re-index. */
export function invalidateLocalIndex(): void {
  cachedIndex = null;
  cachedSignature = "";
  indexBuild = null;
}

async function buildLocalIndex(): Promise<IndexedChunk[]> {
  const files = fs.readdirSync(KB_DOCS_DIR).filter((f) => f.endsWith(".md"));
  const index: IndexedChunk[] = [];

  for (const filename of files) {
    const content = fs.readFileSync(path.join(KB_DOCS_DIR, filename), "utf-8");
    const chunks = chunkMarkdown(filename, content);

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      index.push({
        id: `local_chunk_${filename}_${idx}`,
        docId: filename,
        title: chunk.title,
        section: chunk.section,
        content: chunk.content,
        sourceUrl: `/kb-docs/${filename}`,
        scope: "kb",
        vector: await embedText(chunk.content),
      });
    }
  }

  return index;
}

async function getLocalIndex(): Promise<IndexedChunk[]> {
  const signature = kbSignature();

  if (cachedIndex && cachedSignature === signature) return cachedIndex;

  // Collapse concurrent cold-start requests onto a single build.
  if (!indexBuild || cachedSignature !== signature) {
    cachedSignature = signature;
    indexBuild = buildLocalIndex()
      .then((index) => {
        cachedIndex = index;
        return index;
      })
      .catch((err) => {
        indexBuild = null;
        cachedSignature = "";
        throw err;
      });
  }

  return indexBuild;
}

/** In-memory local vector cosine search over /kb-docs chunks */
async function localCosineSearch(
  queryVector: number[],
  topK: number
): Promise<RetrievedChunk[]> {
  if (!fs.existsSync(KB_DOCS_DIR)) return [];

  const index = await getLocalIndex();

  return index
    .map(({ vector, ...chunk }) => {
      const score = cosineSimilarity(queryVector, vector);
      return { ...chunk, score, keywordScore: 0, hybridScore: score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
