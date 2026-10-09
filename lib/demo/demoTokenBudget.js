import {
  DEFAULT_TOKEN_BUDGET,
  getDemoTokenBudgetRemaining,
  isDemoTokenBudgetExceeded,
  normalizeTokenUsage,
} from './tokenBudget.js'

function budgetSnapshotKey(accountId) {
  if (typeof accountId !== 'string' || !accountId.trim()) {
    throw new Error('A signed-in account is required to access its token budget.')
  }
  return `account-token-budget-snapshot:${accountId}`
}

export function getCachedAccountBudgetSnapshot(accountId) {
  if (typeof window === 'undefined') return null

  try {
    const raw = localStorage.getItem(budgetSnapshotKey(accountId))
    if (!raw) return null
    const snapshot = JSON.parse(raw)
    if (snapshot?.source !== 'database') return null
    const budget = normalizeTokenUsage(snapshot?.budget)
    if (budget <= 0) return null

    const used = normalizeTokenUsage(snapshot.used)
    return {
      used,
      budget,
      remaining: Math.max(0, budget - used),
      exceeded: used >= budget,
      source: snapshot.source || 'server',
    }
  } catch {
    return null
  }
}

function cacheServerBudgetSnapshot(accountId, snapshot) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(budgetSnapshotKey(accountId), JSON.stringify(snapshot))
  } catch {
    // The live server response remains usable when browser storage is unavailable.
  }
}

export function clearCachedAccountBudgetSnapshot(accountId) {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(budgetSnapshotKey(accountId))
  } catch {
    // Cache removal is best effort; server authorization remains authoritative.
  }
}

export function applyAccountTokenUsageFromServer(payload, accountId) {
  if (!payload) return getCachedAccountBudgetSnapshot(accountId)

  if (typeof payload.sessionTokens === 'number') {
    const snapshot = {
      used: normalizeTokenUsage(payload.sessionTokens),
      budget: normalizeTokenUsage(payload.budget ?? DEFAULT_TOKEN_BUDGET),
      remaining: payload.remaining ?? getDemoTokenBudgetRemaining(payload.sessionTokens, payload.budget ?? DEFAULT_TOKEN_BUDGET),
      exceeded: payload.exceeded ?? isDemoTokenBudgetExceeded(payload.sessionTokens, payload.budget ?? DEFAULT_TOKEN_BUDGET),
      source: payload.source ?? 'database',
    }
    cacheServerBudgetSnapshot(accountId, snapshot)
    return snapshot
  }

  return getCachedAccountBudgetSnapshot(accountId)
}

/** Fetch authoritative budget from server (survives localStorage clears). */
export async function fetchAccountTokenBudgetFromServer(accountId) {
  if (!accountId) throw new Error('Sign in to load the account token budget.')
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res
    try {
      res = await fetch('/api/demo/budget', { credentials: 'include', cache: 'no-store' })
    } catch (error) {
      lastError = error
      if (attempt === 2) break
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      continue
    }

    if (!res.ok) {
      lastError = new Error('Failed to load token budget')
      if (res.status < 500 || attempt === 2) throw lastError
    } else {
      const snapshot = await res.json()
      applyAccountTokenUsageFromServer({ sessionTokens: snapshot.used, ...snapshot }, accountId)
      return snapshot
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
  }
  throw lastError || new Error('Failed to load token budget')
}
