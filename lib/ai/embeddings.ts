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
 * Deterministic mock embedding fallback for testing when API key is unconfigured
 */
function generateMockEmbedding(text: string): number[] {
  const vec = new Array(VECTOR_DIMENSION).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    vec[i % VECTOR_DIMENSION] += (charCode / 255) * 0.1;
  }
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0)) || 1;
  return vec.map((val) => val / norm);
}
