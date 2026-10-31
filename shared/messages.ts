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
  'remote.pairing.failed': { reason: 'invalid' | 'expired' | 'refused' | 'limit' | 'peer-closed' | 'reserved-name' }
  /** A pairing code was asked for while the gateway is off. */
  'remote.gateway.offline': Record<string, never>
  /** Pairing another phone would pass the device limit. */
  'remote.pairing.limit': { max: number }
  /** No paired device has this id (revoked, or never paired). */
  'remote.device.notFound': Record<string, never>
  /** A device name that is empty, longer than `max` or has control characters. */
  'remote.device.invalidName': { max: number }
  /** A device name only the app may speak as ("OXESpace", "System"; `reservedNameIn` in shared/approval-rules.ts). */
  'remote.device.reservedName': Record<string, never>
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
  'remote.device.reservedName',
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
 * C3 in a rejection. Electron passes only an error's text across `invoke`, so a handler that rejects with something
 * the person should read throws `MainMessageError` (`electron/main/ipc/main-message-error.ts`, the one serializer):
 * its text is the English sentence, readable on its own in logs and crash reports, then this fixed marker, then the
 * message as JSON with its parameters redacted and capped. The window reads it back with `messageFromError` (the one
 * reader) and words it with `formatMainMessage`; without the marker it shows its generic text. Malformed input (wrong
 * types, unknown fields) stays a plain `Error`.
 */
export const MAIN_MESSAGE_ERROR_TAG = ' #c3 '

/** Caps on what a rejection's parameters may carry: characters per text value, and values per list. */
export const MAIN_MESSAGE_PARAM_LIMITS = { textLength: 200, listLength: 20 } as const

/**
 * The C3 message a rejection carries, in this process or after crossing IPC; `null` for any other error. The marker
 * is looked for from the end: the message is the tail after the last occurrence that parses as one, so the English
 * sentence, and a parameter inside the JSON, may themselves contain "#c3" or the marker without misleading the read.
 */
export function messageFromError(cause: unknown): MainMessage | null {
  const text = cause instanceof Error ? cause.message
    : typeof cause === 'string' ? cause
      : cause && typeof cause === 'object' && typeof (cause as { message?: unknown }).message === 'string' ? (cause as { message: string }).message : ''
  for (let at = text.lastIndexOf(MAIN_MESSAGE_ERROR_TAG); at >= 0; at = text.lastIndexOf(MAIN_MESSAGE_ERROR_TAG, at - 1)) {
    try {
      const value: unknown = JSON.parse(text.slice(at + MAIN_MESSAGE_ERROR_TAG.length))
      if (isMainMessage(value)) return value
    } catch { /* not this occurrence: an earlier one may be the marker */ }
    if (at === 0) break
  }
  return null
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
