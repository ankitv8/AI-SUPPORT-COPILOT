import {
  applyAccountTokenUsageFromServer,
  getCachedAccountBudgetSnapshot,
} from '../demo/demoTokenBudget.js'

export const CHAT_TIMEOUT_MS = 55_000

export function applyChatStreamEvent(message, event) {
  if (event.type === 'token') {
    return { ...message, content: (message.content || '') + event.token }
  }
  if (event.type === 'replace') {
    return { ...message, content: event.text }
  }
  return message
}

export async function askCopilot({
  question,
  history = [],
  model,
  demoDocuments,
  accountId,
  onEvent,
  signal,
}) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    credentials: 'include',
    body: JSON.stringify({
      question,
      history,
      model,
      demoDocuments,
    }),
  })

  const contentType = res.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const json = await res.json()
    if (json.demoTokenUsage) {
      applyAccountTokenUsageFromServer(json.demoTokenUsage, accountId)
    }
    onEvent({ type: 'sources', sources: json.sources || [] })
    onEvent({ type: 'token', token: json.answer || json.error || 'No answer.' })
    return {
      demoTokenUsage: json.demoTokenUsage || null,
      traceId: json.traceId || null,
      chatModel: model,
    }
  }

  if (!res.ok || !res.body) {
    throw new Error(`Request failed: ${res.status}`)
  }

  let demoUsagePayload = null
  let traceId = null
  let chatModel = model

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const line = event.trim()
      if (!line.startsWith('data:')) continue

      const payload = line.replace(/^data:\s*/, '')
      if (payload === '[DONE]') {
        return {
          demoTokenUsage: demoUsagePayload || getCachedAccountBudgetSnapshot(accountId),
          traceId,
          chatModel,
        }
      }

      const parsed = JSON.parse(payload)
      if (parsed.type === 'meta') {
        traceId = parsed.traceId
        chatModel = parsed.chatModel || chatModel
      }
      if (parsed.type === 'demoUsage') {
        demoUsagePayload = parsed.demoTokenUsage
        onEvent(parsed)
        continue
      }

      if (parsed.type === 'error') {
        throw new Error(parsed.message || 'Chat is temporarily unavailable. Please try again.')
      }

      onEvent(parsed)
    }
  }

  throw new Error('The connection ended before the response completed. Please try again.')
}
