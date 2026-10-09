export const EMBEDDING_MODEL = 'jina-embeddings-v3'
export const EMBEDDING_DIMENSIONS = 768

const INFERENCE_URL = 'https://api.jina.ai/v1/embeddings'
const MAX_RETRIES = 3

function normalizeEmbedding(values) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Jina AI returned an embedding with an invalid dimension; expected ${EMBEDDING_DIMENSIONS}.`)
  }
  if (!values.every(Number.isFinite)) {
    throw new Error('Jina AI returned an embedding containing non-finite values.')
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error('Jina AI returned an embedding that cannot be normalized.')
  }
  return values.map((value) => value / norm)
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500
}

export async function embedWithJina(texts, { isQuery = false } = {}) {
  if (!Array.isArray(texts) || !texts.length || !texts.every((text) => typeof text === 'string' && text.length > 0)) {
    throw new TypeError('Jina embedding input must be a non-empty array of non-empty strings.')
  }

  const token = process.env.JINA_API_KEY
  if (!token) throw new Error('JINA_API_KEY is required to generate embeddings with Jina AI.')

  let response
  let lastError
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      response = await fetch(INFERENCE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          task: isQuery ? 'retrieval.query' : 'retrieval.passage',
          dimensions: EMBEDDING_DIMENSIONS,
          input: texts,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!isRetryableStatus(response.status) || attempt === MAX_RETRIES - 1) break
    } catch (error) {
      lastError = error
      if (attempt === MAX_RETRIES - 1) throw error
    }

    const retryAfterValue = response?.headers.get('retry-after')
    const retryAfterSeconds = Number(retryAfterValue)
    const retryAt = retryAfterValue ? Date.parse(retryAfterValue) : Number.NaN
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : Number.isFinite(retryAt)
        ? Math.max(0, retryAt - Date.now())
        : 300 * (2 ** attempt)
    if (response?.body) await response.body.cancel().catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  if (!response) throw lastError || new Error('Jina AI embedding request failed.')
  if (!response.ok) {
    const details = (await response.text()).slice(0, 300)
    const credits = response.status === 402
      ? ' Check your Jina AI API plan, credits, and billing.'
      : ''
    throw new Error(`Jina AI embedding request failed (${response.status}): ${details}.${credits}`)
  }

  const result = await response.json()
  if (!Array.isArray(result?.data) || result.data.length !== texts.length) {
    throw new Error(`Jina AI returned ${result?.data?.length ?? 0} embeddings for ${texts.length} input texts.`)
  }
  if (result.data.some((item, position) =>
    !Number.isInteger(item?.index) || item.index < 0 || item.index >= texts.length
      || result.data.some((other, index) => index !== position && other?.index === item.index),
  )) {
    throw new Error('Jina AI returned invalid embedding indexes.')
  }
  const vectors = [...result.data]
    .sort((a, b) => a.index - b.index)
    .map((item) => normalizeEmbedding(item.embedding))
  if (vectors.some((vector) => vector.length !== vectors[0].length)) {
    throw new Error('Jina AI returned vectors with inconsistent dimensions.')
  }
  return vectors
}
