const LIMIT = 65536

/**
 * The text of a Claude `tool_result` block. `content` is a string for simple tools and an
 * array of typed blocks for tools that return several parts (file reads with images, MCP
 * results); reading only the string form left those results empty in the timeline.
 */
export function toolResultText(content: unknown, limit = LIMIT): string {
  if (typeof content === 'string') return content.slice(0, limit)
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const value = block as { type?: unknown; text?: unknown }
    if (value.type === 'text' && typeof value.text === 'string') parts.push(value.text)
    else if (value.type === 'image') parts.push('[image]')
  }
  return parts.join('\n').slice(0, limit)
}
