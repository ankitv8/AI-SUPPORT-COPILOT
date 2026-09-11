import {
  addDemoDocumentToStore,
  demoDocumentListView,
  loadDemoDocuments,
  removeDemoDocumentFromStore,
} from './demoBrowserStore.js'
import { parseDemoFile } from './demoFileParse.js'

export function getDemoDocumentsForChat() {
  return loadDemoDocuments()
}

export function listDemoDocumentsForUi() {
  return demoDocumentListView(loadDemoDocuments())
}

export async function addDemoDocument({ file, title }) {
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
  if (!ingestionPayload.persistent) document.embeddedChunks = ingestionPayload.embeddedChunks
  document.ingestion = {
    persistent: ingestionPayload.persistent,
    chunkCount: ingestionPayload.chunkCount,
  }

  try {
    addDemoDocumentToStore(document)
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      throw new Error('Browser storage full. Remove a file or use a smaller document.')
    }
    throw err
  }

  return document
}

export async function deleteDemoDocument(id) {
  const response = await fetch('/api/demo/ingest', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Document deletion failed.')
  return demoDocumentListView(removeDemoDocumentFromStore(id))
}
