import { createHash } from 'node:crypto'

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') || '127.0.0.1'
}

const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 100
const buckets = new Map()

export function checkApiRateLimit(request) {
  const now = Date.now()
  const key = createHash('sha256').update(getClientIp(request)).digest('hex')
  let bucket = buckets.get(key)

  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    bucket = { startedAt: now, count: 0 }
    buckets.set(key, bucket)
  }

  bucket.count += 1
  if (buckets.size > 10_000) {
    for (const [bucketKey, value] of buckets) {
      if (now - value.startedAt >= WINDOW_MS) buckets.delete(bucketKey)
    }
  }

  if (bucket.count <= MAX_REQUESTS_PER_WINDOW) return null
  const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - bucket.startedAt)) / 1000))
  return Response.json(
    { error: 'Too many requests. Please wait a minute and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}
