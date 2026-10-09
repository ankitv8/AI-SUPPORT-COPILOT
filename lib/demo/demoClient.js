import {
  addDemoDocumentToStore,
  demoDocumentListView,
  loadDemoDocuments,
  removeDemoDocumentFromStore,
} from './demoBrowserStore.js'
import { parseDemoFile } from './demoFileParse.js'

export function getDemoDocumentsForChat(accountId) {
  return loadDemoDocuments(accountId)
}

export function listDemoDocumentsForUi(accountId) {
  return demoDocumentListView(loadDemoDocuments(accountId))
}

export async function addDemoDocument({ file, title, accountId }) {
  if (!accountId) throw new Error('Sign in before uploading a file.')
  const parsed = await parseDemoFile(file)
  const document = {
    id: `demo-${crypto.randomUUID()}`,
    title: title?.trim() || parsed.title,
    filename: parsed.filename,
    sizeBytes: parsed.sizeBytes,
    text: parsed.text,
    uploadedAt: new Date().toISOString(),
  }

  const ingestion = await fetch('/api/demo/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(document),
  })
  const ingestionPayload = await ingestion.json()
  if (!ingestion.ok) throw new Error(ingestionPayload.error || 'Document ingestion failed.')
  if (ingestionPayload.persistent !== true) {
    throw new Error('The document was not durably stored. Please try again.')
  }
  document.ingestion = {
    persistent: ingestionPayload.persistent,
    chunkCount: ingestionPayload.chunkCount,
  }

  try {
    addDemoDocumentToStore(accountId, document)
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      throw new Error('Browser storage full. Remove a file or use a smaller document.')
    }
    throw err
  }

  return document
}

export async function deleteDemoDocument(id, accountId) {
  if (!accountId) throw new Error('Sign in before deleting a file.')
  const response = await fetch('/api/demo/ingest', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Document deletion failed.')
  return demoDocumentListView(removeDemoDocumentFromStore(accountId, id))
}
