/**
 * Sparse (keyword) scoring — the second arm of hybrid retrieval.
 *
 * Dense embeddings are good at paraphrase and weak at exact tokens: plan names,
 * error codes, invoice numbers and any term that wasn't common in the embedding
 * model's training data. BM25 over the candidate pool covers precisely that gap,
 * and the two scores are then blended by `fuseScores` below.
 *
 * IDF is computed from the candidate pool rather than a pre-built corpus index.
 * The pool is the union of both retrieval arms (a few dozen chunks), which is
 * enough for term rarity to be meaningful without maintaining a second index.
 */

// BM25 free parameters — k1 controls term-frequency saturation, b the strength
// of the document-length normalisation. These are the standard defaults.
const K1 = 1.2;
const B = 0.75;

/** Weight of the dense arm in the fused score. 1 = pure vector, 0 = pure keyword. */
export const HYBRID_ALPHA = resolveAlpha();

function resolveAlpha(): number {
  const raw = Number(process.env.HYBRID_ALPHA);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return 0.7;
  return raw;
}

const STOPWORDS = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "before", "being", "between", "both", "but", "by", "can", "did",
  "do", "does", "doing", "for", "from", "get", "had", "has", "have", "having", "he", "her",
  "here", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "me",
  "my", "no", "not", "of", "on", "once", "only", "or", "other", "our", "out", "over", "own",
  "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "those", "to", "too", "under", "until", "up",
  "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "why",
  "will", "with", "would", "you", "your",
]);

/** Lowercase, split on non-alphanumerics, drop stopwords and single characters. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export interface KeywordScorable {
  content: string;
  /** Section/heading text — matched terms here are worth more than in the body. */
  section?: string | null;
  title?: string | null;
}

/**
 * Score every candidate against the query with BM25, normalised to 0..1 across
 * the pool so it can be blended with cosine similarity on the same scale.
 */
export function scoreKeywordRelevance(query: string, candidates: KeywordScorable[]): number[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0 || candidates.length === 0) {
    return new Array(candidates.length).fill(0);
  }

  // Headings are short and highly descriptive; repeating them gives their terms
  // roughly triple weight without a separate field-scoring pass.
  const documents = candidates.map((candidate) => {
    const heading = [candidate.title, candidate.section].filter(Boolean).join(" ");
    return tokenize(`${heading} ${heading} ${heading} ${candidate.content}`);
  });

  const avgLength =
    documents.reduce((sum, tokens) => sum + tokens.length, 0) / documents.length || 1;

  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const tokens of documents) {
      if (tokens.includes(term)) count++;
    }
    documentFrequency.set(term, count);
  }

  const rawScores = documents.map((tokens) => {
    const termCounts = new Map<string, number>();
    for (const token of tokens) termCounts.set(token, (termCounts.get(token) || 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const tf = termCounts.get(term);
      if (!tf) continue;

      const df = documentFrequency.get(term) || 0;
      // BM25 IDF with the +1 smoothing that keeps common terms non-negative.
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      const denominator = tf + K1 * (1 - B + (B * tokens.length) / avgLength);
      score += idf * ((tf * (K1 + 1)) / denominator);
    }
    return score;
  });

  const max = Math.max(...rawScores);
  if (max <= 0) return rawScores.map(() => 0);
  return rawScores.map((score) => score / max);
}

/**
 * Blend a dense cosine score with a normalised keyword score.
 *
 * Both inputs are already on a 0..1 scale, so this is a linear interpolation
 * rather than reciprocal-rank fusion — it keeps the fused value comparable to
 * the raw cosine score, which matters because the confidence guardrail and the
 * match percentages in the UI are both expressed in those terms.
 */
export function fuseScores(dense: number, keyword: number, alpha = HYBRID_ALPHA): number {
  return alpha * dense + (1 - alpha) * keyword;
}
