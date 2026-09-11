import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithRetry } from '../lib/core/retry.js'

test('retries transient responses and returns the successful response', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return calls === 1 ? new Response('busy', { status: 503 }) : new Response('ok', { status: 200 })
  }

  try {
    const response = await fetchWithRetry('https://example.test', {}, { attempts: 2, timeoutMs: 100 })
    assert.equal(response.status, 200)
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})