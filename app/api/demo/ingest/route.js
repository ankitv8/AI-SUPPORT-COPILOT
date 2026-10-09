import { embedDemoDocument } from '../../../../lib/demo/demoRetrieval.js'
import { deleteWeaviateSource, isWeaviateConfigured, upsertWeaviateChunks } from '../../../../lib/rag/weaviate.js'
import { requireAuthenticatedUser } from '../../../../lib/core/auth.js'
import { createOwnedDocument, deleteOwnedDocument, DEFAULT_TENANT_ID } from '../../../../lib/core/documents.js'
import { checkApiRateLimit } from '../../../../lib/core/apiRateLimit.js'
import { checkApiTokenBudget } from '../../../../lib/core/apiBudget.js'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function DELETE(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  try {
    const { user, response } = await requireAuthenticatedUser(request)
    if (response) return response
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
    const tenantId = DEFAULT_TENANT_ID
    await deleteWeaviateSource({ tenantId, userId: user?.id, sourceId: String(id) })
    const deleted = await deleteOwnedDocument({ id: String(id), userId: user.id, tenantId })
    if (!deleted) return Response.json({ error: 'Document not found.' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    console.error('[document-delete] failed', error)
    return Response.json({ error: 'Could not remove this file, please try again.' }, { status: 500 })
  }
}

export async function POST(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  try {
    const { user, response } = await requireAuthenticatedUser(request)
    if (response) return response
    const budgetLimit = await checkApiTokenBudget(user)
    if (budgetLimit) return budgetLimit

    const document = await request.json()
    if (!document?.id || !document?.text) {
      return Response.json({ error: 'id and text are required' }, { status: 400 })
    }

    const chunks = await embedDemoDocument({
      id: String(document.id),
      title: String(document.title || document.filename || 'Document'),
      text: String(document.text).trim(),
    }, { userId: user.id })

    const vectorChunks = chunks.filter((chunk) => Array.isArray(chunk.embedding))
    await createOwnedDocument({
      id: String(document.id),
      userId: user.id,
      title: String(document.title || document.filename || 'Document'),
      filename: String(document.filename || 'upload.txt'),
      sizeBytes: Number(document.sizeBytes || 0),
    })
    if (isWeaviateConfigured()) {
      let persistent = vectorChunks.length === chunks.length
      if (vectorChunks.length) {
        try {
          await upsertWeaviateChunks(vectorChunks)
        } catch (error) {
          persistent = false
          const reason = error instanceof Error ? error.message : 'Unknown Weaviate error'
          console.warn(`[document-ingest] Weaviate unavailable; retaining local document vectors: ${reason}`)
        }
      }
      return Response.json({
        ok: true,
        persistent,
        chunkCount: chunks.length,
        ...(!persistent
          ? { embeddedChunks: vectorChunks.map(({ id, embedding }) => ({ id, embedding })) }
          : {}),
      })
    }

    return Response.json({
      ok: true,
      persistent: false,
      chunkCount: chunks.length,
      embeddedChunks: vectorChunks.map(({ id, embedding }) => ({ id, embedding })),
    })
  } catch (error) {
    console.error('[document-ingest] failed', error)
    return Response.json({ error: "Couldn't process this file, please try again." }, { status: 500 })
  }
}