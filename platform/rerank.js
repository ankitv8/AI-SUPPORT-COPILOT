function terms(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2),
  )
}

function overlapScore(queryTerms, documentTerms) {
  if (!queryTerms.size) return 0
  let matches = 0
  for (const term of queryTerms) {
    if (documentTerms.has(term)) matches += 1
  }
  return matches / queryTerms.size
}

export function applyRerankRules(chunks, { question }) {
  const queryText = String(question || '').toLowerCase().trim()
  const queryTerms = terms(queryText)

  return [...chunks]
    .map((chunk) => {
      const content = `${chunk.title || ''} ${chunk.text || ''}`.toLowerCase()
      const lexicalOverlap = overlapScore(queryTerms, terms(content))
      const phraseBoost = queryText.length > 3 && content.includes(queryText) ? 0.08 : 0
      const rerankBoost = lexicalOverlap * 0.12 + phraseBoost

      return {
        ...chunk,
        rerankBoost: Number(rerankBoost.toFixed(4)),
        score: Number((Number(chunk.score || 0) + rerankBoost).toFixed(4)),
      }
    })
    .sort((a, b) => b.score - a.score)
}
