export function getAgentTools() {
  return []
}

export async function runToolCall(toolCall) {
  const name = toolCall.function?.name
  throw new Error(`Tool not allowed: ${name}`)
}
