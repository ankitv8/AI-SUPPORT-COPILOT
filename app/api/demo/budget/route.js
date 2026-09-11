import { isDemoEnabled } from '../../../../platform/demo/index.js'
import { appendGuestCookie, resolveGuestContextFromRequest } from '../../../../lib/core/guestIdentity.js'
import { getGuestBudgetSnapshot } from '../../../../lib/core/guestUsageStore.js'
import { getUserFromRequest } from '../../../../lib/core/auth.js'
import { getUserTokenUsage } from '../../../../lib/core/userUsageStore.js'

export const runtime = 'nodejs'

export async function GET(request) {
  if (!isDemoEnabled()) {
    return Response.json({ error: 'Demo is disabled.' }, { status: 404 })
  }

  const user = await getUserFromRequest(request)
  const guestCtx = resolveGuestContextFromRequest(request)
  const snapshot = user ? await getUserTokenUsage(user.id) : await getGuestBudgetSnapshot(guestCtx)
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  appendGuestCookie(headers, guestCtx)

  return Response.json(snapshot, { headers })
}
