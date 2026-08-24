const HF_API_URL = 'https://router.huggingface.co/hf-inference/models'

export const EMBEDDING_MODEL = process.env.HF_EMBEDDING_MODEL || 'BAAI/bge-small-en-v1.5'

export async function embedWithHuggingFace(text) {
  const response = await fetch(`${HF_API_URL}/${EMBEDDING_MODEL}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Hugging Face embedding failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  const result = await response.json()
  const vector = Array.isArray(result[0]) ? result[0] : result
  if (!Array.isArray(vector) || !vector.length || typeof vector[0] !== 'number') {
    throw new Error('Hugging Face returned an invalid embedding vector')
  }

  return vector
}