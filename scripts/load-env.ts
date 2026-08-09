import { loadEnvConfig } from "@next/env";

/**
 * Load .env.local for standalone scripts.
 *
 * `next dev` / `next build` load these automatically, but `npx tsx scripts/*.ts`
 * does not. Without this the CLI scripts saw no OPENROUTER_API_KEY, QDRANT_URL
 * or DATABASE_URL, so `scripts/ingest.ts` quietly embedded the whole knowledge
 * base with mock vectors and skipped Qdrant and Neon altogether — while still
 * reporting "Ingestion completed".
 *
 * Import this before anything that reads process.env at module scope
 * (lib/db, lib/qdrant/client, lib/ai/provider all do).
 */
loadEnvConfig(process.cwd());
