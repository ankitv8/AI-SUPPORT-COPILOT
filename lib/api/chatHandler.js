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
import { isDemoEnabled } from '../../platform/demo/index.js'
import { retrieveDemoChunks, validateDemoDocuments } from '../demo/demoRetrieval.js'
import { attachDemoTokenUsage, createDemoUsagePayload } from '../demo/tokenBudget.js'
import { getAgentTools, runToolCall } from '../../platform/tools.js'
import { logAiEvent, measure } from '../core/telemetry.js'
import { requireAuthenticatedUser } from '../core/auth.js'
import { getOwnedDocumentIds } from '../core/documents.js'
import {
  addUserTokenUsage,
  getUserTokenUsage,
  tryAcquireUserUsageLock,
} from '../core/userUsageStore.js'

function sseLine(payload) {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
}

function jsonResponse(body, init = {}) {
  return Response.json(body, init)
}

async function persistUsage({ user, requestTokens }) {
  return addUserTokenUsage(user.id, requestTokens)
}

async function getChatUsage(user) {
  return getUserTokenUsage(user.id)
}

function createBudgetLimitResponse({ usage, traceId, question }) {
  if (!usage.exceeded) return null

  const agent = createAgentRun({ question, traceId })
  return jsonResponse({
    answer: 'Token usage limit reached for this account.',
    sources: [],
    demoTokenLimit: true,
    demoTokenUsage: {
      requestTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      sessionTokens: usage.used,
      budget: usage.budget,
      remaining: 0,
      exceeded: true,
      source: usage.source,
    },
    traceId,
    agent: agent.toJSON(),
  })
}

async function retrieveChatContext({
  documents,
  question,
  retrievalQuery,
  retrievalMode,
  requestMeter,
  user,
  ownedSourceIds,
  traceId,
  agent,
}) {
  const retrieval = await measure('retrieval', () =>
    retrieveDemoChunks({
      documents,
      question: retrievalQuery,
      k: 5,
      mode: retrievalMode,
      tokenMeter: requestMeter,
      userId: user?.id,
      ownedSourceIds,
    }),
  )

  if (!retrieval.ok) {
    console.error('[chat] retrieval failed', retrieval.error)
    return {
      response: jsonResponse({ error: 'Could not search your file. Please try again.' }, { status: 500 }),
    }
  }

  const retrievedChunks = retrieval.result
  const documentById = new Map(documents.map((document) => [document.id, document]))
  logAiEvent({
    event: 'chat_retrieval_results',
    traceId,
    retrievalMode,
    chunks: retrievedChunks.map((chunk, index) => {
      const source = documentById.get(chunk.sourceId)
      return {
        rank: index + 1,
        fileName: source?.filename || source?.title || chunk.title || 'Unknown source',
        sourceId: chunk.sourceId || null,
        chunkId: chunk.id,
        score: Number.isFinite(chunk.score) ? Number(chunk.score.toFixed(3)) : null,
      }
    }),
  })
  agent.record(AGENT_STEPS.RETRIEVE, {
    mode: retrievalMode,
    chunkIds: retrievedChunks.map((chunk) => chunk.id),
    topScore: retrievedChunks[0]?.score,
  })

  const contextChecks = await Promise.all(
    retrievedChunks.map((chunk) =>
      evaluateManagedGuardrail({
        type: 'context',
        text: question,
        context: chunk.text,
      }),
    ),
  )
  const chunks = retrievedChunks.filter((_, index) => contextChecks[index].allowed)
  const sources = publicSources(chunks)
  agent.record(AGENT_STEPS.GUARDRAIL, {
    managed: true,
    scope: 'retrieved_context',
    allowed: chunks.length > 0 || retrievedChunks.length === 0,
    blockedChunkIds: retrievedChunks
      .filter((_, index) => !contextChecks[index].allowed)
      .map((chunk) => chunk.id),
    skipped: contextChecks.every((check) => check.skipped),
  })
  const guardrailPass = shouldAnswerFromRetrieval(chunks, 0.12)
  agent.record(AGENT_STEPS.GUARDRAIL, { pass: guardrailPass })

  return { chunks, sources, guardrailPass }
}

async function planWithTools({ model, messages, requestMeter, agent }) {
  const tools = getAgentTools()
  if (!tools.length) {
    agent.record(AGENT_STEPS.PLAN, { toolCalls: [] })
    return null
  }

  let planning
  try {
    planning = await createGroqChatCompletion({ model, messages, tools })
  } catch (error) {
    console.error('[chat] planning request failed', error)
    return jsonResponse({ error: 'Chat is temporarily unavailable. Please try again.' }, { status: 503 })
  }

  requestMeter.inputTokens +=
    planning.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages))
  requestMeter.outputTokens += planning.usage?.completion_tokens ?? 0

  const assistantMessage = planning.choices[0]?.message
  agent.record(AGENT_STEPS.PLAN, {
    toolCalls: assistantMessage?.tool_calls?.map((tool) => tool.function?.name) ?? [],
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

  return null
}

function createChatStreamResponse({
  traceId,
  retrievalMode,
  contextUsage,
  agent,
  chatModel,
  sources,
  messages,
  chunks,
  requestMeter,
  priorDemoTokens,
  currentUser,
  budget,
  releaseUsageLock,
  startedAt,
  question,
}) {
  const streamHeaders = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  })
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

        const response = streamGroqChatCompletion({ model: chatModel, messages })
        for await (const part of response) {
          const token = part.choices[0]?.delta?.content
          if (token) {
            replyText += token
            write({ type: 'token', token })
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

        if (!managedOutputGuardrail.allowed) {
          const safeReply = managedOutputGuardrail.reason || 'I cannot provide that response.'
          write({ type: 'blocked', reason: safeReply })
          write({ type: 'replace', text: safeReply })
        }

        requestMeter.inputTokens +=
          streamUsage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages))
        requestMeter.outputTokens += streamUsage?.completion_tokens ?? estimateTokens(replyText)

        const usagePayload = createDemoUsagePayload({
          priorTokens: priorDemoTokens,
          requestMeter,
          budget,
        })
        const authoritativeUsage = await persistUsage({
          user: currentUser,
          requestTokens: usagePayload.requestTokens,
        })

        write({
          type: 'demoUsage',
          demoTokenUsage: authoritativeUsage
            ? {
                ...usagePayload,
                sessionTokens: authoritativeUsage.used,
                budget: authoritativeUsage.budget,
                remaining: authoritativeUsage.remaining,
                exceeded: authoritativeUsage.exceeded,
                source: authoritativeUsage.source,
              }
            : usagePayload,
        })

        write('[DONE]')

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
          latencyMs: Math.round(performance.now() - startedAt),
        })
      } catch (error) {
        console.error('[chat]', error)
        write({ type: 'error', message: 'Chat is temporarily unavailable. Please try again.' })
      } finally {
        try {
          await releaseUsageLock()
        } catch (error) {
          console.error('[chat] failed to release account usage lock', error)
        }
        controller.close()
      }
    },
  })

  return new Response(stream, { headers: streamHeaders })
}

export async function handleChatRequest(request) {
  const { user: currentUser, response: authResponse } = await requireAuthenticatedUser(request)
  if (authResponse) return authResponse

  const releaseUsageLock = await tryAcquireUserUsageLock(currentUser.id)
  if (!releaseUsageLock) {
    return Response.json(
      { error: 'A chat request is already running for this account. Please wait and try again.' },
      { status: 429, headers: { 'Retry-After': '5' } },
    )
  }

  let streamOwnsUsageLock = false
  try {
    try {
      assertProviderKeys()
    } catch (error) {
      console.error('[chat] configuration error', error)
      return Response.json({ error: 'Chat is temporarily unavailable. Please try again later.' }, { status: 503 })
    }
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

    const usage = await getChatUsage(currentUser)
    const priorDemoTokens = usage.used
    const budgetResponse = createBudgetLimitResponse({ usage, traceId, question })
    if (budgetResponse) return budgetResponse

    const demoCheck = validateDemoDocuments(demoDocuments)
    if (!demoCheck.ok) {
      return jsonResponse({
        answer: `${demoCheck.error} Upload a PDF, text, or JSON in the sidebar first.`,
        sources: [],
        traceId,
        agent: createAgentRun({ question, traceId }).toJSON(),
      })
    }

    const ownedSourceIds = await getOwnedDocumentIds({
      ids: demoCheck.documents.map((document) => document.id),
      userId: currentUser.id,
    })
    if (ownedSourceIds.length !== demoCheck.documents.length) {
      return jsonResponse({ error: 'One or more documents are not owned by this account.' }, { status: 403 })
    }

    const chatHistory = normalizeChatHistory(history)
    const retrievalQuery = buildRetrievalQuery(question, chatHistory)
    const agent = createAgentRun({ question, traceId })

    const injection = detectPromptInjection(question)
    agent.record(AGENT_STEPS.SECURITY, injection)

    if (injection.blocked) {
      return jsonResponse({
        answer: injection.reason,
        sources: [],
        blocked: true,
        traceId,
      })
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
      return jsonResponse({
        answer: managedInputGuardrail.reason,
        sources: [],
        blocked: true,
        traceId,
        agent: agent.toJSON(),
      })
    }

    const retrievedContext = await retrieveChatContext({
      documents: demoCheck.documents,
      question,
      retrievalQuery,
      retrievalMode,
      requestMeter,
      user: currentUser,
      ownedSourceIds,
      traceId,
      agent,
    })
    if (retrievedContext.response) return retrievedContext.response
    const { chunks, sources, guardrailPass } = retrievedContext

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
        { priorTokens: priorDemoTokens, requestMeter, budget: usage.budget },
      )
      await persistUsage({ user: currentUser, requestTokens: payload.demoTokenUsage.requestTokens })
      return jsonResponse(payload)
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

    const planningResponse = await planWithTools({
      model: chatModel,
      messages,
      requestMeter,
      agent,
    })
    if (planningResponse) return planningResponse

    if (priorDemoTokens + requestMeter.inputTokens + requestMeter.outputTokens >= usage.budget) {
      const payload = attachDemoTokenUsage(
        {
          answer: 'Account token usage limit reached during this request.',
          sources,
          traceId,
          agent: agent.toJSON(),
          demoTokenLimit: true,
        },
        { priorTokens: priorDemoTokens, requestMeter, budget: usage.budget },
      )
      await persistUsage({ user: currentUser, requestTokens: payload.demoTokenUsage.requestTokens })
      return jsonResponse(payload)
    }

    const response = createChatStreamResponse({
      traceId,
      retrievalMode,
      contextUsage,
      agent,
      chatModel,
      sources,
      messages,
      chunks,
      requestMeter,
      priorDemoTokens,
      currentUser,
      budget: usage.budget,
      releaseUsageLock,
      startedAt,
      question,
    })
    streamOwnsUsageLock = true
    return response
  } finally {
    if (!streamOwnsUsageLock) {
      try {
        await releaseUsageLock()
      } catch (error) {
        console.error('[chat] failed to release account usage lock', error)
      }
    }
  }
}
