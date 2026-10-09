export function inferTitle(filename, text) {
  const base = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').trim()
  if (base) return base
  const firstLine = text.split('\n').find((line) => line.trim())
  return firstLine?.slice(0, 80) || 'Untitled document'
}

export function parseJsonText(raw) {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    return JSON.stringify(parsed, null, 2)
  } catch {
    return raw
  }
}

export function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeExtractedText(text) {
  const cleaned = String(text || '').replace(/\u0000/g, '').trim()
  if (!cleaned || cleaned.length < 20) {
    throw new Error('Could not extract enough text from this file (minimum 20 characters).')
  }
  return cleaned
}
