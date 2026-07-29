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
export const CONFIDENCE_THRESHOLD = 0.35;

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
    retrievedChunks = await localCosineSearch(query, queryVector, topK);
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

/**
 * In-memory local vector cosine search over /kb-docs chunks
 */
async function localCosineSearch(
  query: string,
  queryVector: number[],
  topK: number
): Promise<RetrievedChunk[]> {
  const kbDir = path.join(process.cwd(), "kb-docs");
  if (!fs.existsSync(kbDir)) return [];

  const files = fs.readdirSync(kbDir).filter((f) => f.endsWith(".md"));
  const allScoredChunks: RetrievedChunk[] = [];

  for (const filename of files) {
    const filePath = path.join(kbDir, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const chunks = chunkMarkdown(filename, content);

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const chunkVector = await embedText(chunk.content);
      const score = cosineSimilarity(queryVector, chunkVector);

      allScoredChunks.push({
        id: `local_chunk_${filename}_${idx}`,
        docId: filename,
        title: chunk.title,
        section: chunk.section,
        content: chunk.content,
        sourceUrl: `/kb-docs/${filename}`,
        score: score,
      });
    }
  }

  allScoredChunks.sort((a, b) => b.score - a.score);
  return allScoredChunks.slice(0, topK);
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
