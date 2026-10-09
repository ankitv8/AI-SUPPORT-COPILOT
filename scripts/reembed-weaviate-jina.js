import { readFile, rename, writeFile } from 'node:fs/promises'
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../lib/ai/embeddings.js'
import { embedTexts } from '../lib/rag/embeddings.js'
import { getWeaviateBaseUrl, getWeaviateClassName } from '../lib/rag/weaviate.js'

const BATCH_SIZE = 32
const UPSERT_CONCURRENCY = 8
const className = getWeaviateClassName()
const baseUrl = getWeaviateBaseUrl()
const checkpointPath = `weaviate-${className}-${EMBEDDING_MODEL}.checkpoint.json`
const checkpointProfile = `${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}`

function headers() {
  return {
    'Content-Type': 'application/json',
    ...(process.env.WEAVIATE_API_KEY
      ? { Authorization: `Bearer ${process.env.WEAVIATE_API_KEY}` }
      : {}),
  }
}

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...headers(), ...options.headers },
    signal: AbortSignal.timeout(30_000),
  })
}

async function readPage(after) {
  const cursor = after ? `, after: ${JSON.stringify(after)}` : ''
  const query = `{
    Get {
      ${className}(limit: ${BATCH_SIZE}${cursor}) {
        tenantId userId sourceId title text chunkIndex url
        _additional { id }
      }
    }
  }`
  const response = await request(`${baseUrl}/v1/graphql`, {
    method: 'POST',
    body: JSON.stringify({ query }),
  })
  if (!response.ok) {
    throw new Error(`Could not read Weaviate chunks (${response.status}): ${(await response.text()).slice(0, 500)}`)
  }
  const payload = await response.json()
  if (payload.errors?.length) throw new Error(`Weaviate read failed: ${payload.errors[0].message}`)
  const page = payload.data?.Get?.[className] || []
  return page.map((item) => {
    if (!item._additional?.id || typeof item.text !== 'string' || !item.text.trim()) {
      throw new Error('Weaviate returned a chunk without its id or stored text.')
    }
    const { _additional, ...properties } = item
    return { id: _additional.id, properties }
  })
}

async function upsertObject(object) {
  const objectUrl = `${baseUrl}/v1/objects/${className}/${encodeURIComponent(object.id)}`
  const response = await request(objectUrl, {
    method: 'PATCH',
    body: JSON.stringify({ vector: object.vector }),
  })
  if (!response.ok) {
    throw new Error(`Could not update vector for Weaviate object ${object.id} (${response.status}): ${(await response.text()).slice(0, 500)}`)
  }
}

async function saveCheckpoint(checkpoint) {
  const temporaryPath = `${checkpointPath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`)
  await rename(temporaryPath, checkpointPath)
}

async function updateBatch(objects) {
  const vectors = await embedTexts(objects.map((object) => object.properties.text))
  if (
    vectors.length !== objects.length
    || vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite))
  ) {
    throw new Error(`Jina AI returned invalid vectors; expected ${EMBEDDING_DIMENSIONS} dimensions.`)
  }

  const updates = objects.map((object, index) => ({ ...object, vector: vectors[index] }))
  for (let offset = 0; offset < updates.length; offset += UPSERT_CONCURRENCY) {
    await Promise.all(updates.slice(offset, offset + UPSERT_CONCURRENCY).map(upsertObject))
  }
  return objects.at(-1).id
}

async function main() {
  if (!baseUrl) throw new Error('WEAVIATE_URL must be set.')
  if (!process.env.JINA_API_KEY) throw new Error('JINA_API_KEY must be set.')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(className)) throw new Error(`Invalid Weaviate class name: ${className}`)

  const schema = await request(`${baseUrl}/v1/schema/${className}`)
  if (!schema.ok) {
    throw new Error(`Could not access Weaviate class ${className} (${schema.status}): ${(await schema.text()).slice(0, 500)}`)
  }

  let checkpoint = { model: checkpointProfile, after: null, completed: 0 }
  try {
    const saved = JSON.parse(await readFile(checkpointPath, 'utf8'))
    if (
      saved.model === checkpointProfile
      && Number.isInteger(saved.completed)
      && saved.completed >= 0
      && (saved.after === null || typeof saved.after === 'string')
    ) {
      checkpoint = saved
    } else {
      console.warn('[weaviate-reembed] Checkpoint uses a different model or is invalid; restarting from the first object.')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  while (true) {
    const batch = await readPage(checkpoint.after)
    if (!batch.length) {
      if (checkpoint.completed === 0) throw new Error(`No chunk objects found in Weaviate class ${className}.`)
      break
    }
    const after = await updateBatch(batch)
    checkpoint = {
      model: checkpointProfile,
      after,
      completed: checkpoint.completed + batch.length,
    }
    await saveCheckpoint(checkpoint)
    console.log(`Re-embedded ${checkpoint.completed} Weaviate chunks.`)
    if (batch.length < BATCH_SIZE) break
  }
  console.log(`Re-embedding complete: ${checkpoint.completed} chunks updated in ${className}.`)
}

main().catch((error) => {
  console.error(`[weaviate-reembed] ${error.message}`)
  process.exitCode = 1
})
