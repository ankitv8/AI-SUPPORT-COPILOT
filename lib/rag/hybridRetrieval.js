import { bm25Score, buildBm25Index, normalizeScores } from './bm25.js'
import { cacheGet, cacheSet } from '../core/cache.js'
import { cosineSimilarity, embedText } from './embeddings.js'
import { rerankChunks } from './rerank.js'

const VECTOR_WEIGHT = 0.6
const BM25_WEIGHT = 0.4

export function chooseDiverseTopChunks(chunks, limit = 5) {
  if (!Array.isArray(chunks) || !chunks.length || !limit) return []

  const ranked = [...chunks].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const selected = []
  const usedSources = new Set()

  for (const chunk of ranked) {
    if (selected.length >= limit) break
    if (!usedSources.has(chunk.sourceId)) {
      selected.push(chunk)
      usedSources.add(chunk.sourceId)
    }
  }

  for (const chunk of ranked) {
    if (selected.length >= limit) break
    if (!selected.some((item) => item.id === chunk.id)) {
      selected.push(chunk)
    }
  }

  return selected.slice(0, limit)
}

export async function retrieveSupportChunks({
  question,
  chunks: providedChunks,
  k = 15,
  mode = 'hybrid',
  sourceIdFilter = null,
  skipRerankRules = false,
  tokenMeter = null,
}) {
  let tenantChunks = providedChunks ?? []

  if (sourceIdFilter) {
    tenantChunks = tenantChunks.filter((chunk) => sourceIdFilter(chunk.sourceId))
  }

  if (!tenantChunks.length) return []

  const bm25Index = buildBm25Index(tenantChunks)
  let queryEmbedding = null
  const hasEmbeddings = tenantChunks.some((chunk) => Array.isArray(chunk.embedding))

  if (mode !== 'bm25' && hasEmbeddings) {
    const cacheKey = `emb:demo:${question}`
    queryEmbedding = cacheGet(cacheKey)
    if (!queryEmbedding) {
      try {
        queryEmbedding = await embedText(question, { tokenMeter, isQuery: true })
        cacheSet(cacheKey, queryEmbedding)
      } catch (error) {
        console.error('[embedding] query embedding failed; using BM25 retrieval', error)
      }
    }
  }

  let scored = tenantChunks.map((chunk, i) => {
    const vectorScore = queryEmbedding && chunk.embedding
      ? cosineSimilarity(queryEmbedding, chunk.embedding)
      : 0
    const lexicalScore = bm25Score(question, bm25Index.docs[i], bm25Index)

    return {
      ...chunk,
      vectorScore,
      lexicalScore,
      retrievalMode: queryEmbedding && chunk.embedding ? mode : 'bm25',
    }
  })

  if (mode === 'bm25' || !queryEmbedding) {
    scored = scored.map((c) => ({ ...c, score: c.lexicalScore, retrievalMode: 'bm25' }))
  } else if (mode === 'vector') {
    scored = scored.map((c) => ({
      ...c,
      score: c.embedding ? c.vectorScore : c.lexicalScore,
      retrievalMode: c.embedding ? 'vector' : 'bm25',
    }))
  } else if (mode === 'bm25') {
    scored = scored.map((c) => ({ ...c, score: c.lexicalScore }))
  } else {
    const withVector = normalizeScores(scored, 'vectorScore')
    const withBoth = normalizeScores(withVector, 'lexicalScore')
    scored = withBoth.map((c) => ({
      ...c,
      score:
        VECTOR_WEIGHT * c.vectorScoreNorm + BM25_WEIGHT * c.lexicalScoreNorm,
    }))
  }

  scored.sort((a, b) => b.score - a.score)
  const reranked = rerankChunks(scored, { question, skipRules: skipRerankRules })

  return chooseDiverseTopChunks(reranked, k)
}
