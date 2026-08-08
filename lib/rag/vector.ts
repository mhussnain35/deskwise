/** Cosine similarity between two equal-length vectors. Returns 0 on mismatch. */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

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

/**
 * Round vector components before persisting them as JSON.
 *
 * A 768-d float64 vector serialises to ~15 KB of JSON; six decimal places cut
 * that to ~6 KB with a cosine error well below 1e-5, which matters when the
 * whole free-tier Postgres allowance is 0.5 GB.
 */
export function compactVector(vector: number[]): number[] {
  return vector.map((value) => Math.round(value * 1e6) / 1e6);
}
