export const MAX_CHUNKS_PER_DOCUMENT = 100

export function chunkByParagraph(doc, maxChars = 700) {
  const paragraphs = doc.text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean)

  const chunks = []
  let current = ''

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) chunks.push(current)
      current = ''
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        chunks.push(paragraph.slice(offset, offset + maxChars))
      }
      continue
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph

    if (next.length > maxChars && current) {
      chunks.push(current)
      current = paragraph
    } else {
      current = next
    }
  }

  if (current) chunks.push(current)

  return chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT).map((text, index) => ({
    id: `${doc.id}:chunk:${index + 1}`,
    tenantId: doc.tenantId,
    sourceId: doc.id,
    title: doc.title,
    url: doc.url,
    text,
    chunkIndex: index + 1,
  }))
}
