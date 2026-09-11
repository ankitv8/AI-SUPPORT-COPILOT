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

  const cacheKey = `emb:demo:${question}`
  let queryEmbedding = cacheGet(cacheKey)
  if (!queryEmbedding) {
    queryEmbedding = await embedText(question, { tokenMeter })
    cacheSet(cacheKey, queryEmbedding)
  }

  const bm25Index = buildBm25Index(tenantChunks)

  let scored = tenantChunks.map((chunk, i) => {
    const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding)
    const lexicalScore = bm25Score(question, bm25Index.docs[i], bm25Index)

    return {
      ...chunk,
      vectorScore,
      lexicalScore,
      retrievalMode: mode,
    }
  })

  if (mode === 'vector') {
    scored = scored.map((c) => ({ ...c, score: c.vectorScore }))
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
  const top = scored.slice(0, k * 2)
  const reranked = rerankChunks(top, { question, skipRules: skipRerankRules })

  return chooseDiverseTopChunks(reranked, k)
}
