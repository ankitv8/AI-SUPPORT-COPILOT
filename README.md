# AI Support Copilot

Upload any file and chat with AI about it — like ChatGPT, but every answer is grounded in your upload with source citations.

## Features

| Capability | Description |
| --- | --- |
| **File upload** | Up to 2 files per browser session; PDF, text, JSON, Markdown, CSV, HTML; max 5 MB each |
| **AI chat** | ChatGPT-style streaming chat grounded in your files |
| **Hybrid RAG** | Vector + BM25 keyword search |
| **Source citations** | Every answer links back to your uploaded file |
| **Usage dashboard** | Estimated provider usage at `/usage` — tracked locally |

## Routes

| Route | Description |
| --- | --- |
| `/` | Landing page |
| `/chat` | Sign in, upload up to 2 files, and chat with AI Support Copilot |
| `/usage` | Account token budget and local estimated usage & cost dashboard |
| `/docs` | Product guide |
| `/api/health` | Weaviate readiness status (`{ "ok": true|false }`) |

## Getting started

```bash
npm install
cp .env.example .env.local
# Set GROQ_API_KEY and DATABASE_URL in .env.local.
# Embeddings run locally; no Hugging Face token is needed.
npm run dev
```

Open **http://localhost:3010**

The first upload downloads the embedding model and can take longer than later uploads. On Vercel, the model is cached under `/tmp/models` for the lifetime of a function instance.

> **Screenshot placeholder:** Add a screenshot of the `/chat` page here.

## Architecture

- **Main chat flow** — `/chat` renders `ChatExperience` and `SupportCopilot`; the client sends messages to `POST /api/chat`; `lib/api/chatHandler.js` authenticates the account, checks usage and document ownership, retrieves context, applies guardrails, and streams Groq responses.
- **Health status** — `GET /api/health` checks Weaviate readiness without returning its URL or credentials; the upload panel displays a friendly service warning if it is unavailable.
- **Retrieval and AI** — `lib/rag/` handles document chunking, embeddings, and hybrid search; `lib/ai/` handles prompts, model calls, and agent behavior.
- **Application areas** — `app/` contains routes and API endpoints; `components/` contains UI; `lib/` contains reusable application logic; `platform/` contains product/runtime configuration and adapters; `stores/` contains client state.
- **Document endpoints** — `POST /api/demo/parse` extracts PDF text; `POST /api/demo/ingest` chunks and embeds an upload, persisting chunks in Weaviate when configured.
- **Browser storage** — document text and local fallback embeddings (`sessionStorage`), usage dashboard history (`IndexedDB`)
- **Authentication** — sign-in is required for chat, uploads, parsing, and account usage; PostgreSQL stores sessions, document ownership, and token totals
- **Optional Weaviate** — persistent hybrid BM25 + dense-vector retrieval when `WEAVIATE_URL` is configured
- **Optional managed guardrails** — input and output safety checks through a language-agnostic HTTP endpoint
- **Lakera Guard** — optional prompt-injection checks for user prompts, retrieved context, and model output
- **PostgreSQL auth** — required for user accounts, sessions, document ownership, and usage tracking

The `/api/demo/*` endpoints and `lib/demo/` modules power the browser-backed upload and chat experience; “demo” is a legacy route/module naming convention, not anonymous access. A valid `DATABASE_URL` and signed-in account are required for chat, parsing, ingestion, deletion, and usage-budget requests. The chat route takes a PostgreSQL advisory lock per account for the duration of a request, including the response stream; a second simultaneous chat for the same account receives HTTP 429 and `Retry-After: 5` rather than racing the budget check. Weaviate persistence and managed guardrails remain optional. Embeddings use `Xenova/bge-small-en-v1.5` locally (384 dimensions); if model loading fails, upload still stores text and chat falls back to BM25 keyword retrieval. Each document is capped at 100 chunks and 500,000 characters; each browser session accepts at most 2 files, up to 5 MB each.

## Deploy

Works on [Vercel](https://vercel.com) or any Node host that runs Next.js. Set `GROQ_API_KEY` for chat. Embeddings run locally and do not require paid Hugging Face Inference credits or an HF token. For persistent vector storage, configure a managed Weaviate deployment with `WEAVIATE_URL` and `WEAVIATE_API_KEY`. Configure `LAKERA_API_KEY` for optional managed prompt-injection checks.

| Variable | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Groq API key |
| `GROQ_CHAT_MODEL` | No | Default `openai/gpt-oss-120b` |
| `WEAVIATE_URL` | No | Weaviate endpoint; enables persistent hybrid retrieval |
| `WEAVIATE_API_KEY` | No | Weaviate API key, when required by the endpoint |
| `WEAVIATE_CLASS` | No | Default `SupportChunk` |
| `WEAVIATE_HYBRID_ALPHA` | No | Hybrid weighting from `0` (BM25) to `1` (vector), default `0.6` |
| `LAKERA_API_KEY` | No | Lakera Guard API key; enables input/output checks |
| `LAKERA_GUARD_URL` | No | Default `https://api.lakera.ai/v2/guard` |
| `GUARDRAIL_TIMEOUT_MS` | No | Guardrail request timeout, default `4000` |
| `GUARDRAIL_FAIL_OPEN` | No | Set `true` only if availability is preferred over blocking |
| `DATABASE_URL` | Yes | PostgreSQL connection string; required for authentication, ownership, usage, and per-account chat serialization |
| `USER_TOKEN_BUDGET` | No | Authenticated-user token limit; code default `100000` (the provided `.env.example` sets `200000`) |

### Guardrail endpoint contract

The application calls the configured endpoint with a JSON body containing `type` (`input` or `output`), `text`, and optional retrieved `context`. The endpoint should return JSON containing `allowed: true|false`, with optional `reason` and `categories` fields. This keeps the application independent of a specific managed provider; expose Azure AI Content Safety, Lakera, Bedrock Guardrails, or an internal adapter behind this contract.

Document ingestion happens through `/api/demo/ingest`, not during chat. Each upload is associated with its authenticated owner. When `WEAVIATE_URL` is configured and chunks are successfully persisted, chat performs hybrid retrieval from Weaviate, scoped to the current user's uploaded source IDs. Otherwise, embedded chunks and extracted text stay with the browser's session documents and local retrieval uses vector + BM25 search (or BM25 alone if embedding generation fails). PostgreSQL stores accounts, sessions, document ownership metadata, and per-account token totals; it does not store document text. The first embedding-model load can be slow. Scanned/image-only PDFs can fail extraction, and files with fewer than 20 characters of extracted text are rejected. The API rate limiter is process-local, so limits are not globally coordinated across serverless instances; fallback document text is scoped to browser session storage. A PostgreSQL outage prevents authenticated operations; there is no guest fallback.

## License

MIT — see [LICENSE](./LICENSE).
