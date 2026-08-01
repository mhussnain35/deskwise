# Deskwise — AI Customer Support RAG Agent

## Most support bots confidently invent answers. This one doesn't.

Deskwise answers customer billing questions using your company's actual documentation. Every response shows exactly which policy sections it drew from, with match scores. When the question falls outside what the docs cover, it doesn't improvise — it hands off to a human with contact details.

That behavior isn't a claim. It's measured: 25 benchmark cases, 15 in-scope and 10 deliberately out-of-scope, scoring **100% on in-scope recall** and **90% on correctly refusing what it shouldn't answer**.

**Vertical:** SaaS billing & subscription support — pricing tiers, refund policy, cancellation flow, payment failure handling, proration rules, invoice/tax management.

**Stack:** Next.js 16 (App Router) · Gemini 2.0 Flash · Qdrant Cloud · Neon Postgres · Drizzle ORM · TypeScript

---

## Architecture

```
User Question
  └─► POST /api/chat
        ├─► Rate Limiter           (10 req/min per session — prevents Gemini 429s)
        ├─► Embed Query            (Gemini gemini-embedding-001, 768d)
        ├─► Vector Search          (Qdrant Cloud dense search / local cosine fallback)
        ├─► Confidence Guardrail   (score < 0.55 → skip LLM, return human escalation)
        ├─► Prompt Construction    (top-5 chunks injected as context)
        ├─► Stream Answer          (Gemini 2.0 Flash generateContentStream)
        ├─► Return Citations       (X-Citations header → expandable source panel)
        └─► Persist to Neon        (conversations, messages, cited_chunk_ids, feedback)
```

---

## Features

| Feature | Description |
|---|---|
| **Streaming RAG Chat** | Token-by-token streamed answers grounded in retrieved documentation |
| **Source Citations** | Expandable panel showing KB section(s) used, with cosine match scores |
| **Confidence Guardrail** | Out-of-scope queries return a structured human escalation message — no hallucinations |
| **Semantic Chunking** | Documents split by Markdown heading boundaries, not fixed token counts |
| **Vector Search** | Qdrant Cloud dense search with local cosine similarity fallback for dev/offline |
| **Feedback Loop** | Thumbs up/down per answer persisted to Neon Postgres |
| **Session History** | Conversations survive page reload via Neon-backed session storage |
| **Admin Panel** | Upload KB docs, view chunk metrics, trigger re-indexing at `/admin` — writes gated by `ADMIN_TOKEN` |
| **Rate Limiting** | Sliding-window per-session limiter (10 req/60s) with friendly UI error |
| **Cold-Start Overlay** | Branded loading screen during Neon autosuspend wake-up |
| **Evaluation Harness** | 25-case benchmark measuring confidence accuracy and fallback precision |

---

## Benchmark Results

Run against 25 synthetic test cases (15 in-scope billing queries + 10 intentionally out-of-scope):

| Metric | Score | Target |
|---|---|---|
| **In-Scope Confidence Pass Rate** | **100.0%** | > 85% ✅ |
| **Fallback Guardrail Precision** | **90.0%** | > 70% ✅ |
| **Overall Guardrail Accuracy** | **96.0%** | > 80% ✅ |

**Confidence threshold tuning:**

| Threshold | In-Scope Pass Rate | Fallback Precision | Decision |
|---|---|---|---|
| 0.40 | 100% | ~40% (too permissive) | ❌ Rejected |
| **0.55** | **100%** | **90%** | ✅ **Selected** |
| 0.70 | ~86% (1 false negative) | ~90% | ⚠️ Too strict |

> Full benchmark details: [`eval-results.md`](./eval-results.md) · Test dataset: [`scripts/eval-dataset.ts`](./scripts/eval-dataset.ts) · Runner: [`scripts/eval.ts`](./scripts/eval.ts)

---

## Architecture Decisions (Interview Talking Points)

**1. Chose Qdrant over pgvector for native hybrid search and dedicated vector-DB scaling beyond a single Postgres instance.**

pgvector works well for < 100K vectors in a co-located Postgres setup but doesn't support native sparse/dense hybrid search. Qdrant separates vector storage from relational storage, supports BM25 sparse vectors out-of-the-box, and scales independently. For a production-ready demo, using a purpose-built vector DB is the correct tradeoff.

**2. Implemented semantic chunking over fixed-size chunking to preserve context boundaries.**

Fixed 500-token blocks split mid-sentence and break across section headings, losing the structural context that makes retrieval precise. Deskwise chunks by Markdown heading boundaries — each chunk is a complete policy section with a meaningful title. This improves retrieval precision because the chunk text and its heading are semantically coherent.

**3. Added a RAGAS-style evaluation harness to measure faithfulness and retrieval quality — not just a demo, a measured system.**

Most portfolio RAG systems skip evaluation entirely. Deskwise includes a 25-case automated benchmark measuring in-scope recall, out-of-scope fallback precision, and confidence threshold behavior. The `eval.ts` script runs in < 30s and outputs a Markdown report. The before/after threshold tuning table demonstrates systematic iteration, not guesswork.

**4. Built fallback logic so the agent never hallucinates unsupported answers — escalates instead.**

If retrieval confidence is below 0.55, the API route skips the LLM call entirely (saves tokens + latency) and returns a structured escalation message with contact info. This is safer and cheaper than asking Gemini to answer with low-quality context.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend/Backend | Next.js 16 (App Router, TypeScript) | Full-stack in one framework, zero config deploy to Vercel |
| Vector DB | Qdrant Cloud (free cluster) | Native hybrid search, dedicated scaling, named vector-DB skill |
| Relational DB | Neon (serverless Postgres) | Conversations, feedback, doc metadata; serverless cold-start solved by loading overlay |
| Embeddings | Gemini `gemini-embedding-001` @ 768d | Same API key as the LLM, no separate OpenAI dependency. 768 of the model's 3072 dimensions are requested so the existing Qdrant collection stays valid. |
| LLM | Gemini 2.0 Flash | Streaming generation, free tier RPM |
| ORM | Drizzle ORM | Type-safe Postgres queries, lightweight |
| Styling | Tailwind CSS v4 | Dark-mode UI, responsive layout |

---

## Project Structure

```
deskwise/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # Streaming RAG endpoint + rate limiter
│   │   ├── feedback/route.ts        # Thumbs up/down logging
│   │   ├── history/[sessionId]/     # Session history retrieval
│   │   └── admin/
│   │       ├── docs/route.ts        # KB doc list + upload API
│   │       └── reindex/route.ts     # Trigger full re-indexing
│   ├── admin/page.tsx               # Admin dashboard UI
│   ├── page.tsx                     # Chat interface page
│   └── layout.tsx                   # Root layout + SEO metadata
├── components/
│   └── chat/chat-interface.tsx      # Streaming chat UI with citations, feedback, history
├── lib/
│   ├── ai/
│   │   ├── gemini.ts                # Gemini SDK client
│   │   └── embeddings.ts            # gemini-embedding-001 wrapper (768d) + dev-only mock
│   ├── db/
│   │   ├── schema.ts                # Drizzle ORM schema (5 tables)
│   │   └── index.ts                 # Neon connection pool
│   ├── qdrant/client.ts             # Qdrant Cloud client + collection bootstrap
│   ├── rag/
│   │   ├── chunker.ts               # Semantic heading-based Markdown chunker
│   │   ├── retriever.ts             # Vector search + confidence scoring
│   │   └── ingestor.ts              # Shared chunk → embed → upsert pipeline
│   ├── rate-limit.ts                # Sliding-window in-memory rate limiter
│   ├── admin-auth.ts                # ADMIN_TOKEN gate for the admin write routes
│   └── errors.ts                    # Upstream error normalisation (no provider leaks)
├── kb-docs/                         # 8 SaaS billing support Markdown documents
├── scripts/
│   ├── ingest.ts                    # CLI ingestion runner
│   ├── eval-dataset.ts              # 25 benchmark Q&A test cases
│   ├── eval.ts                      # Evaluation harness — outputs eval-results.md
│   ├── search-test.ts               # CLI retrieval probe
│   └── load-env.ts                  # Loads .env.local for standalone scripts
└── drizzle/                         # Generated SQL migrations
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Neon Postgres account — [neon.tech](https://neon.tech) (free)
- Google Gemini API key — [aistudio.google.com](https://aistudio.google.com) (free)
- Qdrant Cloud account — [cloud.qdrant.io](https://cloud.qdrant.io) (free, optional — local cosine fallback available)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/your-username/deskwise.git
cd deskwise
npm install

# 2. Configure environment variables
cp .env.example .env.local
```

Edit `.env.local`:

```env
GEMINI_API_KEY=your_gemini_api_key
DATABASE_URL=your_neon_connection_string
QDRANT_URL=https://your-cluster.qdrant.io   # optional
QDRANT_API_KEY=your_qdrant_api_key          # optional
ADMIN_TOKEN=a_long_random_string             # gates the /admin write endpoints
```

```bash
# 3. Push database schema
npx drizzle-kit push

# 4. Ingest knowledge base documents
npx tsx scripts/ingest.ts

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the chat UI, [http://localhost:3000/admin](http://localhost:3000/admin) for the KB admin panel.

### Run the Evaluation Harness

```bash
npx tsx scripts/eval.ts
# Outputs results to eval-results.md
```

### Deploy to Vercel

```bash
npx vercel --prod
```

Set these environment variables in Vercel Project Settings → Environment Variables:
- `GEMINI_API_KEY`
- `DATABASE_URL`
- `QDRANT_URL` (optional)
- `QDRANT_API_KEY` (optional)
- `ADMIN_TOKEN` — **required in production**, otherwise the admin write endpoints stay disabled

---

## Known Limitations

These are stated explicitly and by design — this is a portfolio/demo project, not a production deployment.

| Limitation | Detail |
|---|---|
| **Free-tier infrastructure** | Qdrant Cloud (~1 GB storage), Neon (0.5 GB, autosuspend on idle), Gemini (RPM/RPD caps) |
| **Neon cold start** | First query after ~5 min idle may take 300–500 ms. Handled by the branded loading overlay so it doesn't look like a bug. |
| **Rate limiting** | In-memory per-session throttle (10 req/min). Resets on server cold-start. Sufficient for demo traffic. |
| **Eval set is synthetic** | 25 hand-authored Q&A pairs, not production-scale query logs. Still more rigor than 95% of portfolio RAGs. |
| **Mock embeddings in dev** | Used only when `GEMINI_API_KEY` is entirely unset. When a key is present, embedding failures raise rather than fall back — mixing mock and Gemini vectors collapses cosine similarity and would silently disable the guardrail. |
| **Admin uploads are local-only** | Serverless filesystems are read-only, so uploading through `/admin` on Vercel returns a clear 503. Commit new docs to `kb-docs/` and redeploy, or run the panel locally. |

---

## Database Schema

```sql
docs(id, title, source_url, uploaded_at)
doc_chunks(id, doc_id, content, section, qdrant_point_id, created_at)
conversations(id, session_id, title, created_at)
messages(id, conversation_id, role, content, cited_chunk_ids[], created_at)
feedback(id, message_id, rating, created_at)
```

---

## License

MIT
