import { assertCompleteEmbeddings, embedDemoDocument } from '../../../../lib/demo/demoRetrieval.js'
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
    if (!isWeaviateConfigured()) {
      return Response.json(
        { error: 'Persistent vector storage is not configured. Set WEAVIATE_URL before uploading files.' },
        { status: 503 },
      )
    }

    const document = await request.json()
    if (!document?.id || !document?.text) {
      return Response.json({ error: 'id and text are required' }, { status: 400 })
    }

    const chunks = await embedDemoDocument({
      id: String(document.id),
      title: String(document.title || document.filename || 'Document'),
      text: String(document.text).trim(),
    }, { userId: user.id })

    const vectorChunks = assertCompleteEmbeddings(chunks)
    const source = {
      tenantId: DEFAULT_TENANT_ID,
      userId: user.id,
      sourceId: String(document.id),
    }

    try {
      await upsertWeaviateChunks(vectorChunks)
      await createOwnedDocument({
        id: String(document.id),
        userId: user.id,
        title: String(document.title || document.filename || 'Document'),
        filename: String(document.filename || 'upload.txt'),
        sizeBytes: Number(document.sizeBytes || 0),
      })
    } catch (error) {
      try {
        await deleteWeaviateSource(source)
      } catch (cleanupError) {
        console.error('[document-ingest] failed to roll back partially stored vectors', cleanupError)
      }
      try {
        await deleteOwnedDocument({ id: String(document.id), userId: user.id })
      } catch (cleanupError) {
        console.error('[document-ingest] failed to roll back document ownership metadata', cleanupError)
      }
      throw error
    }

    return Response.json({ ok: true, persistent: true, chunkCount: vectorChunks.length })
  } catch (error) {
    console.error('[document-ingest] failed', error)
    return Response.json({ error: "Couldn't process this file, please try again." }, { status: 500 })
  }
}