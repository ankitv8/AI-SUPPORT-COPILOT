import { clearSession, destroySession, getUserFromRequest, hasAuthDatabase } from '../../../../lib/core/auth.js'

export const runtime = 'nodejs'

export async function GET(request) {
  if (!hasAuthDatabase()) return Response.json({ user: null, configured: false })
  return Response.json({ user: await getUserFromRequest(request), configured: true })
}

export async function DELETE(request) {
  await destroySession(request)
  return clearSession(Response.json({ ok: true }))
}