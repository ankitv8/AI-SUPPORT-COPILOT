import { applyRerankRules } from '../../platform/rerank.js'

/** Lightweight generic reranker for candidate tie-breaking after retrieval. */
export function rerankChunks(chunks, options) {
  return applyRerankRules(chunks, options)
}
