import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedWithJina } from '../ai/embeddings.js'
import { logUsage } from '../core/telemetry.js'

export { EMBEDDING_DIMENSIONS }

export async function embedTexts(texts, { tokenMeter, isQuery = false } = {}) {
  if (!Array.isArray(texts) || !texts.every((text) => typeof text === 'string' && text.length > 0)) {
    throw new TypeError('embedTexts expects an array of non-empty text strings.')
  }

  const vectors = []
  const batchSize = 32
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const inputs = texts.slice(offset, offset + batchSize)
    const batchVectors = await embedWithJina(inputs, { isQuery })
    if (batchVectors.length !== inputs.length) {
      throw new Error(`Jina AI returned ${batchVectors.length} embeddings for ${inputs.length} input texts.`)
    }
    if (batchVectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)) {
      throw new Error(`Jina AI returned vectors with an unexpected dimension; expected ${EMBEDDING_DIMENSIONS}.`)
    }

    const inputTokens = inputs.reduce((total, input) => total + Math.ceil(input.length / 4), 0)
    if (tokenMeter) tokenMeter.inputTokens += inputTokens
    await logUsage({
      endpoint: 'embedding',
      model: EMBEDDING_MODEL,
      inputTokens,
      outputTokens: 0,
    })
    vectors.push(...batchVectors)
  }

  return vectors
}

export async function embedText(text, options = {}) {
  if (typeof text !== 'string' || !text.length) throw new TypeError('embedText expects a non-empty string.')
  const [embedding] = await embedTexts([text], options)
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
