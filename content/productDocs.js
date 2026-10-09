export const productDocs = {
  meta: {
    product: 'AI Support Copilot',
    title: 'Product guide',
    subtitle: 'Upload any file and chat with AI — grounded answers with source citations.',
    lastUpdated: '2026-06-14',
  },

  toc: [
    { id: 'overview', label: 'Overview' },
    { id: 'quick-start', label: 'Quick start' },
    { id: 'chat', label: 'Chat (/chat)' },
    { id: 'usage', label: 'Usage dashboard' },
    { id: 'api', label: 'API routes' },
    { id: 'faq', label: 'FAQ' },
    { id: 'pricing', label: 'Model pricing' },
    { id: 'technical', label: 'RAG pipeline', optional: true },
  ],

  overview: {
    summary:
      'AI Support Copilot lets signed-in users upload supported files and chat with AI about them — like ChatGPT, but every answer is grounded in the upload. Hybrid vector + keyword search finds the right passages; the model streams cited replies.',
    highlights: [
      'Chat at /chat — upload a file, ask anything, get cited answers.',
      'Supports PDF, text, Markdown, JSON, CSV, and HTML.',
      'Per-account token budget enforced server-side.',
      'File text in sessionStorage; document ownership and token totals in PostgreSQL; usage history in IndexedDB at /usage.',
    ],
  },

  quickStart: {
    steps: [
      { step: 'Sign in or create an account', detail: 'Your files and token usage are associated with your account.' },
      { step: 'Open /chat', detail: 'Start a private chat workspace.' },
      { step: 'Upload any file', detail: 'PDF, text, Markdown, JSON, CSV, or HTML in the sidebar (max 2 files, 5 MB each).' },
      { step: 'Ask a question', detail: 'Chat naturally — pick a suggested prompt or type your own. Answers stream with source chips.' },
      { step: 'Check /usage', detail: 'See estimated provider usage from your sessions — stored in IndexedDB.' },
    ],
  },

  demo: {
    intro:
      'Upload any file and chat with AI Support Copilot. The experience feels like ChatGPT, but retrieval runs over your upload only — answers include source citations from your file.',
    steps: [
      { step: 'Sign in or create an account', detail: 'Account access is required to use the workspace.' },
      { step: 'Open /chat', detail: 'Upload files in your account workspace.' },
      { step: 'Upload any file', detail: 'Text/JSON/MD parse in-browser; PDF uses POST /api/demo/parse (stateless, not stored).' },
      { step: 'Ask anything', detail: 'Suggested prompts come from your file title and headings.' },
      { step: 'Watch your token budget', detail: 'The sidebar meter tracks your account usage against the configured limit.' },
    ],
    limits: [
      '2 files per browser session · 5 MB each · PDF, text, MD, JSON, CSV, HTML',
      'Token budget is configured per account with USER_TOKEN_BUDGET',
      'Document ownership and usage totals are stored in PostgreSQL',
    ],
  },

  usage: {
    intro:
      'The usage dashboard reads from IndexedDB in your browser. Each chat session records input/output tokens and estimated USD/INR cost using published model rates.',
    points: [
      'Token budget is checked and persisted per account on the server.',
      'Filter by 7, 30, or 90 days.',
      'Breakdown by endpoint and model; daily series for the last 14 days.',
    ],
  },

  api: {
    intro: 'AI Support Copilot runs on Next.js. These API routes power chat and PDF parsing:',
    routes: [
      {
        method: 'POST',
        path: '/api/chat',
        detail: 'Streams Groq tokens through SSE as they arrive, then checks the complete answer with the output safety guardrail and replaces it if blocked. Receives your question and uploaded file chunks. Checks the token budget and a 100-request/minute per-IP API rate limit. Embeddings run locally with Transformers.js; chat uses Groq.',
      },
      {
        method: 'POST',
        path: '/api/demo/parse',
        detail: 'Extracts text from a PDF upload. Stateless — file content is not stored on the server.',
      },
    ],
    envNote: 'Server env: GROQ_API_KEY, DATABASE_URL, WEAVIATE_URL; WEAVIATE_API_KEY when required by the endpoint.',
  },

  faq: [
    {
      question: 'How is this different from ChatGPT?',
      answer:
        'ChatGPT answers from its general training. AI Support Copilot only answers from files you upload — every reply is grounded in your document with a source citation.',
    },
    {
      question: 'What files can I upload?',
      answer: 'PDF, plain text, Markdown, JSON, HTML, and CSV — up to 5 MB each, 2 files per browser session.',
    },
    {
      question: 'Do I need an account?',
      answer: 'Yes. Sign in or create an account before uploading files or chatting.',
    },
    {
      question: 'Is my data stored on a server?',
      answer: 'Upload text stays in sessionStorage unless Weaviate persistence is configured. PostgreSQL stores document ownership and usage totals. PDFs are parsed via a stateless API call. Embeddings are generated locally; Groq receives the question and retrieved chunks for each chat request.',
    },
    {
      question: 'What happens when I hit the token limit?',
      answer: 'Chat is blocked when the configured per-account token budget is reached. Set USER_TOKEN_BUDGET in the server environment.',
    },
    {
      question: 'Can the AI hallucinate?',
      answer: 'It answers from retrieved chunks of your file only. Low-confidence queries are declined instead of guessed.',
    },
  ],

  technical: {
    title: 'How RAG works',
    intro: 'Optional technical overview of the retrieval pipeline.',
    steps: [
      { step: 'Chunk & embed', detail: 'Your file is split into paragraph chunks; embedded with text-embedding-3-small per request.' },
      { step: 'Hybrid retrieve', detail: 'Vector similarity (60%) + BM25 keywords (40%), then optional reranking.' },
      { step: 'Guardrail & generate', detail: 'Low-confidence matches refused. Matched chunks ground gpt-4o-mini with streaming SSE.' },
      { step: 'Local observability', detail: 'Token budget enforced server-side; detailed usage entries in IndexedDB; no user accounts.' },
    ],
  },
}
