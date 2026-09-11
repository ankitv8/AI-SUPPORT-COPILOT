import { chunkByParagraph } from '../rag/chunking.js'
import { embedText } from '../rag/embeddings.js'
import { retrieveSupportChunks } from '../rag/hybridRetrieval.js'
import { rerankChunks } from '../rag/rerank.js'
import { isWeaviateConfigured, retrieveWeaviateChunks } from '../rag/weaviate.js'

const MAX_DEMO_DOCS = 2
const MAX_DEMO_TEXT_CHARS = 500_000

export function validateDemoDocuments(documents) {
  if (!Array.isArray(documents) || !documents.length) {
    return { ok: false, error: 'Upload a document in the sidebar first.' }
  }
  if (documents.length > MAX_DEMO_DOCS) {
    return { ok: false, error: `Demo limit: ${MAX_DEMO_DOCS} documents per session.` }
  }

  let totalChars = 0
  for (const doc of documents) {
    const text = String(doc.text || '').trim()
    if (!text || text.length < 20) {
      return { ok: false, error: 'Each demo document must contain at least 20 characters of text.' }
    }
    totalChars += text.length
  }

  if (totalChars > MAX_DEMO_TEXT_CHARS) {
    return { ok: false, error: 'Total demo document text is too large for this session.' }
  }

  return { ok: true, documents: documents.map((doc) => ({
    id: String(doc.id),
    title: String(doc.title || doc.filename || 'Document'),
    filename: String(doc.filename || 'upload.txt'),
    text: String(doc.text).trim(),
  })) }
}

export async function buildEmbeddedChunksFromDocuments(documents, { tokenMeter, userId = '' } = {}) {
  const docChunks = documents.flatMap((doc) =>
    chunkByParagraph({
      id: doc.id,
      tenantId: 'demo-browser',
      userId,
      title: doc.title,
      url: null,
      text: doc.text,
    }),
  )

  const rows = []
  for (const chunk of docChunks) {
    const cached = documents.find((doc) => doc.id === chunk.sourceId)?.embeddedChunks?.find((item) => item.id === chunk.id)
    if (cached?.embedding) {
      rows.push({ ...chunk, embedding: cached.embedding })
      continue
    }
    const embedding = await embedText(chunk.text, { tokenMeter })
    rows.push({ ...chunk, embedding })
  }
  return rows
}

export async function embedDemoDocument(document, { userId = '' } = {}) {
  return buildEmbeddedChunksFromDocuments([document], { userId })
}

export async function retrieveDemoChunks({
  documents,
  question,
  k = 5,
  mode = 'hybrid',
  tokenMeter = null,
  userId = '',
  ownedSourceIds = null,
}) {
  if (isWeaviateConfigured()) {
    const queryEmbedding = await embedText(question, { tokenMeter })
    const candidates = await retrieveWeaviateChunks({
      tenantId: 'demo-browser',
      userId,
      sourceIds: ownedSourceIds || documents.map((document) => document.id),
      question,
      queryEmbedding,
      k,
    })
    return rerankChunks(candidates, { question }).slice(0, k)
  }

  const chunks = await buildEmbeddedChunksFromDocuments(documents, { tokenMeter, userId })
  if (!chunks.length) return []

  return retrieveSupportChunks({
    question,
    chunks,
    k,
    mode,
    tokenMeter,
  })
}
