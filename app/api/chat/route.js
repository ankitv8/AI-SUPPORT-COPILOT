import { handleChatRequest } from '../../../lib/api/chatHandler.js'
import { checkApiRateLimit } from '../../../lib/core/apiRateLimit.js'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit
  return handleChatRequest(request)
}
