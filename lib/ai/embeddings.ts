import { ai } from "./gemini";

export const EMBEDDING_MODEL = "text-embedding-004";
export const VECTOR_DIMENSION = 768;

/**
 * Generate 768-dimensional dense vector embedding using Gemini text-embedding-004
 */
export async function embedText(text: string): Promise<number[]> {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy-key-for-dev") {
    return generateMockEmbedding(text);
  }

  try {
    const response: any = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });

    const values = response.embedding?.values || response.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error("Empty embedding returned from Gemini API");
    }

    return values;
  } catch (err) {
    console.warn("[Embeddings] API call failed, using fallback vector:", err);
    return generateMockEmbedding(text);
  }
}

/**
 * Semantic mock embedding fallback for dev & eval testing when API key is unconfigured.
 * Maps domain keywords to distinct vector dimensions.
 */
function generateMockEmbedding(text: string): number[] {
  const vec = new Array(VECTOR_DIMENSION).fill(0.01);
  const lower = text.toLowerCase();

  // Domain topic clusters
  const keywords: Record<string, number> = {
    pricing: 10, cost: 10, plan: 10, pro: 10, enterprise: 10, seat: 10, credit: 10,
    refund: 20, return: 20, "14-day": 20, "money-back": 20, dispute: 20,
    cancel: 30, cancellation: 30, delete: 30, retention: 30, terminate: 30, pause: 30,
    payment: 40, fail: 40, card: 40, retry: 40, grace: 40, dunning: 40, charge: 40,
    upgrade: 50, downgrade: 50, prorate: 50, proration: 50,
    invoice: 60, vat: 60, tax: 60, receipt: 60, ach: 60, wire: 60, currency: 60,
    pci: 70, gdpr: 70, soc: 70, security: 70, compliance: 70, stripe: 70,
  };

  let matchedDomain = false;
  for (const [kw, dimOffset] of Object.entries(keywords)) {
    if (lower.includes(kw)) {
      matchedDomain = true;
      for (let i = 0; i < 50; i++) {
        vec[(dimOffset * 10 + i) % VECTOR_DIMENSION] += 0.8;
      }
    }
  }

  if (!matchedDomain) {
    // Add noise to out-of-scope vectors in orthogonal dimensions
    for (let i = 0; i < lower.length; i++) {
      vec[(600 + (lower.charCodeAt(i) % 100)) % VECTOR_DIMENSION] += 0.1;
    }
  }

  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1;
  return vec.map((val) => val / norm);
}
