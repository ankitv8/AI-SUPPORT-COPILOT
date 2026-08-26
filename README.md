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
- **Browser storage** — documents (`sessionStorage`), usage dashboard (`IndexedDB`)
- **Server token budget** — 100K trial enforced per device/network (`data/guest-usage/`)

## Deploy

Works on [Vercel](https://vercel.com) (or any Node host that runs Next.js). Set `GROQ_API_KEY` and `HF_TOKEN` in project environment variables. No database or separate API server required.

## Environment

| Variable | Required | Description |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes | Groq API key |
| `GROQ_CHAT_MODEL` | No | Default `openai/gpt-oss-120b` |
| `HF_TOKEN` | Yes | Hugging Face token for embeddings |
| `HF_EMBEDDING_MODEL` | No | Default `BAAI/bge-small-en-v1.5` |

## License

MIT — see [LICENSE](./LICENSE).
