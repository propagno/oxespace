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
  // Main-process sentences the window used to receive ready-made in English (C3 sweep).
  'linear.worktree.exists': { issue: string; path: string }
  'worktree.cleanup.notRemovable': Record<string, never>
  'worktree.cleanup.blocked': { reasons: string[] }
  'worktree.cleanup.needsConfirmation': { reasons: string[] }
  'mcp.signIn.waiting': Record<string, never>
  'mcp.server.quarantined': Record<string, never>
  'mcp.server.untrusted': Record<string, never>
  'github.cli.missing': Record<string, never>
  'git.base.unresolved': { base: string }
  'oxe.status.unreadable': Record<string, never>
  'oxe.dashboard.timeout': Record<string, never>
  'memory.disabled': Record<string, never>
  'memory.unavailable': Record<string, never>
  'memory.runtimeUnavailable': Record<string, never>
  'thread.commands.configure': Record<string, never>
  'thread.commands.busy': Record<string, never>
  'thread.commands.claudeFailed': Record<string, never>
  'thread.commands.codexFailed': Record<string, never>
  'thread.capability.readOnly': Record<string, never>
  'thread.capability.mcpReadOnly': Record<string, never>
  'thread.observe.unsupported': Record<string, never>
  'thread.observe.changed': Record<string, never>
  'thread.queue.deliveryUnconfirmed': Record<string, never>
  'oxequery.edit.readOnly': Record<string, never>
  'oxequery.edit.notTable': Record<string, never>
  'oxequery.edit.noKey': Record<string, never>
  'oxequery.test.connected': Record<string, never>
  'oxequery.startFailed': { reason: string }
  'oxepod.startFailed': { reason: string }
  'oxepost.network.notFound': Record<string, never>
  'oxepost.network.refused': Record<string, never>
  'oxepost.network.reset': Record<string, never>
  'oxepost.network.timedOut': Record<string, never>
  'oxepost.network.lookupFailed': Record<string, never>
  'oxepost.network.hostUnreachable': Record<string, never>
  'oxepost.network.networkUnreachable': Record<string, never>
  'oxepost.send.invalidUrl': Record<string, never>
  'oxepost.send.scheme': Record<string, never>
  'oxepost.send.bodyNotAllowed': { method: string }
  'oxepost.send.bodyTooLarge': Record<string, never>
  'oxepost.send.invalidHeader': { name: string }
  'oxepost.send.timeout': { seconds: number }
  'oxepost.send.tls': { code: string }
  'oxepost.send.failed': Record<string, never>
  'oxepost.send.failedWith': { detail: string }
  /** The person picked a port below 1024 for the remote gateway. */
  'remote.port.privileged': { port: number }
  /** Another program already listens on the gateway's port. */
  'remote.port.inUse': { port: number }
  /** No private network interface (RFC 1918, link-local, ULA) to listen on. */
  'remote.network.noPrivateInterface': Record<string, never>
  /** The gateway's certificate could not be made or read back from secure storage. */
  'remote.certificate.failed': Record<string, never>
  /** A workspace root that is not an absolute path (a relative one would depend on where the app started). */
  'workspace.root.notAbsolute': { path: string }
  /** A workspace root that does not exist. */
  'workspace.root.notFound': { path: string }
  /** A workspace root that is a file, not a folder. */
  'workspace.root.notDirectory': { path: string }
  /** A workspace root the app is not allowed to open or list. */
  'workspace.root.unreadable': { path: string }
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
  'linear.worktree.exists',
  'worktree.cleanup.notRemovable',
  'worktree.cleanup.blocked',
  'worktree.cleanup.needsConfirmation',
  'mcp.signIn.waiting',
  'mcp.server.quarantined',
  'mcp.server.untrusted',
  'github.cli.missing',
  'git.base.unresolved',
  'oxe.status.unreadable',
  'oxe.dashboard.timeout',
  'memory.disabled',
  'memory.unavailable',
  'memory.runtimeUnavailable',
  'thread.commands.configure',
  'thread.commands.busy',
  'thread.commands.claudeFailed',
  'thread.commands.codexFailed',
  'thread.capability.readOnly',
  'thread.capability.mcpReadOnly',
  'thread.observe.unsupported',
  'thread.observe.changed',
  'thread.queue.deliveryUnconfirmed',
  'oxequery.edit.readOnly',
  'oxequery.edit.notTable',
  'oxequery.edit.noKey',
  'oxequery.test.connected',
  'oxequery.startFailed',
  'oxepod.startFailed',
  'oxepost.network.notFound',
  'oxepost.network.refused',
  'oxepost.network.reset',
  'oxepost.network.timedOut',
  'oxepost.network.lookupFailed',
  'oxepost.network.hostUnreachable',
  'oxepost.network.networkUnreachable',
  'oxepost.send.invalidUrl',
  'oxepost.send.scheme',
  'oxepost.send.bodyNotAllowed',
  'oxepost.send.bodyTooLarge',
  'oxepost.send.invalidHeader',
  'oxepost.send.timeout',
  'oxepost.send.tls',
  'oxepost.send.failed',
  'oxepost.send.failedWith',
  'remote.port.privileged',
  'remote.port.inUse',
  'remote.network.noPrivateInterface',
  'remote.certificate.failed',
  'workspace.root.notAbsolute',
  'workspace.root.notFound',
  'workspace.root.notDirectory',
  'workspace.root.unreadable'
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
