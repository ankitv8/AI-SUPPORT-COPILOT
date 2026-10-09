import {
  DEFAULT_USD_TO_INR,
  MODEL_PRICING,
  calculateCost,
  formatInr,
  formatUsd,
} from '../lib/core/pricing.js'

export const modelPricingMeta = {
  title: 'Provider model pricing',
  intro:
    'Published rates per model for 1M tokens: input, output, and combined total (input + output). USD and INR (₹) shown for each. Live usage is tracked in your Usage dashboard.',
  formula: 'Cost = (input tokens ÷ 1M × input rate) + (output tokens ÷ 1M × output rate). Total column = input + output at 1M each.',
}

export const envVarRows = [
  { variable: 'GROQ_API_KEY', default: '—', description: 'Required — Groq API authentication' },
  { variable: 'GROQ_CHAT_MODEL', default: 'openai/gpt-oss-120b', description: 'Chat and planning' },
  { variable: 'WEAVIATE_URL', default: '—', description: 'Required — persistent document text and vector storage' },
  { variable: 'WEAVIATE_API_KEY', default: '—', description: 'Optional — Weaviate authentication' },
  { variable: 'USD_TO_INR', default: String(DEFAULT_USD_TO_INR), description: 'INR conversion in Usage dashboard' },
]

const DEFAULT_CHAT = 'openai/gpt-oss-120b'
const DEFAULT_EMBED = 'Xenova/bge-small-en-v1.5'

function scenarioCost({ inputTokens, outputTokens, model }) {
  const { usd, inr } = calculateCost({ inputTokens, outputTokens, model })
  return { usd, inr, usdLabel: formatUsd(usd), inrLabel: formatInr(inr) }
}

function combinedScenario(parts) {
  const usd = parts.reduce((sum, p) => sum + p.usd, 0)
  const inr = parts.reduce((sum, p) => sum + p.inr, 0)
  return { usdLabel: formatUsd(usd), inrLabel: formatInr(inr) }
}

export const usageScenarioRows = [
  (() => {
    const chat = scenarioCost({ inputTokens: 5500, outputTokens: 650, model: DEFAULT_CHAT })
    const embed = scenarioCost({ inputTokens: 400, outputTokens: 0, model: DEFAULT_EMBED })
    const total = combinedScenario([chat, embed])
    return { action: 'One chat question', estUsd: total.usdLabel, estInr: total.inrLabel }
  })(),
  (() => {
    const cost = scenarioCost({ inputTokens: 20000, outputTokens: 0, model: DEFAULT_EMBED })
    return { action: 'Embed one upload (~10 pages)', estUsd: cost.usdLabel, estInr: cost.inrLabel }
  })(),
  (() => {
    const chat = scenarioCost({ inputTokens: 550000, outputTokens: 65000, model: DEFAULT_CHAT })
    const embed = scenarioCost({ inputTokens: 40000, outputTokens: 0, model: DEFAULT_EMBED })
    const total = combinedScenario([chat, embed])
    return { action: '100 questions / day', estUsd: total.usdLabel, estInr: total.inrLabel }
  })(),
]

export const modelCatalog = [
  {
    model: 'openai/gpt-oss-120b',
    type: 'Chat',
    ...MODEL_PRICING['openai/gpt-oss-120b'],
    usedFor: 'Default chat model',
    recommended: true,
  },
  {
    model: 'openai/gpt-oss-20b',
    type: 'Chat',
    ...MODEL_PRICING['openai/gpt-oss-20b'],
    usedFor: 'Higher-quality mini tier',
  },
  {
    model: 'qwen/qwen3.8-27b',
    type: 'Chat',
    ...MODEL_PRICING['qwen/qwen3.8-27b'],
    usedFor: 'High-volume simple tasks',
  },
  {
    model: 'openai/gpt-oss-20b',
    type: 'Chat',
    ...MODEL_PRICING['openai/gpt-oss-20b'],
    usedFor: 'Newer mini tier',
  },
  {
    model: 'gpt-4.1',
    type: 'Chat',
    ...MODEL_PRICING['gpt-4.1'],
    usedFor: 'Higher quality',
  },
  {
    model: 'gpt-4o',
    type: 'Chat',
    ...MODEL_PRICING['gpt-4o'],
    usedFor: 'Premium chat',
  },
  {
    model: 'gpt-5',
    type: 'Chat',
    ...MODEL_PRICING['gpt-5'],
    usedFor: 'Frontier chat',
  },
  {
    model: 'o4-mini',
    type: 'Reasoning',
    ...MODEL_PRICING['o4-mini'],
    usedFor: 'Reasoning (+ hidden tokens)',
  },
  {
    model: 'o3-mini',
    type: 'Reasoning',
    ...MODEL_PRICING['o3-mini'],
    usedFor: 'Budget reasoning',
  },
  {
    model: 'Xenova/bge-small-en-v1.5',
    type: 'Embedding',
    ...MODEL_PRICING['Xenova/bge-small-en-v1.5'],
    usedFor: 'Default embeddings',
    recommended: true,
  },
]

/** Price for N million tokens at the per-1M rate. */
export function formatVolumePrice(usdPerMillion, millions = 1) {
  if (usdPerMillion === 0) return { usd: '—', inr: '—' }
  const usd = usdPerMillion * millions
  return {
    usd: formatUsd(usd),
    inr: formatInr(usd * DEFAULT_USD_TO_INR),
  }
}

/** Combined input + output price for N million tokens of each. */
export function formatTotalVolumePrice(inputPerMillion, outputPerMillion, millions = 1) {
  const totalUsd = (inputPerMillion + outputPerMillion) * millions
  if (totalUsd === 0) return { usd: '—', inr: '—' }
  return {
    usd: formatUsd(totalUsd),
    inr: formatInr(totalUsd * DEFAULT_USD_TO_INR),
  }
}

export { formatUsd, formatInr, DEFAULT_USD_TO_INR }
