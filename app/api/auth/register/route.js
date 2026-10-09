import { registerUser, createSession, hasAuthDatabase, withSession } from '../../../../lib/core/auth.js'
import { checkApiRateLimit } from '../../../../lib/core/apiRateLimit.js'

export const runtime = 'nodejs'

export async function POST(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  if (!hasAuthDatabase()) return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  try {
    const { email, password } = await request.json()
    if (!email || typeof email !== 'string' || !password || password.length < 8) {
      return Response.json({ error: 'Use a valid email and a password of at least 8 characters.' }, { status: 400 })
    }
    const user = await registerUser(email, password)
    return withSession(Response.json({ user }), await createSession(user.id))
  } catch (error) {
    if (error.code === '23505') return Response.json({ error: 'An account with that email already exists.' }, { status: 409 })
    console.error('[auth-register] failed', error)
    return Response.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
}
