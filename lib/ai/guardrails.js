import { fetchWithRetry } from '../core/retry.js'

const LAKERA_URL = (process.env.LAKERA_GUARD_URL || 'https://api.lakera.ai/v2/guard').replace(/\/$/, '')
const GUARDRAIL_TIMEOUT_MS = Number(process.env.GUARDRAIL_TIMEOUT_MS || 4000)

export function isManagedGuardrailConfigured() {
  return Boolean(process.env.LAKERA_API_KEY)
}

function requestHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.LAKERA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.LAKERA_API_KEY}`
  }
  return headers
}

function normalizeResult(payload) {
  const blocked = payload?.flagged === true || payload?.blocked === true || payload?.allowed === false || payload?.verdict === 'unsafe'
  return {
    allowed: !blocked,
    reason: payload?.reason || payload?.message || (blocked ? 'Content did not pass the safety policy.' : null),
    categories: payload?.categories || payload?.violations || payload?.results || [],
  }
}

export async function evaluateManagedGuardrail({ type, text, context = '' }) {
  if (!isManagedGuardrailConfigured()) return { allowed: true, skipped: true }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GUARDRAIL_TIMEOUT_MS)
  try {
    const response = await fetchWithRetry(LAKERA_URL, {
      method: 'POST',
      headers: requestHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        messages: [{ role: type === 'output' ? 'assistant' : 'user', content: context ? `${context}\n\n${text}` : text }],
      }),
    }, { attempts: 2, timeoutMs: GUARDRAIL_TIMEOUT_MS })
    if (!response.ok) {
      throw new Error(`Guardrail service failed (${response.status})`)
    }
    return normalizeResult(await response.json())
  } catch (error) {
    if (process.env.GUARDRAIL_FAIL_OPEN === 'true') {
      return { allowed: true, degraded: true, reason: error.message }
    }
    return { allowed: false, reason: 'Safety service unavailable. Please try again shortly.', error: error.message }
  } finally {
    clearTimeout(timeout)
  }
}
