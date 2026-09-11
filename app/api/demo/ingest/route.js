import { embedDemoDocument } from '../../../../lib/demo/demoRetrieval.js'
import { deleteWeaviateSource, isWeaviateConfigured, upsertWeaviateChunks } from '../../../../lib/rag/weaviate.js'
import { getUserFromRequest, hasAuthDatabase } from '../../../../lib/core/auth.js'
import { createOwnedDocument, deleteOwnedDocument, DEFAULT_TENANT_ID } from '../../../../lib/core/documents.js'

export const runtime = 'nodejs'

export async function DELETE(request) {
  try {
    const user = await getUserFromRequest(request)
    if (hasAuthDatabase() && !user) return Response.json({ error: 'Authentication required.' }, { status: 401 })
    const { id } = await request.json()
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
    const tenantId = DEFAULT_TENANT_ID
    await deleteWeaviateSource({ tenantId, userId: user?.id, sourceId: String(id) })
    if (user) {
      const deleted = await deleteOwnedDocument({ id: String(id), userId: user.id, tenantId })
      if (!deleted) return Response.json({ error: 'Document not found.' }, { status: 404 })
    }
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: error.message || 'Deletion failed' }, { status: 500 })
  }
}

export async function POST(request) {
  try {
    const user = await getUserFromRequest(request)
    if (hasAuthDatabase() && !user) return Response.json({ error: 'Authentication required.' }, { status: 401 })
    const document = await request.json()
    if (!document?.id || !document?.text) {
      return Response.json({ error: 'id and text are required' }, { status: 400 })
    }

    const chunks = await embedDemoDocument({
      id: String(document.id),
      title: String(document.title || document.filename || 'Document'),
      text: String(document.text).trim(),
    }, { userId: user?.id })

    if (isWeaviateConfigured()) {
      await upsertWeaviateChunks(chunks)
      if (user) await createOwnedDocument({ id: String(document.id), userId: user.id, title: String(document.title || document.filename || 'Document'), filename: String(document.filename || 'upload.txt'), sizeBytes: Number(document.sizeBytes || 0) })
      return Response.json({ ok: true, persistent: true, chunkCount: chunks.length })
    }

    return Response.json({
      ok: true,
      persistent: false,
      chunkCount: chunks.length,
      embeddedChunks: chunks.map(({ id, embedding }) => ({ id, embedding })),
    })
  } catch (error) {
    return Response.json({ error: error.message || 'Ingestion failed' }, { status: 500 })
  }
}