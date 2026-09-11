import { AGENT_STEPS, createAgentRun } from '../ai/agent.js'
import { estimateContextUsage, estimateTokens } from '../ai/llm.js'
import { assertProviderKeys, createGroqChatCompletion, streamGroqChatCompletion } from '../ai/groq.js'
import { resolveChatModel } from '../ai/chatModels.js'
import {
  buildReActSystemPrompt,
  buildRetrievalQuery,
  buildSupportPrompt,
  normalizeChatHistory,
  publicSources,
  shouldAnswerFromRetrieval,
} from '../ai/prompt.js'
import { detectPromptInjection } from '../core/security.js'
import { evaluateManagedGuardrail } from '../ai/guardrails.js'
import { appendGuestCookie, resolveGuestContextFromRequest } from '../core/guestIdentity.js'
import { recordGuestTokenUsage, resolveGuestPriorTokens } from '../core/guestUsageStore.js'
import { isDemoEnabled } from '../../platform/demo/index.js'
import { retrieveDemoChunks, validateDemoDocuments } from '../demo/demoRetrieval.js'
import {
  attachDemoTokenUsage,
  createDemoUsagePayload,
  DEMO_GUEST_TOKEN_BUDGET,
  rejectDemoIfBudgetExceeded,
} from './demoTokenBudget.js'
import { getAgentTools, runToolCall } from '../../platform/tools.js'
import { logAiEvent, measure } from '../core/telemetry.js'
import { getUserFromRequest, hasAuthDatabase } from '../core/auth.js'
import { getOwnedDocumentIds } from '../core/documents.js'
import { addUserTokenUsage, getUserTokenUsage } from '../core/userUsageStore.js'

function sseLine(payload) {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
}

function jsonWithGuest(body, guestCtx, init = {}) {
  const headers = new Headers(init.headers)
  appendGuestCookie(headers, guestCtx)
  return Response.json(body, { ...init, headers })
}

async function persistGuestUsage(guestCtx, sessionTokens) {
  await recordGuestTokenUsage({
    guestId: guestCtx.guestId,
    ipHash: guestCtx.ipHash,
    sessionTokens,
  })
}

async function persistUsage({ user, guestCtx, priorTokens, requestTokens }) {
  if (user) return addUserTokenUsage(user.id, requestTokens)
  await persistGuestUsage(guestCtx, priorTokens + requestTokens)
  return null
}

export async function handleDemoChat(request) {
  assertProviderKeys()
  const guestCtx = resolveGuestContextFromRequest(request)
  const currentUser = await getUserFromRequest(request)

  const body = await request.json()
  const {
    question,
    demoDocuments,
    model: requestedModel,
    retrievalMode = 'hybrid',
    history = [],
  } = body

  const chatModel = resolveChatModel(requestedModel)
  const startedAt = performance.now()
  const traceId = crypto.randomUUID()
  const requestMeter = { inputTokens: 0, outputTokens: 0 }

  if (!question || typeof question !== 'string') {
    return Response.json({ error: 'question is required' }, { status: 400 })
  }

  if (!isDemoEnabled()) {
    return Response.json({ error: 'Demo is disabled.' }, { status: 400 })
  }

  if (hasAuthDatabase() && !currentUser) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const usage = currentUser
    ? await getUserTokenUsage(currentUser.id)
    : await resolveGuestPriorTokens(guestCtx).then((used) => ({ used, budget: DEMO_GUEST_TOKEN_BUDGET, remaining: Math.max(0, DEMO_GUEST_TOKEN_BUDGET - used), exceeded: used >= DEMO_GUEST_TOKEN_BUDGET }))
  const priorDemoTokens = usage.used
  const budgetReject = usage.exceeded
    ? {
        answer: 'Token usage limit reached for this account.',
        sources: [],
        demoTokenLimit: true,
        demoTokenUsage: { requestTokens: 0, inputTokens: 0, outputTokens: 0, sessionTokens: priorDemoTokens, budget: usage.budget, remaining: 0, exceeded: true, source: usage.source },
      }
    : null
  if (budgetReject) {
    return jsonWithGuest(
      {
        ...budgetReject,
        traceId,
        agent: createAgentRun({ question, traceId }).toJSON(),
      },
      guestCtx,
    )
  }

  const demoCheck = validateDemoDocuments(demoDocuments)
  if (!demoCheck.ok) {
    return jsonWithGuest(
      {
        answer: `${demoCheck.error} Upload a PDF, text, or JSON in the sidebar first.`,
        sources: [],
        traceId,
        agent: createAgentRun({ question, traceId }).toJSON(),
      },
      guestCtx,
    )
  }

  const ownedSourceIds = currentUser
    ? await getOwnedDocumentIds({ ids: demoCheck.documents.map((document) => document.id), userId: currentUser.id })
    : null
  if (currentUser && ownedSourceIds.length !== demoCheck.documents.length) {
    return jsonWithGuest({ error: 'One or more documents are not owned by this account.' }, guestCtx, { status: 403 })
  }

  const chatHistory = normalizeChatHistory(history)
  const retrievalQuery = buildRetrievalQuery(question, chatHistory)
  const agent = createAgentRun({ question, traceId })

  const injection = detectPromptInjection(question)
  agent.record(AGENT_STEPS.SECURITY, injection)

  if (injection.blocked) {
    return jsonWithGuest(
      {
        answer: injection.reason,
        sources: [],
        blocked: true,
        traceId,
      },
      guestCtx,
    )
  }

  const managedInputGuardrail = await evaluateManagedGuardrail({
    type: 'input',
    text: question,
  })
  agent.record(AGENT_STEPS.SECURITY, {
    managed: true,
    allowed: managedInputGuardrail.allowed,
    skipped: managedInputGuardrail.skipped,
  })

  if (!managedInputGuardrail.allowed) {
    return jsonWithGuest(
      {
        answer: managedInputGuardrail.reason,
        sources: [],
        blocked: true,
        traceId,
        agent: agent.toJSON(),
      },
      guestCtx,
    )
  }

  const retrieval = await measure('retrieval', () =>
    retrieveDemoChunks({
      documents: demoCheck.documents,
      question: retrievalQuery,
      k: 5,
      mode: retrievalMode,
      tokenMeter: requestMeter,
      userId: currentUser?.id,
      ownedSourceIds,
    }),
  )

  if (!retrieval.ok) {
    return jsonWithGuest({ error: retrieval.error.message }, guestCtx, { status: 500 })
  }

  const retrievedChunks = retrieval.result
  agent.record(AGENT_STEPS.RETRIEVE, {
    mode: retrievalMode,
    chunkIds: retrievedChunks.map((c) => c.id),
    topScore: retrievedChunks[0]?.score,
  })

  const contextChecks = await Promise.all(
    retrievedChunks.map((chunk) => evaluateManagedGuardrail({
      type: 'context',
      text: question,
      context: chunk.text,
    })),
  )
  const chunks = retrievedChunks.filter((_, index) => contextChecks[index].allowed)
  const sources = publicSources(chunks)
  agent.record(AGENT_STEPS.GUARDRAIL, {
    managed: true,
    scope: 'retrieved_context',
    allowed: chunks.length > 0 || retrievedChunks.length === 0,
    blockedChunkIds: retrievedChunks.filter((_, index) => !contextChecks[index].allowed).map((chunk) => chunk.id),
    skipped: contextChecks.every((check) => check.skipped),
  })
  const guardrailPass = shouldAnswerFromRetrieval(chunks, 0.12)
  agent.record(AGENT_STEPS.GUARDRAIL, { pass: guardrailPass })

  if (!guardrailPass) {
    const noDocs = chunks.length === 0
    const payload = attachDemoTokenUsage(
      {
        answer: noDocs
          ? 'I could not find anything in your uploaded file(s) for this question. Try rephrasing or ask about specific content in your document.'
          : 'I could not find a confident answer in your uploaded file(s). Try asking about specific content from that document.',
        sources,
        traceId,
        agent: agent.toJSON(),
      },
      { priorTokens: priorDemoTokens, requestMeter },
    )
    await persistUsage({ user: currentUser, guestCtx, priorTokens: priorDemoTokens, requestTokens: payload.demoTokenUsage.requestTokens })
    return jsonWithGuest(payload, guestCtx)
  }

  const systemPrompt = buildReActSystemPrompt()
  const userPrompt = buildSupportPrompt({
    question,
    chunks,
    style: 'cot',
    hasHistory: chatHistory.length > 0,
  })
  const contextUsage = estimateContextUsage({
    system: systemPrompt,
    user: userPrompt,
    chunks,
    history: chatHistory,
  })

  let messages = [{ role: 'system', content: systemPrompt }, ...chatHistory, { role: 'user', content: userPrompt }]

  const planning = await createGroqChatCompletion({
    model: chatModel,
    messages,
    tools: getAgentTools(),
  })

  requestMeter.inputTokens += planning.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages))
  requestMeter.outputTokens += planning.usage?.completion_tokens ?? 0

  const assistantMessage = planning.choices[0]?.message
  agent.record(AGENT_STEPS.PLAN, {
    toolCalls: assistantMessage?.tool_calls?.map((t) => t.function?.name) ?? [],
  })

  if (assistantMessage?.tool_calls?.length) {
    messages.push(assistantMessage)
    for (const toolCall of assistantMessage.tool_calls) {
      const result = await runToolCall(toolCall)
      agent.record(AGENT_STEPS.TOOL, { name: toolCall.function?.name, result })
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      })
    }
  }

  if (priorDemoTokens + requestMeter.inputTokens + requestMeter.outputTokens >= usage.budget) {
    const payload = attachDemoTokenUsage(
      {
        answer: currentUser ? 'Token usage limit reached during this request.' : 'Free trial limit reached during this request.',
        sources,
        traceId,
        agent: agent.toJSON(),
        demoTokenLimit: true,
      },
      { priorTokens: priorDemoTokens, requestMeter },
    )
    await persistUsage({ user: currentUser, guestCtx, priorTokens: priorDemoTokens, requestTokens: payload.demoTokenUsage.requestTokens })
    return jsonWithGuest(payload, guestCtx)
  }

  const streamHeaders = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  })
  appendGuestCookie(streamHeaders, guestCtx)

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const write = (payload) => controller.enqueue(encoder.encode(sseLine(payload)))

      try {
        write({
          type: 'meta',
          traceId,
          retrievalMode,
          contextUsage,
          agentSteps: agent.steps,
          chatModel,
        })
        write({ type: 'sources', sources })

        agent.record(AGENT_STEPS.ANSWER, { streaming: true })

        let streamUsage = null
        let replyText = ''

        const response = streamGroqChatCompletion({
          model: chatModel,
          messages,
        })

        for await (const part of response) {
          const token = part.choices[0]?.delta?.content
          if (token) {
            replyText += token
          }
          if (part.usage) streamUsage = part.usage
        }

        const managedOutputGuardrail = await evaluateManagedGuardrail({
          type: 'output',
          text: replyText,
          context: chunks.map((chunk) => chunk.text).join('\n\n').slice(0, 12000),
        })
        agent.record(AGENT_STEPS.GUARDRAIL, {
          managed: true,
          allowed: managedOutputGuardrail.allowed,
          skipped: managedOutputGuardrail.skipped,
        })

        const safeReply = managedOutputGuardrail.allowed
          ? replyText
          : managedOutputGuardrail.reason || 'I cannot provide that response.'
        write({ type: 'token', token: safeReply })
        if (!managedOutputGuardrail.allowed) write({ type: 'blocked', reason: managedOutputGuardrail.reason })

        requestMeter.inputTokens += streamUsage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages))
        requestMeter.outputTokens += streamUsage?.completion_tokens ?? estimateTokens(replyText)

        const usagePayload = createDemoUsagePayload({
          priorTokens: priorDemoTokens,
          requestMeter,
        })
        const authoritativeUsage = await persistUsage({
          user: currentUser,
          guestCtx,
          priorTokens: priorDemoTokens,
          requestTokens: usagePayload.requestTokens,
        })

        write({
          type: 'demoUsage',
          demoTokenUsage: authoritativeUsage
            ? { ...usagePayload, sessionTokens: authoritativeUsage.used, budget: authoritativeUsage.budget, remaining: authoritativeUsage.remaining, exceeded: authoritativeUsage.exceeded, source: authoritativeUsage.source }
            : usagePayload,
        })

        write('[DONE]')

        const latencyMs = Math.round(performance.now() - startedAt)
        logAiEvent({
          event: 'demo_chat_request',
          traceId,
          question,
          retrievalMode,
          estimatedTokens: contextUsage.estimatedTokens,
          inputTokens: streamUsage?.prompt_tokens,
          outputTokens: streamUsage?.completion_tokens,
          retrievedChunkIds: chunks.map((chunk) => chunk.id),
          topScore: sources[0]?.score ?? null,
          agentSteps: agent.steps.length,
          latencyMs,
        })
      } catch (error) {
        console.error('[chat]', error)
        write({ type: 'error', message: error.message || 'Chat failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: streamHeaders })
}
