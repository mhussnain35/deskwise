# Customer Support RAG — Project Spec

## 1. What this is
A resume/portfolio project: an AI customer support agent that answers questions using a company's own docs (retrieval-augmented generation), instead of hallucinating generic answers. Built to be demoed live in interviews and to show up as a keyword-matched line item on a resume/ATS scan.

**Vertical (pick one, don't stay generic):** SaaS billing & subscription support bot. Fake company, real-feeling docs: pricing tiers, refund policy, cancellation flow, invoice/payment failure handling, upgrade/downgrade rules. Narrow vertical > generic "customer support" because demo data feels real instead of toy.

## 2. Goals
- Resume line: "Built a production-style RAG support agent using Next.js, Qdrant Cloud, and Neon Postgres, with hybrid search and RAGAS-evaluated retrieval quality."
- Live demo must not break: streaming, fast responses, graceful fallback when it doesn't know.
- Show deliberate architecture decisions (this is what interviewers actually probe).

## 3. Tech Stack (100% free tier — no paid resources)
| Layer | Choice | Why | Free tier limit to know |
|---|---|---|---|
| Frontend/Backend | Next.js (App Router) | Full-stack in one framework, easy to deploy, resume-recognizable | Open source, no cost |
| Vector DB | Qdrant Cloud (free cluster) | Named vector DB skill on resume, native hybrid search (dense + sparse) | ~1GB storage |
| Relational DB | Neon (serverless Postgres, free tier) | Conversation history, tickets, feedback, doc metadata | 0.5GB storage, autosuspend on idle |
| Embeddings | Gemini `text-embedding-004` (same Gemini API key) | Free, avoids needing a separate paid OpenAI key, one less service to manage | Free tier rate limits apply (RPM-capped) |
| LLM | Google Gemini API, free tier (`gemini-1.5-flash` or `gemini-2.0-flash`) | Answer generation + citation formatting | Free tier RPM/RPD caps — throttle demo traffic |
| ORM | Drizzle or Prisma | Type-safe Neon queries | Open source, no cost |
| Auth (admin only) | Simple session/JWT (no auth provider needed) | Just for the KB admin panel, not end users | No cost |
| Deployment | Vercel (Hobby/free tier) | Zero-config with Next.js | Fine for demo traffic |
| Eval | RAGAS or custom faithfulness script (run locally/CI) | Differentiator — most portfolio RAGs skip this entirely | No cost — just compute time |

## 4. Architecture (data flow)
```
User question
  → Next.js API route
  → embed query
  → Qdrant hybrid search (dense + keyword) → top-k chunks
  → (optional) rerank
  → build prompt w/ retrieved chunks + citations
  → LLM streams answer
  → answer + source snippets shown in UI
  → user can thumbs up/down → stored in Neon
  → full exchange logged to Neon (conversation_history)
```

## 5. Core Features (must-have)
- Chat UI with **streaming** responses (not a spinner-then-dump)
- **Source citations**: every answer shows which doc chunk(s) it pulled from, with snippet preview
- **Fallback handling**: if retrieval confidence is low, respond "I'm not sure — here's how to reach a human" instead of guessing
- **Hybrid search** in Qdrant (dense + sparse/keyword), not pure cosine similarity
- **Feedback loop**: thumbs up/down per answer, stored in Neon
- **Conversation history**: persisted per session in Neon, not just in-memory
- **Admin panel**: upload/edit KB docs → chunk → embed → push to Qdrant (shows you built the ingestion pipeline, not just the chat)

## 6. Stretch Features (nice-to-have, do if time allows)
- Reranking step (e.g. cohere rerank or cross-encoder) before final context is sent to LLM
- Multi-turn context awareness (follow-up questions reference prior turn)
- Ticket escalation simulation: low-confidence answers auto-create a "ticket" row in Neon
- Simple analytics dashboard: most-asked questions, thumbs-down rate, avg response time

## 7. RAG Pipeline Details
- **Chunking**: semantic/section-based chunking (split by heading/paragraph, not fixed 500-token blocks). Explain this choice in README — it's an easy interview talking point.
- **Embedding**: batch embed on doc upload using Gemini `text-embedding-004` (free), store vector + metadata (doc title, section, url) in Qdrant payload.
- **Retrieval**: top-k = 5, hybrid alpha tunable (dense vs sparse weight).
- **Prompt construction**: system prompt (via Gemini's `systemInstruction`) instructs the model to only answer from provided context, cite chunk IDs, and explicitly say "I don't know" if context is insufficient.
- **Streaming**: use Gemini's `generateContentStream` for token-by-token streaming to the client.
- **Guardrail**: if top retrieval score < threshold, skip LLM call and return fallback message directly (cheaper + safer for demo).

## 8. Evaluation (the differentiator)
- Build a small test set (~20-30 Q&A pairs) against the fake KB.
- Run RAGAS or a custom script scoring: faithfulness, answer relevance, context precision/recall.
- Put the results as a table/chart in the README. This is the single biggest thing that separates this from every other tutorial-clone RAG on GitHub.

## 9. Neon (Postgres) Schema — rough
```sql
docs(id, title, source_url, uploaded_at)
doc_chunks(id, doc_id, content, qdrant_point_id, created_at)
conversations(id, session_id, created_at)
messages(id, conversation_id, role, content, cited_chunk_ids, created_at)
feedback(id, message_id, rating, created_at)
```

## 10. Qdrant Collection — rough
```
collection: support_kb
vector: dense (embedding model dim) + sparse (keyword)
payload: { doc_id, title, section, content, source_url }
```

## 11. API Routes (Next.js)
- `POST /api/chat` — streaming RAG response
- `POST /api/feedback` — log thumbs up/down
- `GET /api/history/:sessionId` — load past messages
- `POST /api/admin/docs` — upload/update KB doc (admin only)
- `POST /api/admin/reindex` — re-chunk + re-embed a doc

## 12. Known Limitations (state these explicitly in README, don't hide them)
- Entire stack runs on free tiers by design — this is a portfolio/demo project, not a production deployment. Say this plainly in the README so it reads as intentional, not accidental.
- Qdrant Cloud free tier ~1GB — fine for a demo-sized KB, mention KB size explicitly
- Neon serverless cold start can add latency on first query after idle — add a loading state so it doesn't look like a bug live
- Gemini free tier has RPM/RPD (requests-per-minute/day) caps — add simple client-side or route-level throttling so a live demo doesn't hit a 429 mid-interview
- Eval set is small/synthetic, not production-scale — say so, it's still more rigor than 95% of portfolio RAGs

## 13. README / Resume Talking Points (write these into the repo README)
- "Chose Qdrant over pgvector for native hybrid search and dedicated vector-DB scaling beyond a single Postgres instance."
- "Implemented semantic chunking over fixed-size chunking to preserve context boundaries."
- "Added a RAGAS evaluation harness to measure faithfulness and retrieval quality — not just a demo, a measured system."
- "Built fallback logic so the agent never hallucinates unsupported answers — escalates instead."

## 14. Build Order (rough milestones)
1. Neon schema + Next.js scaffold + basic chat UI (no RAG yet, just LLM passthrough)
2. Qdrant setup + ingestion pipeline (upload → chunk → embed → store)
3. Wire retrieval into chat, add citations
4. Streaming + fallback/confidence threshold
5. Feedback + conversation history persistence
6. Admin panel for doc management
7. Eval harness + results in README
8. Polish UI, record demo video, write README
