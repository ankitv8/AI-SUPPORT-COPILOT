import { registerUser, createSession, hasAuthDatabase, withSession } from '../../../../lib/core/auth.js'

export const runtime = 'nodejs'

export async function POST(request) {
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
    return Response.json({ error: error.message || 'Registration failed.' }, { status: 500 })
  }
}
