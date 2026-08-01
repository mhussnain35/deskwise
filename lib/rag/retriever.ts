import fs from "fs";
import path from "path";
import { embedText } from "../ai/embeddings";
import { qdrant, COLLECTION_NAME } from "../qdrant/client";
import { chunkMarkdown } from "./chunker";

export interface RetrievedChunk {
  id: string;
  docId: string;
  title: string;
  section: string;
  content: string;
  sourceUrl: string;
  score: number;
}

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  topScore: number;
  confidencePassed: boolean;
}

// Confidence score threshold: queries scoring below this skip LLM and return human escalation fallback
export const CONFIDENCE_THRESHOLD = 0.55;

const KB_DOCS_DIR = path.join(process.cwd(), "kb-docs");

/**
 * Retrieve top-K relevant knowledge base chunks for a given query.
 * Supports Qdrant Cloud vector search with a local cosine similarity fallback.
 */
export async function retrieveContext(
  query: string,
  topK: number = 5
): Promise<RetrievalResult> {
  const queryVector = await embedText(query);

  let retrievedChunks: RetrievedChunk[] = [];

  // 1. Qdrant Cloud Retrieval (if client is configured)
  if (qdrant) {
    try {
      const searchResults = await qdrant.search(COLLECTION_NAME, {
        vector: queryVector,
        limit: topK,
        with_payload: true,
      });

      retrievedChunks = searchResults.map((item) => ({
        id: String(item.id),
        docId: String(item.payload?.doc_id || ""),
        title: String(item.payload?.title || "Knowledge Base Document"),
        section: String(item.payload?.section || ""),
        content: String(item.payload?.content || ""),
        sourceUrl: String(item.payload?.source_url || ""),
        score: item.score,
      }));
    } catch (qdrantErr) {
      console.warn("[Retriever] Qdrant search error, falling back to local search:", qdrantErr);
    }
  }

  // 2. Local Cosine Similarity Search Fallback (if Qdrant returns empty or unconfigured)
  if (retrievedChunks.length === 0) {
    retrievedChunks = await localCosineSearch(queryVector, topK);
  }

  const topScore = retrievedChunks.length > 0 ? retrievedChunks[0].score : 0;
  const confidencePassed = topScore >= CONFIDENCE_THRESHOLD;

  return {
    query,
    chunks: retrievedChunks,
    topScore,
    confidencePassed,
  };
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

interface IndexedChunk extends Omit<RetrievedChunk, "score"> {
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
    .map(({ vector, ...chunk }) => ({ ...chunk, score: cosineSimilarity(queryVector, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
