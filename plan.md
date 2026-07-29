# Implementation Plan — Customer Support RAG

Based on `spec.md`. Follow phases in order — each phase should be a working, runnable state before moving to the next. Don't jump ahead to admin panel/eval before core chat works end-to-end.

---

## Phase 0 — Setup & Accounts (do this first, ~30 min)
1. Create Qdrant Cloud account → create free cluster → save cluster URL + API key
2. Create Neon account → create project → save connection string
3. Get Google Gemini API key (aistudio.google.com) → save key
4. Create Vercel account, link to GitHub (deploy later, just have it ready)
5. `npx create-next-app@latest` (App Router, TypeScript, Tailwind — yes to all)
6. Create `.env.local` with: `GEMINI_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`, `DATABASE_URL` (Neon)
7. `git init`, push empty scaffold to GitHub — commit early, commit often
8. Install core deps: `npm i @google/genai @qdrant/js-client-rest drizzle-orm @neondatabase/serverless`
9. Install dev deps: `npm i -D drizzle-kit`

**Done when:** `npm run dev` runs, `.env.local` has all 3 keys, repo is on GitHub.

---

## Phase 1 — Neon Schema + Basic Chat (no RAG yet)
Goal: prove the LLM call + streaming + DB write works before adding retrieval complexity.

1. Write Drizzle schema file matching spec section 9: `docs`, `doc_chunks`, `conversations`, `messages`, `feedback`
2. Run `drizzle-kit generate` + `drizzle-kit push` to create tables in Neon
3. Build `/api/chat` route: accepts a message, calls Gemini directly (no retrieval yet), streams response back
4. Build minimal chat UI: input box, message list, streaming text render
5. On each message, write user + assistant turn into `messages` table (create a `conversations` row on first message of a session)
6. Test: send a message, confirm streaming works in browser, confirm rows appear in Neon

**Done when:** you can chat with plain Gemini through your UI and see the conversation persisted in Neon. No Qdrant yet.

---

## Phase 2 — Knowledge Base Content
Goal: have real-feeling docs before building ingestion, so you're testing against real data.

1. Write the fake SaaS KB docs (markdown files, 8-15 docs): pricing tiers, refund policy, cancellation flow, invoice/payment failure handling, upgrade/downgrade rules, account/billing FAQ
2. Keep each doc reasonably structured with clear headings — this matters for chunking later
3. Store these as files in a `/kb-docs` folder in the repo (source of truth, also doubles as demo transparency)

**Done when:** you have a folder of realistic docs you'd actually believe are from a SaaS company.

---

## Phase 3 — Ingestion Pipeline (Qdrant)
Goal: get docs chunked, embedded, and searchable.

1. Create Qdrant collection `support_kb` with dense + sparse vector config (per spec section 10)
2. Write a chunking function: split by heading/section (semantic chunking, not fixed-token) — this is your interview talking point, get it right
3. Write embedding function using Gemini `text-embedding-004`
4. Write ingestion script: for each doc in `/kb-docs` → chunk → embed → upsert into Qdrant with payload (doc_id, title, section, content, source_url) → also insert chunk rows into Neon `doc_chunks` with `qdrant_point_id` link
5. Run the script manually first (not through UI yet) — confirm points appear in Qdrant dashboard
6. Sanity-check retrieval: manually query Qdrant with a test embedding, confirm relevant chunks come back

**Done when:** running the ingestion script populates both Qdrant and Neon correctly, and a manual test query returns sensible chunks.

---

## Phase 4 — Wire Retrieval into Chat
Goal: turn Phase 1's plain chatbot into an actual RAG system.

1. In `/api/chat`, before calling Gemini: embed the user's query, run hybrid search against Qdrant (top-k=5)
2. Add the confidence guardrail: if top score < threshold, skip the LLM call, return the fallback message directly (spec section 7)
3. Build the prompt: inject retrieved chunks as context, use Gemini `systemInstruction` to enforce "only answer from context, cite chunk IDs, say I don't know if insufficient"
4. Switch generation call to `generateContentStream`
5. Parse the LLM's cited chunk IDs from the response, store them in `messages.cited_chunk_ids`
6. Update UI: show source snippets/citations below each answer (pull chunk content from Neon using the cited IDs)

**Done when:** asking a real billing question returns a streamed answer with correct citations, and an out-of-scope question triggers the fallback instead of a hallucinated answer.

---

## Phase 5 — Feedback + History Polish
1. Add thumbs up/down UI on each assistant message → `POST /api/feedback` → write to `feedback` table
2. Build `GET /api/history/:sessionId` → load and render past messages on page reload (session id in a cookie or localStorage-free URL param)
3. Test the full loop: refresh page mid-conversation, confirm history reloads correctly

**Done when:** feedback persists, and reloading the page doesn't lose the conversation.

---

## Phase 6 — Admin Panel
Goal: show you built the ingestion pipeline as a product feature, not just a script.

1. Simple session/JWT auth gate for `/admin` routes (hardcoded single admin user is fine)
2. Admin UI: list uploaded docs, upload new doc (paste text or upload .md), trigger reindex
3. `POST /api/admin/docs` — save doc to Neon + `/kb-docs`
4. `POST /api/admin/reindex` — re-run chunk → embed → upsert for a given doc (reuse Phase 3 logic as a shared function, don't duplicate it)
5. Test: add a new doc through the admin UI, confirm it's immediately retrievable in chat

**Done when:** you can add/update KB content through the UI without touching code or running scripts manually.

---

## Phase 7 — Evaluation Harness
Goal: the differentiator most portfolio RAGs skip.

1. Write 20-30 test Q&A pairs against your fake KB (mix of answerable + intentionally out-of-scope questions to test fallback)
2. Set up RAGAS (or a lightweight custom script if RAGAS setup is too heavy) scoring faithfulness, answer relevance, context precision/recall
3. Run eval, save results as a table/markdown output
4. Fix any obvious retrieval gaps the eval surfaces (bad chunking boundaries, missing docs, threshold too strict/loose)
5. Re-run eval after fixes, keep before/after numbers — great README material

**Done when:** you have a results table you're not embarrassed to show an interviewer.

---

## Phase 8 — Rate Limiting & Free-Tier Guardrails
1. Add simple in-memory or Neon-backed rate limiting on `/api/chat` (per-session, e.g. max N requests/min) to avoid hitting Gemini free-tier 429s live
2. Add a loading state for Neon cold-start latency (first query after idle)
3. Add a visible KB size note somewhere (e.g. admin panel or README) since Qdrant free tier is ~1GB

**Done when:** a rapid-fire demo session doesn't produce a raw error to the user — worst case it shows a friendly "slow down" message.

---

## Phase 9 — Polish, Deploy, Document
1. UI pass: clean up spacing/loading states/empty states, make sure streaming feels smooth
2. Deploy to Vercel, set all env vars there, test the live URL end-to-end
3. Write README with: project overview, architecture diagram (reuse spec section 4), the 4 talking points from spec section 13, eval results table, known limitations (spec section 12), setup instructions
4. Record a 60-90 second demo video/gif for the README and portfolio site
5. Add live demo link + repo link to resume/portfolio

**Done when:** a stranger could read the README, understand the architecture decisions, and click a working live demo — that's the actual finish line, not "the code runs."

---

## Order-of-operations reminder
Don't build Phase 6 (admin) or Phase 7 (eval) before Phase 4 (retrieval) works reliably — polish on a broken core just means redoing work. If short on time, Phases 0-5 + 9 are the non-negotiable path to a demoable project; 6-8 are what make it stand out.
