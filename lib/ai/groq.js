const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

export const CHAT_MODEL = process.env.GROQ_CHAT_MODEL || 'openai/gpt-oss-120b'

export function assertProviderKeys() {
  const missing = []
  if (!process.env.GROQ_API_KEY) missing.push('GROQ_API_KEY')
  if (!process.env.HF_TOKEN) missing.push('HF_TOKEN')

  if (missing.length) {
    throw new Error(`Missing ${missing.join(' and ')}. Add them to .env.local.`)
  }
}

async function requestGroq(body) {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Groq request failed (${response.status}): ${detail.slice(0, 300)}`)
  }

  return response
}

export function createGroqChatCompletion({ model, messages, tools }) {
  return requestGroq({
    model,
    messages,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    temperature: 0.1,
  }).then((response) => response.json())
}

export async function* streamGroqChatCompletion({ model, messages }) {
  const response = await requestGroq({
    model,
    messages,
    temperature: 0.35,
    stream: true,
    stream_options: { include_usage: true },
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') return
        yield JSON.parse(payload)
      }
    }
  } finally {
    reader.releaseLock()
  }
}