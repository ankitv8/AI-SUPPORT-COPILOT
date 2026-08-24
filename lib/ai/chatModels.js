import { CHAT_MODEL } from './groq.js'
import { MODEL_PRICING } from '../core/pricing.js'

/** Chat + reasoning models users may pick in the UI (not embeddings). */
export const CHAT_MODEL_OPTIONS = [
  { id: 'openai/gpt-oss-120b', label: 'GPT OSS 120B', hint: 'Default · capable' },
  { id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B', hint: 'Fast open model' },
  { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B', hint: 'Alternative open model' },
].filter((opt) => MODEL_PRICING[opt.id])

const ALLOWED_CHAT_MODELS = new Set(CHAT_MODEL_OPTIONS.map((o) => o.id))

export function isAllowedChatModel(model) {
  return typeof model === 'string' && ALLOWED_CHAT_MODELS.has(model)
}

export function resolveChatModel(requested) {
  if (isAllowedChatModel(requested)) return requested
  return CHAT_MODEL
}

export { CHAT_MODEL as DEFAULT_CHAT_MODEL }
