import { MAX_DEMO_UPLOADS_PER_SESSION } from '../../platform/demo/session.js'

function storageKey(accountId) {
  if (typeof accountId !== 'string' || !accountId.trim()) {
    throw new Error('A signed-in account is required to access uploaded files.')
  }
  return `account-documents:${accountId}`
}

export function loadDemoDocuments(accountId) {
  if (typeof window === 'undefined') return []

  try {
    const raw = sessionStorage.getItem(storageKey(accountId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveDemoDocuments(accountId, documents) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(storageKey(accountId), JSON.stringify(documents))
}

export function clearDemoDocuments(accountId) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(storageKey(accountId))
    sessionStorage.removeItem('demo-browser-documents')
  } catch (error) {
    console.error('[documents] failed to clear browser session files', error)
  }
}

export function addDemoDocumentToStore(accountId, document) {
  const documents = loadDemoDocuments(accountId)
  if (documents.length >= MAX_DEMO_UPLOADS_PER_SESSION) {
    throw new Error(`Demo limit: ${MAX_DEMO_UPLOADS_PER_SESSION} uploads per browser session.`)
  }
  documents.push(document)
  saveDemoDocuments(accountId, documents)
  return document
}

export function removeDemoDocumentFromStore(accountId, id) {
  const documents = loadDemoDocuments(accountId).filter((doc) => doc.id !== id)
  saveDemoDocuments(accountId, documents)
  return documents
}

/** Metadata for UI lists; document text and local fallback embeddings stay in sessionStorage. */
export function demoDocumentListView(documents) {
  return documents.map(({ id, title, filename, sizeBytes, uploadedAt }) => ({
    id,
    title,
    filename,
    sizeBytes,
    uploadedAt,
  }))
}
