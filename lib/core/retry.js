export async function fetchWithRetry(url, options = {}, {
  attempts = 3,
  timeoutMs = 10000,
  shouldRetry = (response) => response.status === 408 || response.status === 429 || response.status >= 500,
} = {}) {
  let lastError = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      if (!shouldRetry(response) || attempt === attempts - 1) return response
      lastError = new Error(`Retryable HTTP response: ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) throw error
    } finally {
      clearTimeout(timeout)
    }

    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
  }

  throw lastError || new Error('Request failed')
}