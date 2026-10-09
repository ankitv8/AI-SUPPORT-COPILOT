import { clearSession, destroySession, getUserFromRequest, hasAuthDatabase } from '../../../../lib/core/auth.js'
import { checkApiRateLimit } from '../../../../lib/core/apiRateLimit.js'

export const runtime = 'nodejs'

export async function GET(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  if (!hasAuthDatabase()) return Response.json({ user: null, configured: false })
  try {
    return Response.json({ user: await getUserFromRequest(request), configured: true })
  } catch (error) {
    console.error('[auth-me] database request failed', error)
    return Response.json(
      { error: 'Account service is temporarily unavailable. Please try again.' },
      { status: 503 },
    )
  }
}

export async function DELETE(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  try {
    await destroySession(request)
    return clearSession(Response.json({ ok: true }))
  } catch (error) {
    console.error('[auth-logout] session revocation failed', error)
    return clearSession(Response.json(
      { error: 'Could not revoke the session from the database.' },
      { status: 503 },
    ))
  }
}