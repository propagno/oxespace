/**
 * C3 · Messages from the main process.
 *
 * The main process never returns interface sentences across IPC. It returns a `MessageCode` with its parameters, and the
 * window turns that into words with the `main` catalog (`shared/locales/<language>/main.json`, under `messages.<code>`).
 * The catalog keys belong to the FRONTEND; adding or renaming a code is a contract change.
 *
 * Native dialogs are the one exception: the main process shows them itself, so it translates with `tMain`.
 */

/** Every code the main process may send, with the parameters each one carries. Add codes; never repurpose one. */
export interface MessageParams {
  /** MCP quarantine: tools whose description or inputs changed after the person trusted the server. */
  'mcp.quarantine.changed': { tools: string[] }
  /** MCP quarantine: tools the server added after it was trusted. */
  'mcp.quarantine.added': { tools: string[] }
  /** MCP quarantine: tools the server removed after it was trusted. */
  'mcp.quarantine.removed': { tools: string[] }
  /** MCP quarantine: the server's command, arguments, environment or URL no longer match what was trusted. */
  'mcp.quarantine.configChanged': Record<string, never>
  /** A pending request was answered, cancelled or expired before this answer arrived. */
  'thread.request.notPending': Record<string, never>
  /** The conversation restarted since the request was listed; the answer belongs to an older generation. */
  'thread.request.staleGeneration': Record<string, never>
  /** Another answer to the same request is being delivered (a second window or device). */
  'thread.request.alreadyResponding': Record<string, never>
  /** A question was answered without an answer for every required question. */
  'thread.request.unanswered': Record<string, never>
  /** The system reports no network interface with a route. */
  'app.connectivity.offline': Record<string, never>
}

export type MessageCode = keyof MessageParams

export const MESSAGE_CODES = [
  'mcp.quarantine.changed',
  'mcp.quarantine.added',
  'mcp.quarantine.removed',
  'mcp.quarantine.configChanged',
  'thread.request.notPending',
  'thread.request.staleGeneration',
  'thread.request.alreadyResponding',
  'thread.request.unanswered',
  'app.connectivity.offline'
] as const satisfies readonly MessageCode[]

/** A code and its parameters, as one value: what crosses IPC instead of a sentence. */
export type MainMessage = { [Code in MessageCode]: { code: Code; params: MessageParams[Code] } }[MessageCode]

const known = new Set<string>(MESSAGE_CODES)

export function isMessageCode(value: unknown): value is MessageCode {
  return typeof value === 'string' && known.has(value)
}

/** Shape check for a message read back from storage or another process; parameters are checked by the catalog. */
export function isMainMessage(value: unknown): value is MainMessage {
  if (!value || typeof value !== 'object') return false
  const { code, params } = value as { code?: unknown; params?: unknown }
  return isMessageCode(code) && !!params && typeof params === 'object' && !Array.isArray(params)
}

export function mainMessage<Code extends MessageCode>(code: Code, params: MessageParams[Code]): { code: Code; params: MessageParams[Code] } {
  return { code, params }
}

/** The catalog key of a code in the `main` namespace. */
export function messageKey(code: MessageCode): `messages.${MessageCode}` {
  return `messages.${code}`
}

/** Interpolation values for the catalog: lists are joined the way the language writes them. */
export function messageValues(message: MainMessage, language: string): Record<string, string> {
  const list = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' })
  return Object.fromEntries(Object.entries(message.params as Record<string, unknown>)
    .map(([name, value]) => [name, Array.isArray(value) ? list.format(value.map(String)) : String(value)]))
}
