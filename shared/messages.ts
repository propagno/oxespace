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
  /** The person picked a port below 1024 for the remote gateway. */
  'remote.port.privileged': { port: number }
  /** Another program already listens on the gateway's port. */
  'remote.port.inUse': { port: number }
  /** No private network interface (RFC 1918, link-local, ULA) to listen on. */
  'remote.network.noPrivateInterface': Record<string, never>
  /** The gateway's certificate could not be made or read back from secure storage. */
  'remote.certificate.failed': Record<string, never>
  /** A phone's pairing attempt failed. Never carries the phone's key, address, name or any identifier. */
  'remote.pairing.failed': { reason: 'invalid' | 'expired' | 'refused' | 'limit' }
  /** A pairing code was asked for while the gateway is off. */
  'remote.gateway.offline': Record<string, never>
  /** Pairing another phone would pass the device limit. */
  'remote.pairing.limit': { max: number }
  /** No paired device has this id (revoked, or never paired). */
  'remote.device.notFound': Record<string, never>
  /** A device name that is empty, longer than `max` or has control characters. */
  'remote.device.invalidName': { max: number }
  /** A desktop name that is empty, longer than `max` or has control characters. */
  'remote.desktop.invalidName': { max: number }
  /** A pane id that cannot be a pane. */
  'remote.pane.invalid': Record<string, never>
}

export type MessageCode = keyof MessageParams

export const MESSAGE_CODES = [
  'mcp.quarantine.changed',
  'mcp.quarantine.added',
  'mcp.quarantine.removed',
  'thread.request.notPending',
  'thread.request.staleGeneration',
  'thread.request.alreadyResponding',
  'thread.request.unanswered',
  'app.connectivity.offline',
  'remote.port.privileged',
  'remote.port.inUse',
  'remote.network.noPrivateInterface',
  'remote.certificate.failed',
  'remote.pairing.failed',
  'remote.gateway.offline',
  'remote.pairing.limit',
  'remote.device.notFound',
  'remote.device.invalidName',
  'remote.desktop.invalidName',
  'remote.pane.invalid'
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

/**
 * Marks a C3 message inside a rejection. Electron passes only an error's text across `invoke`, so a handler that
 * rejects with something the person should read throws `MainMessageError`: its text is the English sentence (for logs)
 * followed by this tag and the message as JSON. The window reads it back with `messageFromError`. Malformed input
 * (wrong types, unknown fields) stays a plain `Error`.
 */
export const MAIN_MESSAGE_ERROR_TAG = ' #c3 '

export class MainMessageError extends Error {
  constructor(readonly mainMessage: MainMessage, text: string) {
    super(`${text}${MAIN_MESSAGE_ERROR_TAG}${JSON.stringify(mainMessage)}`)
    this.name = 'MainMessageError'
  }
}

/** The C3 message a rejection carries, in this process or after crossing IPC; `null` for any other error. */
export function messageFromError(cause: unknown): MainMessage | null {
  if (cause instanceof MainMessageError) return cause.mainMessage
  const text = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  const at = text.lastIndexOf(MAIN_MESSAGE_ERROR_TAG)
  if (at < 0) return null
  try {
    const value: unknown = JSON.parse(text.slice(at + MAIN_MESSAGE_ERROR_TAG.length))
    return isMainMessage(value) ? value : null
  } catch {
    return null
  }
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
