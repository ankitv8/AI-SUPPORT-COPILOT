import { handleChatRequest } from '../../../lib/api/chatHandler.js'
import { checkApiRateLimit } from '../../../lib/core/apiRateLimit.js'
import { isDatabaseConnectionError } from '../../../lib/core/db.js'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  try {
    return await handleChatRequest(request)
  } catch (error) {
    console.error('[chat] request failed', error)
    if (isDatabaseConnectionError(error)) {
      return Response.json(
        { error: 'The account database is temporarily unreachable. Please try again shortly.' },
        { status: 503 },
      )
    }
    return Response.json({ error: 'Chat is temporarily unavailable. Please try again.' }, { status: 500 })
  }
}
