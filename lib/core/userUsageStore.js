import { ensureDatabaseSchema, query, tryAcquireAdvisoryLock } from './db.js'
import { normalizeTokenUsage } from '../demo/tokenBudget.js'
import { getUserTokenBudget } from './tokenBudgetConfig.js'

function snapshot(used) {
  const total = normalizeTokenUsage(used)
  const budget = getUserTokenBudget()
  return {
    used: total,
    budget,
    remaining: Math.max(0, budget - total),
    exceeded: total >= budget,
    source: 'database',
  }
}

export async function getUserTokenUsage(userId) {
  await ensureDatabaseSchema()
  const result = await query('SELECT total_tokens FROM user_usage WHERE user_id = $1', [userId])
  return snapshot(result.rows[0]?.total_tokens || 0)
}

export function tryAcquireUserUsageLock(userId) {
  return tryAcquireAdvisoryLock(`user-token-budget:${userId}`)
}

export async function addUserTokenUsage(userId, requestTokens) {
  const added = normalizeTokenUsage(requestTokens)
  if (!added) return getUserTokenUsage(userId)

  await ensureDatabaseSchema()
  const result = await query(
    `INSERT INTO user_usage (user_id, total_tokens, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET total_tokens = user_usage.total_tokens + EXCLUDED.total_tokens, updated_at = NOW()
     RETURNING total_tokens`,
    [userId, added],
  )
  return snapshot(result.rows[0].total_tokens)
}
