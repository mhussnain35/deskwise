import { NextRequest, NextResponse } from "next/server";

export const ADMIN_TOKEN_HEADER = "x-admin-token";

/**
 * Gate for the admin write endpoints (`/api/admin/docs` POST, `/api/admin/reindex`).
 *
 * Both routes mutate the knowledge base — writing markdown that is then fed
 * straight into the model's grounding context, and triggering a full re-embed
 * of every chunk. Left open, anyone who finds the URL can rewrite what the
 * support agent tells your customers, or drain the provider quota on demand.
 *
 * Configure `ADMIN_TOKEN` to enable them. Without it they stay open in local
 * development (so the demo works out of the box) and are disabled in
 * production rather than silently unprotected.
 *
 * Returns a NextResponse to short-circuit with, or null when the request may
 * proceed.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        {
          error:
            "Admin API is disabled. Set ADMIN_TOKEN in the deployment environment to enable knowledge base management.",
        },
        { status: 503 }
      );
    }
    return null; // local development convenience
  }

  const provided = req.headers.get(ADMIN_TOKEN_HEADER);
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

/** Constant-time string compare so the token can't be recovered byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
