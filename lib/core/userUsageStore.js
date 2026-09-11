import { ensureDatabaseSchema, query } from './db.js'

const DEFAULT_USER_TOKEN_BUDGET = Number(process.env.USER_TOKEN_BUDGET || 100_000)

function normalize(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0
}

function snapshot(used) {
  const total = normalize(used)
  return {
    used: total,
    budget: DEFAULT_USER_TOKEN_BUDGET,
    remaining: Math.max(0, DEFAULT_USER_TOKEN_BUDGET - total),
    exceeded: total >= DEFAULT_USER_TOKEN_BUDGET,
    source: 'database',
  }
}

export async function getUserTokenUsage(userId) {
  await ensureDatabaseSchema()
  const result = await query('SELECT total_tokens FROM user_usage WHERE user_id = $1', [userId])
  return snapshot(result.rows[0]?.total_tokens || 0)
}

export async function addUserTokenUsage(userId, requestTokens) {
  const added = normalize(requestTokens)
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
