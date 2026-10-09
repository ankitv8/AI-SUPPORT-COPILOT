import { getUserTokenUsage } from './userUsageStore.js'

export async function checkApiTokenBudget(user) {
  const usage = await getUserTokenUsage(user.id)
  if (!usage.exceeded) return null

  return Response.json({ error: 'Account token usage limit reached.' }, { status: 429 })
}
