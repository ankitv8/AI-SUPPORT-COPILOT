import { checkApiRateLimit } from '../../../lib/core/apiRateLimit.js'
import { checkWeaviateReadiness } from '../../../lib/rag/weaviate.js'

export const runtime = 'nodejs'

export async function GET(request) {
  const rateLimit = checkApiRateLimit(request)
  if (rateLimit) return rateLimit

  const ok = await checkWeaviateReadiness()
  return Response.json({ ok }, { headers: { 'Cache-Control': 'no-store' } })
}
