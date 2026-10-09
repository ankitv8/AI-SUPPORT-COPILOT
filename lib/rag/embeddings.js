import { EMBEDDING_MODEL, embedWithTransformers } from '../ai/embeddings.js'
import { logUsage } from '../core/telemetry.js'

const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

export async function embedText(text, { tokenMeter, isQuery = false } = {}) {
  const input = isQuery ? `${QUERY_PREFIX}${text}` : text
  const embedding = await embedWithTransformers(input)
  const inputTokens = Math.ceil((input?.length || 0) / 4)
  if (tokenMeter) tokenMeter.inputTokens += inputTokens

  await logUsage({
    endpoint: 'embedding',
    model: EMBEDDING_MODEL,
    inputTokens,
    outputTokens: 0,
  })

  return embedding
}

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Vector dimensions must match')

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
