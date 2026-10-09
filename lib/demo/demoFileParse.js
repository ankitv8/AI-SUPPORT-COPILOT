import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from '../knowledge/documentTypes'
import {
  inferTitle,
  normalizeExtractedText,
  parseJsonText,
  stripHtml,
} from '../knowledge/textParsing.js'

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.html', '.htm'])

function validateFile(file) {
  if (!file || typeof file === 'string') throw new Error('file is required')
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large. Max size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`)
  }

  const filename = file.name || 'upload.txt'
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : ''
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported extension. Allowed: ${ACCEPTED_EXTENSIONS.join(', ')}`)
  }
  return { filename, ext, mimeType: file.type || '' }
}

async function parsePdfOnServer(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/demo/parse', { method: 'POST', body: formData })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Failed to parse PDF')
  return json
}

/** Parse a demo file in the browser; PDFs use a stateless server parse (no DB). */
export async function parseDemoFile(file) {
  const { filename, ext, mimeType } = validateFile(file)

  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const parsed = await parsePdfOnServer(file)
    return {
      title: parsed.title || inferTitle(filename, parsed.text),
      text: normalizeExtractedText(parsed.text),
      filename,
      sizeBytes: file.size,
    }
  }

  let text = await file.text()
  if (ext === '.json' || mimeType === 'application/json') {
    text = parseJsonText(text)
  } else if (ext === '.html' || ext === '.htm' || mimeType.includes('html')) {
    text = stripHtml(text)
  } else if (!TEXT_EXTENSIONS.has(ext) && !mimeType.startsWith('text/')) {
    throw new Error(`Unsupported file type: ${ext || mimeType}`)
  }

  text = normalizeExtractedText(text)
  return {
    title: inferTitle(filename, text),
    text,
    filename,
    sizeBytes: file.size,
  }
}
