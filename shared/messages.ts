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
  /** Diagnostics journal (B8.3): one kind of incident. */
  'incident.window.crashed': Record<string, never>
  'incident.window.rendererGone': Record<string, never>
  'incident.ipc.handlerFailed': Record<string, never>
  'incident.agent.startFailed': Record<string, never>
  'incident.mcp.quarantined': Record<string, never>
  'incident.database.busy': Record<string, never>
  'incident.oxequery.timeout': Record<string, never>
  'incident.updater.failed': Record<string, never>
  'incident.interaction.overBudget': Record<string, never>
  'incident.app.journalReset': Record<string, never>
  /** What each file of the diagnostics bundle holds (B8.3 preview). */
  'bundle.file.snapshot': Record<string, never>
  'bundle.file.incidents': Record<string, never>
  'bundle.file.logTail': Record<string, never>
  'bundle.file.runtime': Record<string, never>
  'bundle.file.versions': Record<string, never>
  'bundle.file.configuration': Record<string, never>
  /** The person picked a port below 1024 for the remote gateway. */
  'remote.port.privileged': { port: number }
  /** Another program already listens on the gateway's port. */
  'remote.port.inUse': { port: number }
  /** No private network interface (RFC 1918, link-local, ULA) to listen on. */
  'remote.network.noPrivateInterface': Record<string, never>
  /** The gateway's certificate could not be made or read back from secure storage. */
  'remote.certificate.failed': Record<string, never>
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
  'app.connectivity.offline',
  'incident.window.crashed',
  'incident.window.rendererGone',
  'incident.ipc.handlerFailed',
  'incident.agent.startFailed',
  'incident.mcp.quarantined',
  'incident.database.busy',
  'incident.oxequery.timeout',
  'incident.updater.failed',
  'incident.interaction.overBudget',
  'incident.app.journalReset',
  'bundle.file.snapshot',
  'bundle.file.incidents',
  'bundle.file.logTail',
  'bundle.file.runtime',
  'bundle.file.versions',
  'bundle.file.configuration',
  'remote.port.privileged',
  'remote.port.inUse',
  'remote.network.noPrivateInterface',
  'remote.certificate.failed'
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
