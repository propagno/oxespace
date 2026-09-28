export interface ThreadQuickReply { label: string; value: string }

/** Only literal options supplied by the agent become shortcuts; no inferred answer is sent. */
export function threadQuickReplies(message: string): ThreadQuickReply[] {
  const lines = message.split('\n')
  const heading = lines.findIndex(line => /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:as opções|opções|options|escolha uma opção)(?:\*\*)?\s*:/i.test(line))
  const options: ThreadQuickReply[] = []
  if (heading >= 0) for (const line of lines.slice(heading + 1, heading + 30)) {
    const match = line.match(/^\s*(?:[-*•]\s*)?(?:\*\*)?([A-E])(?:\s*\(([^)\n]{1,48})\))?\s*[:.)](?:\*\*)?(?:\s|$)/i)
    if (!match) continue
    const value = match[1].toUpperCase()
    if (!options.some(option => option.value === value)) options.push({ label: `${value}${match[2] ? ` (${match[2]})` : ''}`, value })
  }
  if (options.length >= 2) return options.slice(0, 5)

  const instruction = lines.find(line => /\b(?:responda|reply|respond)\b/i.test(line) && /["'“”]/.test(line))
  if (!instruction) return []
  const quoted = [...instruction.matchAll(/["“']([^"”'\n]{1,60})["”']/g)].map(match => match[1].trim())
  return [...new Set(quoted)].filter(value => value.length > 0).slice(0, 5).map(value => ({ label: value, value }))
}
