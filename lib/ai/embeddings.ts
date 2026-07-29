import { ai } from "./gemini";

export const EMBEDDING_MODEL = "text-embedding-004";
export const VECTOR_DIMENSION = 768;

/**
 * Generate a 768-d vector embedding via Gemini text-embedding-004.
 * Falls back to generateMockEmbedding() when no API key is configured.
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
    console.warn("[Embeddings] API call failed, using fallback:", err);
    return generateMockEmbedding(text);
  }
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
