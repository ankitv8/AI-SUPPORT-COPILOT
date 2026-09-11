import crypto from 'node:crypto'
import { fetchWithRetry } from '../core/retry.js'

const CLASS_NAME = process.env.WEAVIATE_CLASS || 'SupportChunk'
const HYBRID_ALPHA = Number(process.env.WEAVIATE_HYBRID_ALPHA || 0.6)
let schemaPromise = null

function baseUrl() {
  const configuredUrl = (process.env.WEAVIATE_URL || '').trim()
  if (!configuredUrl) return ''
  const normalizedUrl = /^https?:\/\//i.test(configuredUrl)
    ? configuredUrl
    : `https://${configuredUrl}`
  return normalizedUrl.replace(/\/$/, '')
}

export function isWeaviateConfigured() {
  return Boolean(baseUrl())
}

function headers() {
  const result = { 'Content-Type': 'application/json' }
  if (process.env.WEAVIATE_API_KEY) {
    result.Authorization = `Bearer ${process.env.WEAVIATE_API_KEY}`
  }
  return result
}

function objectId(chunk) {
  const digest = crypto
    .createHash('sha256')
    .update(`${chunk.tenantId}:${chunk.id}`)
    .digest('hex')
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${((parseInt(digest.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${digest.slice(18, 20)}-${digest.slice(20, 32)}`
}

async function ensureSchema() {
  if (!isWeaviateConfigured()) return
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const existing = await fetchWithRetry(`${baseUrl()}/v1/schema/${CLASS_NAME}`, {
        method: 'GET',
        headers: headers(),
      }, { attempts: 3, timeoutMs: 10000 })

      if (existing.ok) return
      if (existing.status !== 404) {
        throw new Error(`Weaviate schema check failed (${existing.status}): ${(await existing.text()).slice(0, 300)}`)
      }

      const created = await fetchWithRetry(`${baseUrl()}/v1/schema`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          class: CLASS_NAME,
          vectorizer: 'none',
          properties: [
            { name: 'tenantId', dataType: ['text'] },
            { name: 'userId', dataType: ['text'] },
            { name: 'sourceId', dataType: ['text'] },
            { name: 'title', dataType: ['text'] },
            { name: 'text', dataType: ['text'] },
            { name: 'chunkIndex', dataType: ['int'] },
            { name: 'url', dataType: ['text'] },
          ],
        }),
      }, { attempts: 3, timeoutMs: 10000 })

      if (!created.ok && created.status !== 422) {
        throw new Error(`Weaviate schema creation failed (${created.status}): ${(await created.text()).slice(0, 300)}`)
      }
    })()
  }
  await schemaPromise
}

export async function upsertWeaviateChunks(chunks) {
  await ensureSchema()
  for (const chunk of chunks) {
    const id = objectId(chunk)
    const objectUrl = `${baseUrl()}/v1/objects/${CLASS_NAME}/${id}`
    const payload = {
      properties: {
        tenantId: chunk.tenantId,
        userId: chunk.userId || '',
        sourceId: chunk.sourceId,
        title: chunk.title,
        text: chunk.text,
        chunkIndex: chunk.chunkIndex,
        url: chunk.url || '',
      },
      vector: chunk.embedding,
    }

    const updateResponse = await fetchWithRetry(objectUrl, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(payload),
    }, { attempts: 3, timeoutMs: 15000 })

    if (updateResponse.status === 404) {
      const createResponse = await fetchWithRetry(`${baseUrl()}/v1/objects`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id, class: CLASS_NAME, ...payload }),
      }, { attempts: 3, timeoutMs: 15000 })
      if (!createResponse.ok) {
        throw new Error(`Weaviate object upsert failed (${createResponse.status}): ${(await createResponse.text()).slice(0, 300)}`)
      }
    } else if (!updateResponse.ok) {
      throw new Error(`Weaviate object upsert failed (${updateResponse.status}): ${(await updateResponse.text()).slice(0, 300)}`)
    }
  }
}

export async function deleteWeaviateSource({ tenantId, userId = '', sourceId }) {
  if (!isWeaviateConfigured()) return
  await ensureSchema()
  const response = await fetchWithRetry(`${baseUrl()}/v1/batch/objects`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({
      match: {
        class: CLASS_NAME,
        where: {
          operator: 'And',
          operands: [
            { path: ['tenantId'], operator: 'Equal', valueText: tenantId },
            ...(userId ? [{ path: ['userId'], operator: 'Equal', valueText: userId }] : []),
            { path: ['sourceId'], operator: 'Equal', valueText: sourceId },
          ],
        },
      },
    }),
  }, { attempts: 3, timeoutMs: 15000 })
  if (!response.ok) {
    throw new Error(`Weaviate source deletion failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  }
}

export async function retrieveWeaviateChunks({ tenantId, userId = '', sourceIds, question, queryEmbedding, k = 5 }) {
  if (!isWeaviateConfigured()) return null

  const sourceWhere = sourceIds?.length === 1
    ? `{ path: ["sourceId"], operator: Equal, valueText: ${JSON.stringify(sourceIds[0])} }`
    : `{ operator: Or, operands: [${sourceIds.map((sourceId) => `{ path: ["sourceId"], operator: Equal, valueText: ${JSON.stringify(sourceId)} }`).join(',')}] }`
  const tenantAndSourceWhere = `{ operator: And, operands: [{ path: ["tenantId"], operator: Equal, valueText: ${JSON.stringify(tenantId)} }, ${sourceWhere}] }`
  const graphQlQuery = `{
    Get {
      ${CLASS_NAME}(
        hybrid: { query: ${JSON.stringify(question)}, vector: [${queryEmbedding.join(',')}], alpha: ${HYBRID_ALPHA} }
        where: { operator: And, operands: [{ path: ["tenantId"], operator: Equal, valueText: ${JSON.stringify(tenantId)} }, ${userId ? `{ path: ["userId"], operator: Equal, valueText: ${JSON.stringify(userId)} },` : ''} ${sourceWhere}] }
        limit: ${k * 2}
      ) {
        tenantId
        userId
        sourceId
        title
        text
        chunkIndex
        url
        _additional { score distance }
      }
    }
  }`

  const response = await fetchWithRetry(`${baseUrl()}/v1/graphql`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ query: graphQlQuery }),
  }, { attempts: 3, timeoutMs: 15000 })
  if (!response.ok) {
    throw new Error(`Weaviate hybrid search failed (${response.status}): ${(await response.text()).slice(0, 300)}`)
  }

  const payload = await response.json()
  if (payload.errors?.length) throw new Error(`Weaviate hybrid search failed: ${payload.errors[0].message}`)

  let items = payload.data?.Get?.[CLASS_NAME] || []

  if (!items.length && sourceIds?.length) {
    const fallbackQuery = `{
      Get {
        ${CLASS_NAME}(
          hybrid: { query: ${JSON.stringify(question)}, vector: [${queryEmbedding.join(',')}], alpha: ${HYBRID_ALPHA} }
          where: ${tenantAndSourceWhere}
          limit: 50
        ) {
          tenantId
          userId
          sourceId
          title
          text
          chunkIndex
          url
          _additional { score distance }
        }
      }
    }`
    const fallbackResponse = await fetchWithRetry(`${baseUrl()}/v1/graphql`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ query: fallbackQuery }),
    }, { attempts: 3, timeoutMs: 15000 })
    if (fallbackResponse.ok) {
      const fallbackPayload = await fallbackResponse.json()
      items = (fallbackPayload.data?.Get?.[CLASS_NAME] || []).filter((item) => sourceIds.includes(item.sourceId))
    }
  }

  return items.map((item) => ({
    id: `${item.sourceId}:chunk:${item.chunkIndex}`,
    tenantId: item.tenantId,
    userId: item.userId,
    sourceId: item.sourceId,
    title: item.title,
    url: item.url || null,
    text: item.text,
    chunkIndex: item.chunkIndex,
    score: Number(item._additional?.score || 0),
    vectorScore: Number(item._additional?.score || 0),
    lexicalScore: 0,
    retrievalMode: 'weaviate-hybrid',
  }))
}
