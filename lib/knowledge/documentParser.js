import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from './documentTypes'
import { extractPdfText } from './pdfParse'
import { inferTitle, normalizeExtractedText, parseJsonText, stripHtml } from './textParsing.js'

export { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from './documentTypes'
export { inferTitle } from './textParsing.js'

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.html', '.htm'])

async function parsePdf(buffer) {
  return extractPdfText(buffer)
}

export async function parseUploadedFile({ buffer, filename, mimeType = '' }) {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : ''
  const lowerMime = mimeType.toLowerCase()

  let text = ''

  if (ext === '.pdf' || lowerMime === 'application/pdf') {
    text = await parsePdf(buffer)
  } else if (ext === '.json' || lowerMime === 'application/json') {
    text = parseJsonText(buffer.toString('utf8'))
  } else if (TEXT_EXTENSIONS.has(ext) || lowerMime.startsWith('text/')) {
    text = buffer.toString('utf8')
    if (ext === '.html' || ext === '.htm' || lowerMime.includes('html')) {
      text = stripHtml(text)
    }
  } else {
    throw new Error(`Unsupported file type: ${ext || mimeType || 'unknown'}. Use ${ACCEPTED_EXTENSIONS.join(', ')}`)
  }

  text = normalizeExtractedText(text)

  return {
    title: inferTitle(filename, text),
    text,
    extension: ext,
  }
}
