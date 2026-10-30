import type { MainMessage } from '../../../shared/messages'

/**
 * F18 · In-app approvals: what the window assumes about the main process's `approvals.*` channel.
 *
 * TODO(CCR B10): every type here is the renderer's reading of contract B10, which BACKEND is still drafting. When B10
 * lands they move to shared/types (and the codes below to shared/messages.ts with their `main` catalog entries), and
 * this file re-exports them.
 */

export type ApprovalKind = 'action' | 'mcp-confirm' | 'oxequery' | 'preview-automation' | 'crash'
export const APPROVAL_KINDS: readonly ApprovalKind[] = ['action', 'mcp-confirm', 'oxequery', 'preview-automation', 'crash']

export type ApprovalRisk = 'low' | 'medium' | 'high' | 'critical'
export type ApprovalIntent = 'deny' | 'allow' | 'allow-session'

/** Who asked, as the app identified it. The agent never names itself here. */
export interface ApprovalRequester {
  kind: 'agent' | 'mcp-server' | 'app'
  id: string
  label: string
}

/**
 * Codes the approvals channel sends that shared/messages.ts does not have yet. Worded by the `common` catalog under
 * `approvals.codes.<code>` until they join the `main` catalog. TODO(CCR B10)
 */
export interface ApprovalCodeParams {
  'approvals.option.deny': Record<string, never>
  'approvals.option.allowOnce': Record<string, never>
  'approvals.option.allowSession': Record<string, never>
  'approvals.option.restart': Record<string, never>
  'approvals.option.closeTab': Record<string, never>
  'approvals.note.production': { name: string }
  'approvals.note.destructive': Record<string, never>
  'approvals.note.outsideWorkspace': { path: string }
  'approvals.note.crashed': { times: number }
  'approvals.notFound': Record<string, never>
  'approvals.stale': Record<string, never>
  'approvals.invalidOption': Record<string, never>
  'approvals.unavailable': Record<string, never>
}
export type ApprovalCode = keyof ApprovalCodeParams
export type ApprovalLocalMessage = { [Code in ApprovalCode]: { code: Code; params: ApprovalCodeParams[Code] } }[ApprovalCode]
/** A message from the main process: one of the shared C3 codes, or an approvals code still local to the window. */
export type ApprovalMessage = MainMessage | ApprovalLocalMessage

export interface ApprovalOption {
  id: string
  label: ApprovalMessage
  intent: ApprovalIntent
}

export interface ApprovalRequest {
  id: string
  /** Bumps whenever main re-issues the request; an answer must echo it, and a stale one is refused. */
  generation: number
  kind: ApprovalKind
  requester: ApprovalRequester
  risk: ApprovalRisk
  environment?: { name: string; production: boolean }
  /** The app's own warnings about this request. */
  appNotes: ApprovalMessage[]
  /** Text written by the agent, verbatim and untrusted. Shown as plain text only. */
  agentText: string
  /** Main cut `agentText` at `agentTextLimit` characters. */
  truncated: boolean
  /** The cap main applies to `agentText`, in characters. */
  agentTextLimit: number
  options: ApprovalOption[]
  /** Always a deny option. */
  defaultOptionId: string
  createdAt: number
  expiresAt?: number
}

export type ApprovalResolvedBy = 'user' | 'timeout' | 'cancelled'

/** Pushed by main on `approvals:resolved` once a request is no longer pending, whoever settled it. */
export interface ApprovalResolution {
  id: string
  /** The intent of the option that settled it; a timeout settles with the default (deny). */
  outcome: ApprovalIntent
  by: ApprovalResolvedBy
  at?: number
}

/** One line of the session's decisions, from `approvals.history()`. */
export interface ApprovalHistoryEntry {
  id: string
  kind: ApprovalKind
  requester: ApprovalRequester
  risk: ApprovalRisk
  environment?: { name: string; production: boolean }
  outcome: ApprovalIntent
  by: ApprovalResolvedBy
  at: number
}

export interface ApprovalRespondInput { id: string; optionId: string; generation: number }
/** The window cannot show this request (its code failed to load or never mounted); main falls back to its own dialog. */
export interface ApprovalUnavailableInput { id: string; generation: number }

/** Codes `respond` rejects with (C3). */
export const APPROVAL_REFUSALS = ['approvals.notFound', 'approvals.stale', 'approvals.invalidOption'] as const
export type ApprovalRefusal = typeof APPROVAL_REFUSALS[number]

/** The surface `window.oxe.approvals` is expected to expose. TODO(CCR B10) */
export interface ApprovalsApi {
  list(): Promise<ApprovalRequest[]>
  respond(input: ApprovalRespondInput): Promise<void>
  history(): Promise<ApprovalHistoryEntry[]>
  /** TODO(CCR B10): the coordinator's fail-safe; the exact name may change. */
  unavailable(input: ApprovalUnavailableInput): Promise<void>
  /** `approvals:requested` */
  onRequested(listener: (request: ApprovalRequest) => void): () => void
  /** `approvals:resolved` */
  onResolved(listener: (resolution: ApprovalResolution) => void): () => void
}

/** A refusal from `respond`, carrying its C3 code. */
export class ApprovalError extends Error {
  constructor(readonly code: ApprovalRefusal | 'approvals.failed', message = code) { super(message); this.name = 'ApprovalError' }
}

/** Requests in the order they are answered: oldest first, ties by id so the order never shuffles. */
export function byCreatedAt(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
