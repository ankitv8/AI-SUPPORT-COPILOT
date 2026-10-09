import { authenticateUser, createSession, hasAuthDatabase, withSession } from '../../../../lib/core/auth.js'
import { checkApiRateLimit } from '../../../../lib/core/apiRateLimit.js'

export const runtime = 'nodejs'

export async function POST(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  if (!hasAuthDatabase()) return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  try {
    const { email, password } = await request.json()
    const user = await authenticateUser(String(email || ''), String(password || ''))
    if (!user) return Response.json({ error: 'Invalid email or password.' }, { status: 401 })
    return withSession(Response.json({ user }), await createSession(user.id))
  } catch (error) {
    console.error('[auth-login] failed', error)
    return Response.json({ error: 'Sign-in failed. Please try again.' }, { status: 500 })
  }
}
