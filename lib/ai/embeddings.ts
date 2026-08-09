import { ai } from "./gemini";
import { openRouterError } from "./llm";
import {
  EMBEDDING_PROVIDER,
  OPENROUTER_BASE_URL,
  embeddingDimension,
  embeddingModel,
  isMockMode,
  openRouterHeaders,
} from "./provider";
import { UpstreamError, toUpstreamError } from "../errors";

// Model and width both come from the environment (see lib/ai/provider.ts).
// Gemini's text-embedding-004 was retired and 404s, which is why the default
// there is gemini-embedding-001 with the dimension requested explicitly: it
// defaults to 3072, and the Qdrant collection is 768.
export const EMBEDDING_MODEL = embeddingModel();
export const VECTOR_DIMENSION = embeddingDimension();

interface GeminiEmbedResponse {
  embedding?: { values?: number[] };
  embeddings?: { values?: number[] }[];
}

interface OpenAiEmbedResponse {
  data?: { embedding?: number[]; index?: number }[];
  error?: { message?: string };
}

/** True when no real key is configured — the whole app runs on mock vectors. */
export function isMockEmbeddingMode(): boolean {
  return isMockMode("embedding");
}

/**
 * Generate a vector embedding for one piece of text.
 *
 * Mock vectors are used only when no API key is configured at all, so that the
 * whole index and every query share one vector space. If a key IS configured
 * and the call fails, we throw rather than silently returning a mock vector —
 * mixing mock and real vectors drives cosine similarity to ~0, which would push
 * every query below CONFIDENCE_THRESHOLD and make the agent escalate on
 * everything with no error surfaced anywhere.
 */
export async function embedText(text: string): Promise<number[]> {
  if (isMockEmbeddingMode()) {
    return generateMockEmbedding(text);
  }

  const values =
    EMBEDDING_PROVIDER === "openrouter"
      ? await embedViaOpenRouter(text)
      : await embedViaGemini(text);

  assertDimension(values.length);

  // Cosine similarity is scale-invariant, but normalising once here keeps the
  // stored vectors unit-length so the dot product in the local index is the
  // cosine directly — and truncated Gemini dimensions are not pre-normalised.
  return normalize(values);
}

async function embedViaGemini(text: string): Promise<number[]> {
  try {
    const response = (await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: VECTOR_DIMENSION },
    })) as GeminiEmbedResponse;

    const values = response.embedding?.values || response.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new UpstreamError("The embedding service returned an empty vector.", 502);
    }
    return values;
  } catch (err) {
    throw toUpstreamError(err, "embedding");
  }
}

async function embedViaOpenRouter(text: string): Promise<number[]> {
  let response: Response;

  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
        encoding_format: "float",
        // Matryoshka-style truncation. Models that don't support it ignore the
        // field and return their native width, which assertDimension catches.
        dimensions: VECTOR_DIMENSION,
      }),
    });
  } catch (err) {
    throw toUpstreamError(err, "embedding");
  }

  if (!response.ok) {
    throw await openRouterError(response, "embedding");
  }

  const body = (await response.json()) as OpenAiEmbedResponse;
  const values = body.data?.[0]?.embedding;

  if (!values || values.length === 0) {
    throw new UpstreamError("The embedding service returned an empty vector.", 502, {
      cause: body.error ?? body,
    });
  }

  return values;
}

/**
 * Fail loudly on a width mismatch.
 *
 * A wrong dimension is the one failure mode that otherwise stays silent: Qdrant
 * rejects the upsert (so nothing is indexed) while queries still "work" against
 * whatever is already stored, and retrieval quietly degrades to nonsense. Better
 * to stop with an instruction than to serve a broken index.
 */
function assertDimension(actual: number): void {
  if (actual === VECTOR_DIMENSION) return;

  throw new UpstreamError(
    `Embedding model "${EMBEDDING_MODEL}" returned ${actual} dimensions but EMBEDDING_DIMENSION is ${VECTOR_DIMENSION}. ` +
      `Set EMBEDDING_DIMENSION=${actual} (or pick a model that supports ${VECTOR_DIMENSION}), ` +
      `then recreate the Qdrant collection and re-run "npx tsx scripts/ingest.ts".`,
    500
  );
}

/**
 * Embed many texts with bounded concurrency.
 *
 * Uploaded documents produce tens of chunks at once. Embedding them one at a
 * time makes a 40-chunk PDF take most of a minute (and risks the serverless
 * timeout), while firing all of them in parallel trips the Gemini free-tier
 * per-minute quota. Four at a time is the compromise.
 */
export async function embedTexts(texts: string[], concurrency = 4): Promise<number[][]> {
  const vectors: number[][] = new Array(texts.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < texts.length) {
      const index = cursor++;
      vectors[index] = await embedText(texts[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, texts.length) }, () => worker())
  );

  return vectors;
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// Mock embedding — deterministic keyword-cluster approach
//
// Encodes text into one of 8 SaaS-domain clusters (dims 80-719) based on
// domain phrase matches. Out-of-scope text (no domain phrase matches) is
// placed in an orthogonal region (dims 720-767) using a stable hash — so
// cosine similarity against any domain cluster approaches 0.
// ---------------------------------------------------------------------------

interface Cluster {
  id: number;       // 1-8 → base dim = id * 80
  phrases: string[];
}

const CLUSTERS: Cluster[] = [
  { id: 1, phrases: ["pricing", "cost", "pro plan", "enterprise plan", "free tier", "subscription plan", "tier", "seat", "quota"] },
  { id: 2, phrases: ["refund", "money-back", "14-day", "return policy", "charge dispute"] },
  { id: 3, phrases: ["cancel", "cancellation", "delete account", "data retention", "pause subscription", "pause account", "self-serve cancellation", "grace window"] },
  { id: 4, phrases: ["payment fail", "failed charge", "retry schedule", "grace period", "dunning", "card declin", "failed payment"] },
  { id: 5, phrases: ["proration", "upgrade", "downgrade", "mid-cycle", "prorated", "tier change"] },
  { id: 6, phrases: ["invoice", "vat", "sales tax", "receipt", "ach", "wire transfer", "po number", "billing faq", "payment method"] },
  { id: 7, phrases: ["pci dss", "gdpr", "soc 2", "security", "compliance", "erasure", "data export", "privacy"] },
  { id: 8, phrases: ["sla", "uptime", "availability", "guarantee", "outage credit", "enterprise sla", "service level", "monthly availability", "credit compensation", "billing credit"] },
];

function generateMockEmbedding(text: string): number[] {
  const vec = new Array(VECTOR_DIMENSION).fill(0.0);
  const lower = text.toLowerCase();

  let matched = false;

  for (const cluster of CLUSTERS) {
    for (const phrase of cluster.phrases) {
      if (lower.includes(phrase)) {
        matched = true;
        // Fill 70 consecutive dims starting at cluster base
        const base = cluster.id * 80;
        for (let i = 0; i < 70; i++) {
          vec[base + i] = 1.0;
        }
        break; // one phrase match per cluster is enough
      }
    }
  }

  if (!matched) {
    // Out-of-scope: use stable hash → unique dim in 720-767 (no overlap with any cluster)
    let hash = 5381;
    for (let i = 0; i < lower.length; i++) {
      hash = ((hash << 5) + hash + lower.charCodeAt(i)) & 0xffff;
    }
    const dim = 720 + (hash % 48);
    vec[dim] = 1.0;
  }

  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
