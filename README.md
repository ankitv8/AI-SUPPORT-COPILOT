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
# Set GROQ_API_KEY, DATABASE_URL, and JINA_API_KEY in .env.local.
npm run dev
```

Open **http://localhost:3010**

Embeddings are generated through the Jina AI API; no local model download or ONNX runtime is required.

> **Screenshot placeholder:** Add a screenshot of the `/chat` page here.

## Architecture

- **Main chat flow** — `/chat` renders `ChatExperience` and `SupportCopilot`; the client sends messages to `POST /api/chat`; `lib/api/chatHandler.js` authenticates the account, checks usage and document ownership, retrieves context, applies guardrails, and streams Groq responses.
- **Health status** — `GET /api/health` checks Weaviate readiness without returning its URL or credentials; the upload panel displays a friendly service warning if it is unavailable.
- **Retrieval and AI** — `lib/rag/` handles document chunking, embeddings, and hybrid search; `lib/ai/` handles prompts, model calls, and agent behavior.
- **Application areas** — `app/` contains routes and API endpoints; `components/` contains UI; `lib/` contains reusable application logic; `platform/` contains product/runtime configuration and adapters; `stores/` contains client state.
- **Document endpoints** — `POST /api/demo/parse` extracts PDF text; `POST /api/demo/ingest` chunks and embeds an upload, requiring successful persistence of text and vectors in Weaviate.
- **Browser storage** — upload history for the current browser session (`sessionStorage`), usage dashboard history (`IndexedDB`)
- **Authentication** — sign-in is required for chat, uploads, parsing, and account usage; PostgreSQL stores sessions, document ownership, and token totals
- **Weaviate** — required persistent storage for document text and dense vectors; hybrid retrieval reads from the signed-in user's sources
- **Optional managed guardrails** — input and output safety checks through a language-agnostic HTTP endpoint
- **Lakera Guard** — optional prompt-injection checks for user prompts, retrieved context, and model output
- **PostgreSQL auth** — required for user accounts, sessions, document ownership, and usage tracking

The `/api/demo/*` endpoints and `lib/demo/` modules power the authenticated upload and chat experience; “demo” is a legacy route/module naming convention, not anonymous access. A valid `DATABASE_URL`, `WEAVIATE_URL`, `JINA_API_KEY`, and signed-in account are required for chat and uploads. `WEAVIATE_API_KEY` is required when the selected Weaviate endpoint requires authentication. An upload is rejected unless every chunk receives a valid embedding and both its text and vector are persisted in Weaviate; it never reports success for a text-only fallback. The chat route takes a PostgreSQL advisory lock per account for the duration of a request, including the response stream; a second simultaneous chat for the same account receives HTTP 429 and `Retry-After: 5` rather than racing the budget check. Managed guardrails remain optional. Embeddings use Jina AI's hosted `jina-embeddings-v3` model (768 dimensions) with task-specific batched requests. Each document is capped at 100 chunks and 500,000 characters; each browser session accepts at most 2 files, up to 5 MB each.

## Deploy

Works on [Vercel](https://vercel.com) or any Node host that runs Next.js. Set `GROQ_API_KEY`, `DATABASE_URL`, `WEAVIATE_URL`, and `JINA_API_KEY` in the deployment environment. Jina API availability, free allowances, and charges depend on your Jina account and plan. Add `WEAVIATE_API_KEY` if required by the managed Weaviate endpoint. Configure `LAKERA_API_KEY` for optional managed prompt-injection checks.

Add `JINA_API_KEY` in Vercel under **Project Settings → Environment Variables** for Production, Preview, and Development, then redeploy. Jina API usage may incur charges and is not included in the app's model-price estimates.

| Variable | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Groq API key |
| `GROQ_CHAT_MODEL` | No | Default `openai/gpt-oss-120b` |
| `JINA_API_KEY` | Yes | Jina AI API key for the Embeddings API |
| `WEAVIATE_URL` | Yes | Weaviate endpoint; required for durable document text and vector storage |
| `WEAVIATE_API_KEY` | No | Weaviate API key, when required by the endpoint |
| `WEAVIATE_CLASS` | No | Default `SupportChunk` |
| `WEAVIATE_HYBRID_ALPHA` | No | Hybrid weighting from `0` (BM25) to `1` (vector), default `0.6` |
| `LAKERA_API_KEY` | No | Lakera Guard API key; enables input/output checks |
| `LAKERA_GUARD_URL` | No | Default `https://api.lakera.ai/v2/guard` |
| `GUARDRAIL_TIMEOUT_MS` | No | Guardrail request timeout, default `4000` |
| `GUARDRAIL_FAIL_OPEN` | No | Set `true` only if availability is preferred over blocking |
| `DATABASE_POSTGRES_PRISMA_URL` | No | Preferred pooled PostgreSQL connection string on Vercel/serverless; takes precedence over `DATABASE_URL` |
| `DATABASE_URL` | Yes | PostgreSQL connection string fallback; required for authentication, ownership, usage, and per-account chat serialization |
| `USER_TOKEN_BUDGET` | No | Authenticated-user token limit; code default `100000` (the provided `.env.example` sets `200000`) |

### Guardrail endpoint contract

The application calls the configured endpoint with a JSON body containing `type` (`input` or `output`), `text`, and optional retrieved `context`. The endpoint should return JSON containing `allowed: true|false`, with optional `reason` and `categories` fields. This keeps the application independent of a specific managed provider; expose Azure AI Content Safety, Lakera, Bedrock Guardrails, or an internal adapter behind this contract.

Document ingestion happens through `/api/demo/ingest`, not during chat. Each upload is associated with its authenticated owner. Every document chunk's text and generated vector must be persisted to Weaviate before the upload is reported successful; there is no text-only fallback. Chat performs hybrid retrieval from Weaviate, scoped to the current user's uploaded source IDs. PostgreSQL stores accounts, sessions, document ownership metadata, and per-account token totals; Weaviate stores chunk text and vectors. Embedding requests are sent to Jina AI in batches of up to 32 texts. Scanned/image-only PDFs can fail extraction, and files with fewer than 20 characters of extracted text are rejected. The API rate limiter is process-local, so limits are not globally coordinated across serverless instances. A PostgreSQL or Weaviate outage prevents the corresponding authenticated operations; there is no guest or non-persistent upload fallback.

### Re-embedding Weaviate with Jina AI

The app now uses Jina AI's hosted `jina-embeddings-v3` model with 768-dimensional output, matching the existing Weaviate class dimension. The vectors must still be regenerated because vectors from different embedding models are not comparable. Pause chat and uploads, configure `JINA_API_KEY`, `WEAVIATE_URL`, and `WEAVIATE_API_KEY` if needed in `.env.local`, then run:

```bash
npm run reembed:weaviate-jina
```

This command reads the stored chunk text from Weaviate, regenerates embeddings in batches, and updates vectors in place without deleting the class or chunk data. Progress is checkpointed in `weaviate-SupportChunk-jina-embeddings-v3.checkpoint.json`; rerun after interruptions. This updates all chunk objects still present in Weaviate, but cannot recover missing records from the earlier incomplete restore. Restore a separate backup or re-upload any missing documents, and do not resume chat/uploads until the required records are restored and re-embedded.

## License

MIT — see [LICENSE](./LICENSE).
