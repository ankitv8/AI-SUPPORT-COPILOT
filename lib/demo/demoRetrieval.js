import { chunkByParagraph } from '../rag/chunking.js'
import { EMBEDDING_DIMENSIONS, embedText, embedTexts } from '../rag/embeddings.js'
import { chooseDiverseTopChunks } from '../rag/hybridRetrieval.js'
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
    embeddedChunks: Array.isArray(doc.embeddedChunks)
      ? doc.embeddedChunks
        .filter((item) =>
          typeof item?.id === 'string'
          && Array.isArray(item.embedding)
          && item.embedding.length === EMBEDDING_DIMENSIONS
          && item.embedding.every((value) => Number.isFinite(value)),
        )
        .map((item) => ({ id: item.id, embedding: item.embedding }))
      : [],
  })) }
}

async function buildEmbeddedChunksFromDocuments(documents, { tokenMeter, userId = '' } = {}) {
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

  const embeddings = await embedTexts(docChunks.map((chunk) => chunk.text), { tokenMeter })
  return docChunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] }))
}

export async function embedDemoDocument(document, { userId = '' } = {}) {
  return buildEmbeddedChunksFromDocuments([document], { userId })
}

export function assertCompleteEmbeddings(chunks) {
  if (
    !chunks.length
    || chunks.some((chunk) =>
      !Array.isArray(chunk.embedding)
      || chunk.embedding.length !== EMBEDDING_DIMENSIONS
      || !chunk.embedding.every(Number.isFinite),
    )
  ) {
    throw new Error('Failed to generate a valid embedding for every document chunk.')
  }
  return chunks
}

export async function retrieveDemoChunks({
  documents,
  question,
  k = 5,
  tokenMeter = null,
  userId = '',
  ownedSourceIds = null,
}) {
  if (!isWeaviateConfigured()) {
    throw new Error('Persistent vector storage is not configured.')
  }

  const queryEmbedding = await embedText(question, { tokenMeter, isQuery: true })
  const sourceIds = ownedSourceIds || documents.map((document) => document.id)
  const candidates = (await Promise.all(
    sourceIds.map((sourceId) =>
      retrieveWeaviateChunks({
        tenantId: 'demo-browser',
        userId,
        sourceIds: [sourceId],
        question,
        queryEmbedding,
        k,
      }),
    ),
  )).flat()
  return chooseDiverseTopChunks(rerankChunks(candidates, { question }), k)
}
