const LIMIT = 65536

/**
 * The text of a Claude `tool_result` block, with a flag when `limit` cut it (F6 A20).
 */
export function toolResultOutput(content: unknown, limit = LIMIT): { text: string; truncated: boolean } {
  if (typeof content === 'string') {
    return content.length > limit ? { text: content.slice(0, limit), truncated: true } : { text: content, truncated: false }
  }
  if (!Array.isArray(content)) return { text: '', truncated: false }
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const value = block as { type?: unknown; text?: unknown }
    if (value.type === 'text' && typeof value.text === 'string') parts.push(value.text)
    else if (value.type === 'image') parts.push('[image]')
  }
  const joined = parts.join('\n')
  return joined.length > limit ? { text: joined.slice(0, limit), truncated: true } : { text: joined, truncated: false }
}

/**
 * The text of a Claude `tool_result` block. `content` is a string for simple tools and an
 * array of typed blocks for tools that return several parts (file reads with images, MCP
 * results); reading only the string form left those results empty in the timeline.
 */
export function toolResultText(content: unknown, limit = LIMIT): string {
  return toolResultOutput(content, limit).text
}
