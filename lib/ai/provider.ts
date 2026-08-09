/**
 * Which AI provider serves generation and embeddings.
 *
 * Two are supported:
 *   openrouter — one key for both chat and embeddings, OpenAI-compatible
 *   gemini     — Google's SDK directly
 *
 * The provider is chosen by `AI_PROVIDER`, or inferred from whichever key is
 * present (OpenRouter wins when both are set). Nothing else in the codebase
 * reads provider keys directly, so switching vendors is a config change.
 *
 * A word on the embedding dimension, because it is the one setting that can
 * silently corrupt retrieval: a vector is only comparable to vectors from the
 * *same model*. Changing embedding model or dimension makes every stored vector
 * meaningless, even though nothing errors — cosine similarity just collapses
 * and the agent starts escalating everything. After changing either, re-run
 * `npx tsx scripts/ingest.ts`, and recreate the Qdrant collection if the
 * dimension changed.
 */

export type AiProvider = "openrouter" | "gemini";

/**
 * Generation and embeddings are resolved separately, because the cheapest
 * source for each is rarely the same vendor. A working combination today:
 * chat on an OpenRouter free model, embeddings on Gemini — which also happens
 * to be what the existing 768-d Qdrant collection was built with, so switching
 * generation providers costs no re-indexing at all.
 */
export type AiRole = "generation" | "embedding";

/**
 * Overridable so the OpenAI-compatible path can be pointed at a gateway, a
 * self-hosted proxy, or a local mock during testing.
 */
export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL?.replace(/\/+$/, "") || "https://openrouter.ai/api/v1";

/** Placeholder used by the dev-mode mock path in place of a real key. */
const DUMMY_KEY = "dummy-key-for-dev";

function isRealKey(value: string | undefined): value is string {
  return Boolean(value) && value !== DUMMY_KEY;
}

function named(value: string | undefined): AiProvider | undefined {
  const normalised = value?.toLowerCase().trim();
  return normalised === "openrouter" || normalised === "gemini" ? normalised : undefined;
}

export function resolveProvider(role: AiRole = "generation"): AiProvider {
  if (role === "embedding") {
    const explicit = named(process.env.EMBEDDING_PROVIDER);
    if (explicit) return explicit;
  }

  const shared = named(process.env.AI_PROVIDER);
  if (shared) return shared;

  return isRealKey(process.env.OPENROUTER_API_KEY) ? "openrouter" : "gemini";
}

export const AI_PROVIDER: AiProvider = resolveProvider("generation");
export const EMBEDDING_PROVIDER: AiProvider = resolveProvider("embedding");

/** The API key for a provider, or undefined when unset. */
export function providerApiKey(provider: AiProvider = AI_PROVIDER): string | undefined {
  const key =
    provider === "openrouter" ? process.env.OPENROUTER_API_KEY : process.env.GEMINI_API_KEY;
  return isRealKey(key) ? key : undefined;
}

/**
 * True when no usable key is configured for that role. The app still runs:
 * generation falls back to an extractive answer from the retrieved chunks, and
 * embeddings fall back to deterministic keyword-cluster vectors, so the UI and
 * the retrieval plumbing can be demonstrated offline.
 */
export function isMockMode(role: AiRole = "generation"): boolean {
  return providerApiKey(role === "embedding" ? EMBEDDING_PROVIDER : AI_PROVIDER) === undefined;
}

/** Chat model id for the generation provider. */
export function generationModel(): string {
  if (AI_PROVIDER === "openrouter") {
    return process.env.OPENROUTER_MODEL || "google/gemini-3.5-flash-lite";
  }
  return process.env.GEMINI_MODEL || "gemini-2.0-flash";
}

/** Embedding model id for the embedding provider. */
export function embeddingModel(): string {
  if (EMBEDDING_PROVIDER === "openrouter") {
    return process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";
  }
  return process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
}

/**
 * Vector width. Must match the Qdrant collection; the default of 768 is what
 * the existing `support_kb` collection was created with.
 */
export function embeddingDimension(): number {
  const raw = Number(process.env.EMBEDDING_DIMENSION);
  return Number.isInteger(raw) && raw > 0 ? raw : 768;
}

/** Headers OpenRouter uses for attribution on its public leaderboards. */
export function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY || ""}`,
    "Content-Type": "application/json",
  };

  const referer = process.env.OPENROUTER_SITE_URL;
  const title = process.env.OPENROUTER_SITE_NAME || "Deskwise";
  if (referer) headers["HTTP-Referer"] = referer;
  headers["X-Title"] = title;

  return headers;
}
