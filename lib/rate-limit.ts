/**
 * Sliding-window rate limiter for /api/chat
 * Prevents upstream free-tier 429s during live demos by enforcing per-session limits.
 * Uses in-memory store (resets on cold start, which is fine for demo/portfolio use).
 */

interface WindowEntry {
  timestamps: number[];
  /** Window this bucket was created with, so the pruner doesn't expire entries
   *  from a longer-window bucket (uploads) using the chat window. */
  windowMs: number;
}

const store = new Map<string, WindowEntry>();

const MAX_REQUESTS = 10;       // max requests allowed per window
const WINDOW_MS   = 60_000;   // 60-second sliding window

export interface RateLimitOptions {
  /** Namespace so different actions don't share one budget. */
  bucket?: string;
  maxRequests?: number;
  windowMs?: number;
}

export function checkRateLimit(
  sessionId: string,
  options: RateLimitOptions = {}
): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
} {
  const {
    bucket = "chat",
    maxRequests = MAX_REQUESTS,
    windowMs = WINDOW_MS,
  } = options;

  const now = Date.now();
  const key = `${bucket}:${sessionId || "anonymous"}`;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [], windowMs };
    store.set(key, entry);
  }

  // Drop timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldest  = entry.timestamps[0];
    const resetMs = windowMs - (now - oldest);
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: maxRequests - entry.timestamps.length, resetMs: 0 };
}

/**
 * Uploads carry a much heavier cost than a chat turn — parsing, then one
 * embedding call per chunk — so they get their own, tighter budget.
 */
export function checkUploadRateLimit(sessionId: string) {
  return checkRateLimit(sessionId, {
    bucket: "upload",
    maxRequests: 5,
    windowMs: 5 * 60_000,
  });
}

// Prune stale sessions every 5 minutes to avoid unbounded memory growth.
// unref() so this timer never holds the process open — otherwise `next build`
// and serverless invocations wait on it before exiting.
const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < entry.windowMs);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 5 * 60_000);

pruneTimer.unref?.();
