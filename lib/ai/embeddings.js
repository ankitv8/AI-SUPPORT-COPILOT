import { env, pipeline } from '@huggingface/transformers'

export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5'
export const EMBEDDING_DIMENSIONS = 384

env.cacheDir = '/tmp/models'

let extractorPromise

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL)
      .catch((error) => {
        extractorPromise = null
        throw error
      })
  }
  return extractorPromise
}

export async function embedWithTransformers(text) {
  const extractor = await getExtractor()
  const result = await extractor(text, { pooling: 'cls', normalize: true })
  const vector = Array.from(result.data)

  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-dimensional embedding; received ${vector.length}`)
  }

  return vector
}
