/**
 * C3 · Messages from the main process.
 *
 * The main process never returns interface sentences across IPC. It returns a `MessageCode` with its parameters, and the
 * window turns that into words with the `main` catalog (`shared/locales/<language>/main.json`, under `messages.<code>`).
 * The catalog keys belong to the FRONTEND; adding or renaming a code is a contract change.
 *
 * Native dialogs are the one exception: the main process shows them itself, so it translates with `tMain`.
 *
 * S0.1 · Each domain owns its codes in `shared/messages/<domain>.ts`: a new code goes in its domain's file, and this file
 * only changes when a domain is added. Nothing here is renamed: every import of `shared/messages` keeps working.
 */

import { ACTIVITY_MESSAGE_CODES, type ActivityMessageParams } from './messages/activity'
import { AGENTS_MESSAGE_CODES, type AgentsMessageParams } from './messages/agents'
import { APP_MESSAGE_CODES, type AppMessageParams } from './messages/app'
import { APPROVALS_MESSAGE_CODES, type ApprovalsMessageParams } from './messages/approvals'
import { DIAGNOSTICS_MESSAGE_CODES, type DiagnosticsMessageParams } from './messages/diagnostics'
import { GIT_MESSAGE_CODES, type GitMessageParams } from './messages/git'
import { MCP_MESSAGE_CODES, type McpMessageParams } from './messages/mcp'
import { OXEPOD_MESSAGE_CODES, type OxepodMessageParams } from './messages/oxepod'
import { OXEPOST_MESSAGE_CODES, type OxepostMessageParams } from './messages/oxepost'
import { OXEQUERY_MESSAGE_CODES, type OxequeryMessageParams } from './messages/oxequery'
import { REMOTE_MESSAGE_CODES, type RemoteMessageParams } from './messages/remote'
import { THREAD_MESSAGE_CODES, type ThreadMessageParams } from './messages/thread'
import { WORKSPACE_MESSAGE_CODES, type WorkspaceMessageParams } from './messages/workspace'

/** Every code the main process may send, with the parameters each one carries. Add codes; never repurpose one. */
export interface MessageParams extends ActivityMessageParams, AgentsMessageParams, AppMessageParams, ApprovalsMessageParams, DiagnosticsMessageParams, GitMessageParams, McpMessageParams, OxepodMessageParams, OxepostMessageParams, OxequeryMessageParams, RemoteMessageParams, ThreadMessageParams, WorkspaceMessageParams {}

export type MessageCode = keyof MessageParams

export const MESSAGE_CODES = [
  ...ACTIVITY_MESSAGE_CODES,
  ...AGENTS_MESSAGE_CODES,
  ...APP_MESSAGE_CODES,
  ...APPROVALS_MESSAGE_CODES,
  ...DIAGNOSTICS_MESSAGE_CODES,
  ...GIT_MESSAGE_CODES,
  ...MCP_MESSAGE_CODES,
  ...OXEPOD_MESSAGE_CODES,
  ...OXEPOST_MESSAGE_CODES,
  ...OXEQUERY_MESSAGE_CODES,
  ...REMOTE_MESSAGE_CODES,
  ...THREAD_MESSAGE_CODES,
  ...WORKSPACE_MESSAGE_CODES
] as const satisfies readonly MessageCode[]

/** Compile-time check: a code declared in a domain's interface but missing from its list fails here. */
type UnlistedCode = Exclude<MessageCode, (typeof MESSAGE_CODES)[number]>
const everyCodeListed: [UnlistedCode] extends [never] ? true : UnlistedCode = true
void everyCodeListed

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
