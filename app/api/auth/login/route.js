import { authenticateUser, createSession, hasAuthDatabase, withSession } from '../../../../lib/core/auth.js'

export const runtime = 'nodejs'

export async function POST(request) {
  if (!hasAuthDatabase()) return Response.json({ error: 'Authentication is not configured.' }, { status: 503 })
  try {
    const { email, password } = await request.json()
    const user = await authenticateUser(String(email || ''), String(password || ''))
    if (!user) return Response.json({ error: 'Invalid email or password.' }, { status: 401 })
    return withSession(Response.json({ user }), await createSession(user.id))
  } catch (error) {
    return Response.json({ error: error.message || 'Login failed.' }, { status: 500 })
  }
}
