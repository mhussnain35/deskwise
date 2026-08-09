/**
 * OpenRouter configuration.
 *
 * One key, one base URL, one place that reads the environment — nothing else in
 * the codebase touches provider settings, so changing model is a config change.
 *
 * A word on the embedding dimension, because it is the one setting that can
 * silently destroy retrieval: a vector is only comparable to vectors produced by
 * the *same model*. Change the embedding model (or its width) and every stored
 * vector becomes meaningless — nothing errors, cosine similarity simply
 * collapses toward zero, every query falls under the confidence threshold, and
 * the agent starts refusing questions it can plainly answer. After changing
 * either, re-embed everything:
 *
 *   npx tsx scripts/ingest.ts        # company knowledge base
 *   npx tsx scripts/reembed.ts       # documents users uploaded
 */

export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL?.replace(/\/+$/, "") || "https://openrouter.ai/api/v1";

/** Placeholder standing in for a real key in offline/demo mode. */
const DUMMY_KEY = "dummy-key-for-dev";

/** The API key, or undefined when none is usable. */
export function providerApiKey(): string | undefined {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key && key !== DUMMY_KEY ? key : undefined;
}

/**
 * True when no key is configured. The app still runs: generation falls back to
 * an extractive answer from the retrieved chunks and embeddings fall back to
 * deterministic keyword-cluster vectors, so the UI and the retrieval plumbing
 * can be demonstrated offline.
 */
export function isMockMode(): boolean {
  return providerApiKey() === undefined;
}

/**
 * Chat model id. Ids are retired over time — a stale one fails with
 * "No endpoints found for <id>". Browse current ids at
 * https://openrouter.ai/models; a ":free" suffix needs no credit balance.
 */
export function generationModel(): string {
  return process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-nano-30b-a3b:free";
}

/** Embedding model id. See https://openrouter.ai/collections/embedding-models */
export function embeddingModel(): string {
  return process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";
}

/** Vector width. Must match the Qdrant collection. */
export function embeddingDimension(): number {
  const raw = Number(process.env.EMBEDDING_DIMENSION);
  return Number.isInteger(raw) && raw > 0 ? raw : 768;
}

/** Auth plus the attribution headers OpenRouter shows on its leaderboards. */
export function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${providerApiKey() ?? ""}`,
    "Content-Type": "application/json",
    "X-Title": process.env.OPENROUTER_SITE_NAME || "Deskwise",
  };

  const referer = process.env.OPENROUTER_SITE_URL;
  if (referer) headers["HTTP-Referer"] = referer;

  return headers;
}
