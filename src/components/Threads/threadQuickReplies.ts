export interface ThreadQuickReply { label: string; value: string }

/** A verb that asks the person to answer with something specific. */
const REPLY_VERB = /\b(?:responda|responder|responde|digite|reply|respond|answer|type)\b/gi
/** Double or curly quotes; single quotes only around a whole phrase, so an apostrophe never opens one. */
const QUOTED = /["“]([^"“”\n]{1,60})["”]|(?<=^|[\s(:])'([^'\n]{1,60})'(?=[\s,.;:!?)]|$)/g
/** At most this much text, besides other quoted answers, between the verb and the answer ("responda com", "por exemplo"). */
const MAX_GAP = 40

/** Only literal options supplied by the agent become shortcuts; no inferred answer is sent. */
export function threadQuickReplies(message: string): ThreadQuickReply[] {
  const lines = message.split('\n')
  const heading = lines.findIndex(line => /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:as opções|opções|options|escolha uma opção)(?:\*\*)?\s*:/i.test(line))
  const options: ThreadQuickReply[] = []
  if (heading >= 0) for (const line of lines.slice(heading + 1, heading + 30)) {
    const match = line.match(/^\s*(?:[-*•]\s*)?(?:\*\*)?([A-E])(?:\s*\(([^)\n]{1,48})\))?\s*[:.)](?:\*\*)?(?:\s|$)/i)
    if (!match) continue
    const value = match[1].toUpperCase()
    if (!options.some(option => option.value === value)) options.push({ label: match[2] ? `${value} (${match[2]})` : value, value })
  }
  if (options.length >= 2) return options.slice(0, 5)

  // A quoted text is an answer only when a reply verb asks for it in the same sentence, right before it:
  // 'Responda "sim" ou "não"' offers two; 'it switches to "Indexing…"' offers none.
  const answers: string[] = []
  for (const line of lines) {
    const verbs = [...line.matchAll(REPLY_VERB)].map(match => (match.index ?? 0) + match[0].length)
    if (!verbs.length) continue
    for (const quote of line.matchAll(QUOTED)) {
      const start = quote.index ?? 0
      const verb = verbs.filter(end => end <= start).at(-1)
      if (verb === undefined) continue
      const gap = line.slice(verb, start).replace(QUOTED, '')
      if (gap.length > MAX_GAP || /[.!?](?:\s|$)/.test(gap)) continue
      const value = (quote[1] ?? quote[2]).trim()
      if (value && !answers.includes(value)) answers.push(value)
    }
  }
  return answers.slice(0, 5).map(value => ({ label: value, value }))
}
