/**
 * Upstream (Gemini / Qdrant / Neon) failure wrapper.
 *
 * Provider SDKs throw errors whose `message` is the raw provider response body —
 * for Gemini that includes quota metric names, quota IDs and internal retry
 * hints. Those must never reach the browser, so every upstream failure is
 * normalised here into a safe status + a message written for an end user, with
 * the original kept server-side for logging only.
 */
export class UpstreamError extends Error {
  readonly status: number;
  readonly publicMessage: string;
  readonly retryAfterSeconds?: number;

  constructor(publicMessage: string, status = 502, options?: { cause?: unknown; retryAfterSeconds?: number }) {
    super(publicMessage, options?.cause ? { cause: options.cause } : undefined);
    this.name = "UpstreamError";
    this.status = status;
    this.publicMessage = publicMessage;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

/** Best-effort HTTP status extraction across provider SDK error shapes. */
function extractStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;

  for (const key of ["status", "code", "statusCode"]) {
    const value = e[key];
    if (typeof value === "number" && value >= 400 && value < 600) return value;
  }

  // Gemini's ApiError stringifies the provider body into `message`.
  if (typeof e.message === "string") {
    if (/RESOURCE_EXHAUSTED|"code"\s*:\s*429|Too Many Requests/.test(e.message)) return 429;
    if (/"code"\s*:\s*(401|403)|PERMISSION_DENIED|API key not valid/.test(e.message)) return 403;
  }

  return undefined;
}

/** Pull Gemini's `"Please retry in 42.45s"` / `retryDelay: "42s"` hint, if present. */
function extractRetryAfter(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return undefined;

  const match = message.match(/retry in ([\d.]+)s|"retryDelay"\s*:\s*"(\d+)s"/);
  const seconds = match?.[1] ?? match?.[2];
  return seconds ? Math.ceil(Number(seconds)) : undefined;
}

/**
 * Convert any thrown provider error into an UpstreamError with a user-safe
 * message. `context` names the operation ("embedding", "answer generation").
 */
export function toUpstreamError(err: unknown, context: string): UpstreamError {
  if (err instanceof UpstreamError) return err;

  const status = extractStatus(err);

  if (status === 429) {
    const retryAfterSeconds = extractRetryAfter(err);
    return new UpstreamError(
      retryAfterSeconds
        ? `The AI service is rate limited right now. Please try again in about ${retryAfterSeconds} seconds.`
        : "The AI service is rate limited right now. Please try again in a moment.",
      429,
      { cause: err, retryAfterSeconds }
    );
  }

  if (status === 403 || status === 401) {
    return new UpstreamError(
      "The AI service rejected this request. Please contact support if this persists.",
      502,
      { cause: err }
    );
  }

  return new UpstreamError(
    `The AI service is temporarily unavailable (${context}). Please try again shortly.`,
    502,
    { cause: err }
  );
}

/** Structured server-side log — the only place the raw provider body is written. */
export function logUpstream(scope: string, err: unknown): void {
  const raw = err instanceof Error ? (err.cause ?? err) : err;
  console.error(`[${scope}]`, raw);
}
