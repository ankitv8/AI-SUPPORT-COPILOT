import { DEFAULT_USER_TOKEN_BUDGET } from '../core/tokenBudgetConfig.js'

export const DEFAULT_TOKEN_BUDGET = DEFAULT_USER_TOKEN_BUDGET

export const DEMO_TOKEN_LIMIT_MESSAGE =
  'Your account token limit has been reached.'

export function normalizeTokenUsage(value) {
  const raw = typeof value === 'object' && value != null ? value.totalTokens : value
  const number = Number(raw)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0
}

export function isDemoTokenBudgetExceeded(used, budget = DEFAULT_TOKEN_BUDGET) {
  return normalizeTokenUsage(used) >= budget
}

export function getDemoTokenBudgetRemaining(used, budget = DEFAULT_TOKEN_BUDGET) {
  return Math.max(0, budget - normalizeTokenUsage(used))
}

export function createDemoUsagePayload({ priorTokens, requestMeter, budget = DEFAULT_TOKEN_BUDGET }) {
  const inputTokens = normalizeTokenUsage(requestMeter?.inputTokens)
  const outputTokens = normalizeTokenUsage(requestMeter?.outputTokens)
  const requestTokens = inputTokens + outputTokens
  const sessionTokens = normalizeTokenUsage(priorTokens) + requestTokens

  return {
    requestTokens,
    inputTokens,
    outputTokens,
    sessionTokens,
    budget,
    remaining: getDemoTokenBudgetRemaining(sessionTokens, budget),
    exceeded: isDemoTokenBudgetExceeded(sessionTokens, budget),
  }
}

export function attachDemoTokenUsage(body, { priorTokens, requestMeter, budget = DEFAULT_TOKEN_BUDGET }) {
  return {
    ...body,
    demoTokenUsage: createDemoUsagePayload({ priorTokens, requestMeter, budget }),
  }
}
