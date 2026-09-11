# AI Support Copilot

Upload any file and chat with AI about it — like ChatGPT, but every answer is grounded in your upload with source citations.

## Features

| Capability | Description |
| --- | --- |
| **File upload** | PDF, text, JSON, Markdown, CSV, HTML at `/chat` |
| **AI chat** | ChatGPT-style streaming chat grounded in your files |
| **Hybrid RAG** | Vector + BM25 keyword search |
| **Source citations** | Every answer links back to your uploaded file |
| **Usage dashboard** | Estimated provider usage at `/usage` — tracked locally |

## Routes

| Route | Description |
| --- | --- |
| `/` | Landing page |
| `/chat` | Upload a file and chat with AI Support Copilot |
| `/usage` | Local usage & cost dashboard |
| `/docs` | Product guide |

## Getting started

```bash
npm install
cp .env.example .env.local
# Set GROQ_API_KEY and HF_TOKEN in .env.local
npm run dev
```

Open **http://localhost:3010**

## Architecture

- **Next.js** — landing, chat UI, usage dashboard, and API routes
- **`POST /api/chat`** — SSE streaming; Hugging Face embeddings + Groq chat
- **`POST /api/demo/parse`** — stateless PDF text extraction
- **`POST /api/demo/ingest`** — chunks and embeds an upload once; persists chunks in Weaviate when configured
- **Browser storage** — demo documents and local fallback embeddings (`sessionStorage`), usage dashboard (`IndexedDB`)
- **Token usage** — authenticated users are tracked in PostgreSQL; unauthenticated fallback usage is tracked per device/network
- **Optional Weaviate** — persistent hybrid BM25 + dense-vector retrieval when `WEAVIATE_URL` is configured
- **Optional managed guardrails** — input and output safety checks through a language-agnostic HTTP endpoint
- **Lakera Guard** — optional prompt-injection checks for user prompts, retrieved context, and model output
- **PostgreSQL auth** — optional users, sessions, and document ownership for production deployments

## Deploy

Works on [Vercel](https://vercel.com) or any Node host that runs Next.js. The demo requires `GROQ_API_KEY` and `HF_TOKEN`. For production persistence, configure a managed Weaviate deployment and set `WEAVIATE_URL` and `WEAVIATE_API_KEY`. Configure `GUARDRAIL_URL` and `GUARDRAIL_API_KEY` for managed input/output safety checks.

| Variable | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Groq API key |
| `GROQ_CHAT_MODEL` | No | Default `openai/gpt-oss-120b` |
| `HF_TOKEN` | Yes | Hugging Face token for embeddings |
| `HF_EMBEDDING_MODEL` | No | Default `BAAI/bge-small-en-v1.5` |
| `WEAVIATE_URL` | No | Weaviate endpoint; enables persistent hybrid retrieval |
| `WEAVIATE_API_KEY` | No | Weaviate API key, when required by the endpoint |
| `WEAVIATE_CLASS` | No | Default `SupportChunk` |
| `WEAVIATE_HYBRID_ALPHA` | No | Hybrid weighting from `0` (BM25) to `1` (vector), default `0.6` |
| `LAKERA_API_KEY` | No | Lakera Guard API key; enables input/output checks |
| `LAKERA_GUARD_URL` | No | Default `https://api.lakera.ai/v2/guard` |
| `GUARDRAIL_TIMEOUT_MS` | No | Guardrail request timeout, default `4000` |
| `GUARDRAIL_FAIL_OPEN` | No | Set `true` only if availability is preferred over blocking |
| `DATABASE_URL` | No | PostgreSQL connection string; enables authentication and ownership enforcement |
| `USER_TOKEN_BUDGET` | No | Authenticated-user token limit, default `100000` |

### Guardrail endpoint contract

The application calls the configured endpoint with a JSON body containing `type` (`input` or `output`), `text`, and optional retrieved `context`. The endpoint should return JSON containing `allowed: true|false`, with optional `reason` and `categories` fields. This keeps the application independent of a specific managed provider; expose Azure AI Content Safety, Lakera, Bedrock Guardrails, or an internal adapter behind this contract.

Document ingestion happens through `/api/demo/ingest`, not during chat. When Weaviate is configured, the endpoint chunks, embeds, and upserts each document once with tenant and source metadata. Chat then embeds only the question and performs a query-only Weaviate hybrid search filtered to the uploaded source IDs. When `WEAVIATE_URL` is unset, the endpoint returns chunk embeddings that are cached with the browser session document; local chat reuses those embeddings and performs the existing in-memory BM25/vector search without recomputing document embeddings.

## License

MIT — see [LICENSE](./LICENSE).
