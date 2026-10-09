import { create } from 'zustand'
import { applyChatStreamEvent, askCopilot, CHAT_TIMEOUT_MS } from '../lib/chat/chatClient'
import { getDemoDocumentsForChat, listDemoDocumentsForUi } from '../lib/demo/demoClient'
import { clearDemoDocuments } from '../lib/demo/demoBrowserStore'
import { buildHistoryFromMessages, getStarterMessages } from '../lib/chat/chatHistory'
import {
  applyAccountTokenUsageFromServer,
  fetchAccountTokenBudgetFromServer,
  getCachedAccountBudgetSnapshot,
  clearCachedAccountBudgetSnapshot,
} from '../lib/demo/demoTokenBudget.js'
import { DEMO_TOKEN_LIMIT_MESSAGE } from '../lib/demo/tokenBudget.js'
import { recordClientUsage } from '../lib/core/clientUsageStore.js'
import { loadChatModelPreference, saveChatModelPreference } from '../lib/chat/chatModelPreference'
import { resolveChatModel } from '../lib/ai/chatModels'

let accountSessionVersion = 0

async function persistUsageFromChat({ demoTokenUsage, traceId, model }) {
  if (!demoTokenUsage?.requestTokens) return
  await recordClientUsage({
    endpoint: 'chat',
    model: model || 'gpt-4o-mini',
    inputTokens: demoTokenUsage.inputTokens,
    outputTokens: demoTokenUsage.outputTokens,
    traceId,
  })
}

export const useChatStore = create((set, get) => ({
  messages: getStarterMessages({ demoMode: true }),
  question: '',
  chatModel: loadChatModelPreference(),
  accountId: null,
  demoUploads: [],
  demoUploadStatus: 'idle',
  demoUploadError: '',
  demoTokenBudget: null,
  demoTokenBudgetStatus: 'loading',
  status: 'idle',
  error: '',
  abortController: null,

  configureDemo: (accountId) => {
    if (!accountId) return
    accountSessionVersion += 1
    const sessionVersion = accountSessionVersion
    get().abortController?.abort()
    set({
      accountId,
      abortController: null,
      demoUploads: listDemoDocumentsForUi(accountId),
      messages: getStarterMessages({ demoMode: true }),
      question: '',
      status: 'idle',
      error: '',
      demoUploadError: '',
      demoTokenBudget: getCachedAccountBudgetSnapshot(accountId),
      demoTokenBudgetStatus: 'loading',
    })
    void fetchAccountTokenBudgetFromServer(accountId)
      .then((budget) => {
        if (sessionVersion === accountSessionVersion) {
          set({ demoTokenBudget: budget, demoTokenBudgetStatus: 'ready' })
        }
      })
      .catch(() => {
        if (sessionVersion === accountSessionVersion) {
          set({
            demoTokenBudget:
              get().accountId === accountId
                ? get().demoTokenBudget || getCachedAccountBudgetSnapshot(accountId)
                : null,
            demoTokenBudgetStatus: 'error',
          })
        }
      })
  },

  clearAccountSession: () => {
    accountSessionVersion += 1
    const accountId = get().accountId
    get().abortController?.abort()
    if (accountId) {
      clearDemoDocuments(accountId)
      clearCachedAccountBudgetSnapshot(accountId)
    }
    set({
      accountId: null,
      messages: getStarterMessages({ demoMode: true }),
      question: '',
      demoUploads: [],
      demoUploadStatus: 'idle',
      demoUploadError: '',
      demoTokenBudget: null,
      demoTokenBudgetStatus: 'loading',
      status: 'idle',
      error: '',
      abortController: null,
    })
  },

  refreshDemoTokenBudget: () => {
    const accountId = get().accountId
    if (!accountId) return
    const sessionVersion = accountSessionVersion
    set({ demoTokenBudgetStatus: 'loading' })
    void fetchAccountTokenBudgetFromServer(accountId)
      .then((budget) => {
        if (sessionVersion === accountSessionVersion) {
          set({ demoTokenBudget: budget, demoTokenBudgetStatus: 'ready' })
        }
      })
      .catch(() => {
        if (sessionVersion === accountSessionVersion) {
          set({
            demoTokenBudget: get().demoTokenBudget || getCachedAccountBudgetSnapshot(accountId),
            demoTokenBudgetStatus: 'error',
          })
        }
      })
  },

  setDemoUploads: (demoUploads) => set({ demoUploads }),
  setDemoUploadStatus: (demoUploadStatus) => set({ demoUploadStatus }),
  setDemoUploadError: (demoUploadError) => set({ demoUploadError }),

  setQuestion: (question) => set({ question }),
  setChatModel: (chatModel) => {
    const resolved = resolveChatModel(chatModel)
    saveChatModelPreference(resolved)
    set({ chatModel: resolved })
  },
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: '' }),

  appendTurn: (userMessage, assistantMessage) =>
    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
    })),

  applyStreamEvent: (event, accountId = get().accountId) =>
    set((state) => {
      if (state.accountId !== accountId) return state
      const messages = [...state.messages]
      const idx = messages.length - 1
      if (idx < 0) return state

      const current = messages[idx]

      if (event.type === 'meta') {
        messages[idx] = {
          ...current,
          meta: {
            traceId: event.traceId,
            retrievalMode: event.retrievalMode,
            contextUsage: event.contextUsage,
            agentSteps: event.agentSteps,
            chatModel: event.chatModel,
          },
        }
      }

      if (event.type === 'demoUsage') {
        const budget = applyAccountTokenUsageFromServer(event.demoTokenUsage, accountId)
        const meta = messages[idx]?.meta
        void persistUsageFromChat({
          demoTokenUsage: event.demoTokenUsage,
          traceId: meta?.traceId,
          model: meta?.chatModel,
        })
        return { messages, demoTokenBudget: budget, demoTokenBudgetStatus: 'ready' }
      }

      if (event.type === 'sources') {
        messages[idx] = { ...messages[idx], sources: event.sources }
      }

      if (event.type === 'token') {
        messages[idx] = applyChatStreamEvent(messages[idx], event)
      } else if (event.type === 'replace') {
        messages[idx] = applyChatStreamEvent(messages[idx], event)
      }

      return { messages }
    }),

  stopGeneration: () => {
    get().abortController?.abort()
  },

  submitQuestion: async (text) => {
    const trimmed = text.trim()
    const {
      status,
      accountId,
      appendTurn,
      applyStreamEvent,
      setQuestion,
      setStatus,
      setError,
      clearError,
      chatModel,
    } =
      get()

    if (!trimmed || status === 'streaming' || !accountId) return
    const requestSessionVersion = accountSessionVersion

    const budget = get().demoTokenBudget
    if (budget?.exceeded) {
      setError(budget.source === 'database' ? 'Account token limit reached.' : DEMO_TOKEN_LIMIT_MESSAGE)
      setStatus('error')
      return
    }

    const history = buildHistoryFromMessages(get().messages)

    const userMessage = { role: 'user', content: trimmed, sources: [] }
    const assistantMessage = { role: 'assistant', content: '', sources: [] }

    appendTurn(userMessage, assistantMessage)
    setQuestion('')
    setStatus('streaming')
    clearError()

    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, CHAT_TIMEOUT_MS)
    set({ abortController: controller })

    try {
      const result = await askCopilot({
        question: trimmed,
        history,
        model: chatModel,
        demoDocuments: getDemoDocumentsForChat(accountId),
        accountId,
        signal: controller.signal,
        onEvent: (event) => applyStreamEvent(event, accountId),
      })
      if (requestSessionVersion !== accountSessionVersion || get().accountId !== accountId) return
      if (result?.demoTokenUsage) {
        set({
          demoTokenBudget: applyAccountTokenUsageFromServer(result.demoTokenUsage, accountId),
          demoTokenBudgetStatus: 'ready',
        })
        const last = get().messages.at(-1)
        await persistUsageFromChat({
          demoTokenUsage: result.demoTokenUsage,
          traceId: result.traceId || last?.meta?.traceId,
          model: result.chatModel || last?.meta?.chatModel || chatModel,
        })
      }
      setStatus('idle')
    } catch (err) {
      if (
        requestSessionVersion !== accountSessionVersion ||
        get().accountId !== accountId ||
        get().abortController !== controller
      )
        return
      const message = timedOut
        ? 'This response is taking too long. Please try again.'
        : err.name === 'AbortError'
          ? 'Response stopped. You can ask again.'
          : 'Chat is temporarily unavailable. Please try again.'

      set((state) => {
        const messages = [...state.messages]
        const lastIndex = messages.length - 1
        if (lastIndex >= 0 && messages[lastIndex].role === 'assistant') {
          const content = messages[lastIndex].content
          messages[lastIndex] = {
            ...messages[lastIndex],
            content: content ? `${content}\n\n${message}` : message,
          }
        }
        return { messages }
      })

      if (err.name === 'AbortError' && !timedOut) {
        setStatus('stopped')
        return
      }
      setError('')
      setStatus('error')
    } finally {
      clearTimeout(timeout)
      if (get().abortController === controller) set({ abortController: null })
    }
  },
}))
