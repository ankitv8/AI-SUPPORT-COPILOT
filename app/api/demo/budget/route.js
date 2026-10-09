import { isDemoEnabled } from '../../../../platform/demo/index.js'
import { requireAuthenticatedUser } from '../../../../lib/core/auth.js'
import { getUserTokenUsage } from '../../../../lib/core/userUsageStore.js'
import { checkApiRateLimit } from '../../../../lib/core/apiRateLimit.js'

export const runtime = 'nodejs'

export async function GET(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  try {
    const { user, response } = await requireAuthenticatedUser(request)
    if (response) return response
    if (!isDemoEnabled()) return Response.json({ error: 'Demo is disabled.' }, { status: 404 })

    return Response.json(await getUserTokenUsage(user.id), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[budget] account usage request failed', error)
    return Response.json(
      { error: 'Account service is temporarily unavailable. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
