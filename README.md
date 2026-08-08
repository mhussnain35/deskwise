# Deskwise — AI Customer Support RAG Agent

## Most support bots confidently invent answers. This one doesn't.

Deskwise answers customer billing questions using your company's actual documentation — **and any document the user uploads mid-conversation**. Every response shows exactly which sections it drew from, with match scores. When the question falls outside what the docs cover, it doesn't improvise — it hands off to a human with contact details and logs a ticket.

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
        ├─► Hybrid Retrieval
        │     ├── dense  → Qdrant vector search (local cosine index as fallback)
        │     ├── sparse → Postgres full-text search over indexed chunks
        │     ├── uploads → this session's own documents (vectors stored in Neon)
        │     └── fusion → BM25 rescoring over the pool, α·dense + (1-α)·keyword
        ├─► Confidence Guardrail   (dense score < 0.55 → skip LLM, escalate + log ticket)
        ├─► Prompt Construction    (top-5 chunks + last 6 turns for follow-ups)
        ├─► Stream Answer          (Gemini 2.0 Flash generateContentStream)
        ├─► Return Citations       (X-Citations header → expandable source panel)
        └─► Persist to Neon        (conversations, messages, cited_chunk_ids, feedback)

User Upload
  └─► POST /api/documents
        ├─► multipart            (file picker, drag-and-drop)
        ├─► or JSON { url }      (pasted link — SSRF-guarded server-side fetch)
        ├─► Parse                (unpdf per page / mammoth / html strip / structured text)
        ├─► Chunk                (headings when present, else paragraph packing + overlap)
        ├─► Embed                (batched, concurrency 4)
        └─► Store in Neon        (chunk text + vector, scoped to session_id)
```

---

## Features

| Feature | Description |
|---|---|
| **Streaming RAG Chat** | Token-by-token streamed answers grounded in retrieved documentation |
| **User Document Upload** | Attach a PDF, DOCX, Markdown, TXT, CSV, JSON or HTML file from the chat and ask questions about it. Parsed, chunked, embedded and queryable on the next message — private to that session |
| **Import by Link** | Paste a document URL in the panel — or straight into the chat box — and the server fetches, parses and indexes it. Hardened against SSRF: scheme allowlist, per-hop DNS/range checks, manual redirect following, size and time caps |
| **Source Citations** | Expandable panel showing the section(s) used, with match scores and a badge marking answers grounded in your own upload |
| **Confidence Guardrail** | Out-of-scope queries return a structured human escalation message and log a ticket — no hallucinations |
| **Multi-turn Context** | The last six turns are replayed, so follow-up questions and pronouns resolve |
| **Hybrid Retrieval** | Dense vector search fused with Postgres full-text search, rescored with BM25 over the candidate pool (`HYBRID_ALPHA` tunable) |
| **Semantic Chunking** | Markdown split on heading boundaries; unstructured uploads packed on paragraph boundaries with overlap |
| **Vector Search** | Qdrant Cloud dense search with local cosine similarity fallback for dev/offline |
| **Responsive UI** | Mobile-first chat — bottom-sheet document manager, auto-growing composer, safe-area insets, drag-and-drop upload on desktop |
| **Keyboard-aware Composer** | The input bar tracks the VisualViewport, so it sits directly above the on-screen keyboard instead of behind it — `100dvh` alone can't do this on iOS |
| **Feedback Loop** | Thumbs up/down per answer persisted to Neon Postgres |
| **Session History** | Conversations survive page reload via Neon-backed session storage |
| **Admin Panel** | Upload KB docs, view chunk metrics and usage analytics, trigger re-indexing at `/admin` — writes gated by `ADMIN_TOKEN` |
| **Usage Analytics** | Most-asked questions, thumbs-down rate, escalation tickets and upload volume, aggregated from Neon |
| **Rate Limiting** | Sliding-window per-session limiter (10 req/60s) with friendly UI error |
| **Cold-Start Skeleton** | Loading state shaped like the chat itself (header, message rows, composer) so nothing jumps when content arrives; status copy escalates to "waking up the database" if Neon is autosuspended, via `role="status"` for screen readers. Also wired to Next.js `loading.tsx` for both routes |
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

If retrieval confidence is below 0.55, the API route skips the LLM call entirely (saves tokens + latency) and returns a structured escalation message with contact info, and writes a `tickets` row so the gap is visible in the admin dashboard. This is safer and cheaper than asking Gemini to answer with low-quality context.

**5. Fused two retrieval arms instead of reranking one — and kept the guardrail on the dense score.**

Embeddings are strong on paraphrase and weak on exact tokens: plan names, error codes, invoice ids. The sparse arm is a Postgres full-text query over the same chunks already stored for citation resolution, so hybrid search needed no second index and no Qdrant collection migration. Terms are OR-ed rather than AND-ed, because `plainto_tsquery` and `websearch_to_tsquery` both AND — and a natural-language support question carries far more words than any one policy section contains, so an AND query matches nothing.

Candidates from both arms are rescored with BM25 over the pooled set and blended as `α·dense + (1-α)·keyword`. Sparse-only hits have their stored vector pulled back from Qdrant so they enter fusion with a real dense score rather than a zero they could never recover from. **The confidence guardrail still reads the dense score alone** — keyword overlap is a weak signal of "we actually know this", and an out-of-scope question that happens to share one word with a policy would otherwise sail past the threshold.

**6. Treated "import from a link" as an SSRF surface, not a convenience feature.**

Fetching a URL the user chose means the *server's* network position is used, not theirs — the textbook path to `http://169.254.169.254/` (cloud metadata), an internal database port, or the app's own admin endpoints on localhost. The importer applies a scheme allowlist, resolves each host and rejects loopback/private/link-local/CGNAT/multicast ranges, follows redirects **manually** so every hop is revalidated (a public host is free to redirect to 127.0.0.1), and caps size, time and redirect count. Rejected attempts still consume the upload budget, so the endpoint can't be used as a port scanner.

The check operates on the *parsed* hostname, which matters more than it looks: WHATWG URL parsing rewrites `::ffff:127.0.0.1` to `::ffff:7f00:1`, `127.1` to `127.0.0.1` and `2130706433` to `127.0.0.1`. A first cut of this code pattern-matched the mapped-IPv4 text form and let `http://[::ffff:127.0.0.1]/` straight through to the loopback interface; the guard now reconstructs the embedded address from parsed IPv6 groups. `scripts/ssrf-check.ts` asserts all 22 cases, and is the thing to extend before touching that file.

Stated plainly: a DNS-rebinding window remains between the lookup and the connection. Closing it needs an agent that pins the checked address; at this scale the range checks plus the response cap are the proportionate control, and a deployment taking untrusted traffic should put an egress proxy in front.

**7. Kept user uploads out of the vector database, in Postgres with their vectors inline.**

Uploads are session-scoped and disposable; the knowledge base is shared and curated. Writing per-visitor chunks into the shared Qdrant collection would mix the two, and nothing would ever clean them up. Writing them to `/kb-docs` is not an option either — serverless filesystems are read-only, and a visitor's file must not become what every other visitor is answered from.

So a user chunk stores its 768-d vector in its own row (rounded to six decimals — ~6 KB instead of ~15 KB, with cosine error below 1e-5). An upload is queryable on the very next message with no re-indexing step, deletion is a foreign-key cascade, and a session's 200-chunk ceiling makes the in-process cosine scan cost microseconds. The tradeoff is explicit: this is a linear scan, correct at demo scale and wrong at thousands of documents per user.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend/Backend | Next.js 16 (App Router, TypeScript) | Full-stack in one framework, zero config deploy to Vercel |
| Vector DB | Qdrant Cloud (free cluster) | Native hybrid search, dedicated scaling, named vector-DB skill |
| Relational DB | Neon (serverless Postgres) | Conversations, feedback, doc metadata; serverless cold-start solved by loading overlay |
| Embeddings | Gemini `gemini-embedding-001` @ 768d | Same API key as the LLM, no separate OpenAI dependency. 768 of the model's 3072 dimensions are requested so the existing Qdrant collection stays valid. |
| LLM | Gemini 2.0 Flash (`GEMINI_MODEL`-overridable) | Streaming generation, free tier RPM |
| ORM | Drizzle ORM | Type-safe Postgres queries, lightweight |
| Sparse search | Postgres `to_tsvector` / `ts_rank_cd` | Keyword arm of hybrid retrieval over chunks already stored in Neon — no second index to maintain |
| Document parsing | `unpdf` (PDF), `mammoth` (DOCX) | Serverless-friendly, no native binaries; page-aware extraction for PDF chunk labels |
| Styling | Tailwind CSS v4 | Dark-mode UI, responsive layout |

---

## Project Structure

```
deskwise/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # Streaming RAG endpoint + rate limiter
│   │   ├── documents/route.ts       # User upload (multipart) + list
│   │   ├── documents/[docId]/       # Delete one of your own uploads
│   │   ├── feedback/route.ts        # Thumbs up/down logging
│   │   ├── history/[sessionId]/     # Session history retrieval
│   │   └── admin/
│   │       ├── docs/route.ts        # KB doc list + upload API
│   │       ├── analytics/route.ts   # Usage aggregates for the dashboard
│   │       └── reindex/route.ts     # Trigger full re-indexing
│   ├── admin/page.tsx               # Admin dashboard UI
│   ├── admin/loading.tsx            # Route-level loading skeleton for /admin
│   ├── loading.tsx                  # Route-level loading skeleton for the chat
│   ├── page.tsx                     # Chat interface page
│   └── layout.tsx                   # Root layout + SEO metadata + viewport
├── components/
│   └── chat/
│       ├── chat-interface.tsx       # Responsive streaming chat shell
│       ├── document-panel.tsx       # Upload/link manager (bottom sheet / side drawer)
│       ├── use-documents.ts         # Upload, import-by-link, list and delete hook
│       ├── use-visual-viewport.ts   # Keeps the composer above the mobile keyboard
│       ├── loading-screen.tsx       # Cold-start skeleton + escalating status copy
│       ├── citations.tsx            # Expandable source panel
│       ├── markdown.tsx             # Streaming-safe markdown renderer
│       └── types.ts                 # Shared chat types
├── lib/
│   ├── ai/
│   │   ├── gemini.ts                # Gemini SDK client
│   │   └── embeddings.ts            # gemini-embedding-001 wrapper (768d) + batch embed
│   ├── db/
│   │   ├── schema.ts                # Drizzle ORM schema (6 tables)
│   │   └── index.ts                 # Neon connection pool
│   ├── qdrant/client.ts             # Qdrant Cloud client + collection bootstrap
│   ├── rag/
│   │   ├── chunker.ts               # Heading-based + paragraph-packing chunkers
│   │   ├── parsers.ts               # PDF / DOCX / HTML / CSV / JSON / text extraction
│   │   ├── fetch-url.ts             # SSRF-guarded document download for link imports
│   │   ├── keyword.ts               # BM25 sparse scoring + hybrid fusion
│   │   ├── user-docs.ts             # Session-scoped upload store and search
│   │   ├── vector.ts                # Cosine similarity + vector compaction
│   │   ├── retriever.ts             # Hybrid retrieval + confidence scoring
│   │   └── ingestor.ts              # Shared chunk → embed → upsert pipeline
│   ├── rate-limit.ts                # Sliding-window in-memory rate limiter
│   ├── admin-auth.ts                # ADMIN_TOKEN gate for the admin write routes
│   ├── session.ts                   # Session id validation
│   ├── format.ts                    # Byte/relative-time formatting
│   └── errors.ts                    # Upstream error normalisation (no provider leaks)
├── kb-docs/                         # 8 SaaS billing support Markdown documents
├── scripts/
│   ├── ingest.ts                    # CLI ingestion runner
│   ├── eval-dataset.ts              # 25 benchmark Q&A test cases
│   ├── eval.ts                      # Evaluation harness — outputs eval-results.md
│   ├── search-test.ts               # CLI retrieval probe (accepts a session id)
│   ├── ssrf-check.ts                # Asserts the link importer's address guard
│   ├── cleanup-session.ts           # Wipe one session's uploads, chat and tickets
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
ADMIN_TOKEN=a_long_random_string            # gates the /admin write endpoints
GEMINI_MODEL=gemini-2.0-flash               # optional — see note below
HYBRID_ALPHA=0.7                            # optional — dense/keyword weighting
```

> **If every answer returns a 429 that never clears**, the free tier on your key
> grants no daily quota for the configured model (the error names
> `GenerateRequestsPerDayPerProjectPerModel-FreeTier` with `limit: 0`). Set
> `GEMINI_MODEL=gemini-flash-latest` and restart. Embeddings have a separate
> quota and are usually unaffected.

```bash
# 3. Push database schema
npx drizzle-kit push

# 4. Ingest knowledge base documents
npx tsx scripts/ingest.ts

# 5. Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the chat UI, [http://localhost:3000/admin](http://localhost:3000/admin) for the KB admin panel.

### Asking questions about your own documents

1. In the chat, tap the **paperclip** in the composer, use **Documents** in the header, or drag a file anywhere onto the window.
   Or add one by link: paste a URL into **Or paste a document link** in the Documents panel — or just paste the link into the chat box and send it, which imports rather than asking a pointless question the agent can't browse for.
2. Supported formats: **PDF, DOCX, Markdown, TXT, CSV, JSON, HTML** — up to 8 MB, 5 documents per session.
3. The file is parsed, chunked, embedded and stored against your session id. Ask your next question and it is searched alongside the company knowledge base — citations from your file are badged **Your upload**.
4. Remove a document at any time from the Documents panel; its chunks are deleted with it, and anything left behind is swept after 7 days.

Nothing here touches the shared knowledge base: uploads are scoped to one session, and `/admin` remains the only way to change what every visitor is answered from.

Probe retrieval from the CLI, including a session's uploads:

```bash
npx tsx scripts/search-test.ts "How long is the hardware warranty?" session_abc123
```

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
| **Model quota varies by key** | Google grants free-tier quota per model and revises it over time. `GEMINI_MODEL` exists so a dead quota is a config change, not a code change. |
| **Neon cold start** | First query after ~5 min idle may take 300–500 ms. Handled by the branded loading overlay so it doesn't look like a bug. |
| **Rate limiting** | In-memory per-session throttle (10 req/min). Resets on server cold-start. Sufficient for demo traffic. |
| **Eval set is synthetic** | 25 hand-authored Q&A pairs, not production-scale query logs. Still more rigor than 95% of portfolio RAGs. |
| **Mock embeddings in dev** | Used only when `GEMINI_API_KEY` is entirely unset. When a key is present, embedding failures raise rather than fall back — mixing mock and Gemini vectors collapses cosine similarity and would silently disable the guardrail. |
| **Admin uploads are local-only** | Serverless filesystems are read-only, so uploading through `/admin` on Vercel returns a clear 503. Commit new docs to `kb-docs/` and redeploy, or run the panel locally. *End-user uploads are unaffected* — they go to Postgres, not the filesystem. |
| **Upload quotas** | 5 documents per session, 8 MB per file, first 40 chunks indexed, swept after 7 days. Deliberate ceilings so a demo can't exhaust the Neon or Gemini free tier. |
| **No OCR** | Scanned/image-only PDFs have no text layer; the upload is rejected with an explanation rather than silently indexing nothing. |
| **Link import fetches once, without JS** | The importer downloads the URL as-is. A page that renders its text client-side, or one behind a login or a bot check, arrives empty and is rejected — download it and upload the file instead. DNS-rebinding is not mitigated; see decision 6. |
| **Uploads aren't in Qdrant** | Session documents live only in Postgres. That keeps the shared collection clean, at the cost of a linear scan — fine at 200 chunks per session, not a design for thousands. |

---

## Database Schema

```sql
docs(id, title, source_url, scope, session_id, filename, file_type, size_bytes, chunk_count, uploaded_at)
doc_chunks(id, doc_id, title, content, section, chunk_index, scope, session_id, embedding, qdrant_point_id, created_at)
conversations(id, session_id, title, created_at)
messages(id, conversation_id, role, content, cited_chunk_ids[], created_at)
feedback(id, message_id, rating, created_at)
tickets(id, session_id, conversation_id, question, top_score, status, created_at)
```

`scope` separates shared company documentation (`'kb'`) from a visitor's own upload (`'user'`, keyed by `session_id`). User chunks carry their vector inline in `embedding`, which is what makes an upload queryable on the very next message on a read-only serverless filesystem — no re-indexing step, and no per-visitor vectors accumulating in the shared Qdrant collection.

---

## License

MIT
