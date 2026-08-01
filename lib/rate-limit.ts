/**
 * Sliding-window rate limiter for /api/chat
 * Prevents Gemini free-tier 429s during live demos by enforcing per-session limits.
 * Uses in-memory store (resets on cold start, which is fine for demo/portfolio use).
 */

interface WindowEntry {
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

const MAX_REQUESTS = 10;       // max requests allowed per window
const WINDOW_MS   = 60_000;   // 60-second sliding window

export function checkRateLimit(sessionId: string): {
  allowed: boolean;
  remaining: number;
  resetMs: number;
} {
  const now = Date.now();
  const key = sessionId || "anonymous";

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Drop timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < WINDOW_MS);

  if (entry.timestamps.length >= MAX_REQUESTS) {
    const oldest  = entry.timestamps[0];
    const resetMs = WINDOW_MS - (now - oldest);
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.timestamps.push(now);
  return { allowed: true, remaining: MAX_REQUESTS - entry.timestamps.length, resetMs: 0 };
}

// Prune stale sessions every 5 minutes to avoid unbounded memory growth.
// unref() so this timer never holds the process open — otherwise `next build`
// and serverless invocations wait on it before exiting.
const pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < WINDOW_MS);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 5 * 60_000);

pruneTimer.unref?.();
