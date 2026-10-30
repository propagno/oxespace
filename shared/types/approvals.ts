/**
 * B10 · Approvals: every request an agent (or the app itself) raises for the person reaches them through the app's own
 * modal, never through a native dialog while an app window exists.
 *
 *   main → window   `approvals.onRequested`  an ApprovalRequest, built entirely by the main process
 *   window → main   `approvals.ack`          the modal is on screen (required for `ackRequired` requests, within APPROVAL_ACK_TIMEOUT_MS)
 *   window → main   `approvals.unavailable`  the modal cannot be shown (chunk failed, did not mount): native fallback for that request only
 *   window → main   `approvals.respond`      exactly one answer per request and generation, validated against its options
 *   main → window   `approvals.onResolved`   answered, expired as denied, cancelled, or answered in the native fallback
 *
 * The native dialog is a fallback only: when no app window exists, when the window reports `unavailable` for a request,
 * or when an `ackRequired` request is not acknowledged in time. Everything the person reads is a C3 MainMessage except
 * `agentText`, which is the requester's text verbatim, bounded and always shown as untrusted.
 *
 * These channels are never MCP tools (`approvals.admin` is a forbidden capability in shared/mcp-coverage.ts).
 */
import type { MainMessage } from '../messages'

export const APPROVAL_SCHEMA_VERSION = 1

/** Which subsystem raised the request. */
export const APPROVAL_KINDS = ['action', 'mcp-confirm', 'oxequery', 'preview-automation', 'crash'] as const
export type ApprovalKind = typeof APPROVAL_KINDS[number]

/** Computed by the main process from the existing classifiers (shared/approval-rules.ts); never taken from a requester. */
export const APPROVAL_RISKS = ['low', 'medium', 'high', 'critical'] as const
export type ApprovalRisk = typeof APPROVAL_RISKS[number]

export const APPROVAL_INTENTS = ['deny', 'allow', 'allow-session'] as const
export type ApprovalIntent = typeof APPROVAL_INTENTS[number]

/** A request nobody answers is denied after this long (same lifetime as the broker's grants). */
export const APPROVAL_TIMEOUT_MS = 5 * 60_000
/** An `ackRequired` request the window has not acknowledged by then goes to the native dialog. */
export const APPROVAL_ACK_TIMEOUT_MS = 3_000
/** The most of the requester's text a request carries; longer text is cut and flagged, and then only deny is offered. */
export const APPROVAL_AGENT_TEXT_MAX = 100_000
/** Pending requests kept at once; a request past this is denied without being shown. */
export const APPROVAL_QUEUE_MAX = 50
/** Decisions `approvals.history()` keeps for this app session, newest first. */
export const APPROVAL_HISTORY_MAX = 200
/** Agent notifications (`oxespace_workspace_change notify`) allowed per execution per minute. */
export const NOTIFY_PER_MINUTE = 6

/**
 * Who asks. Assigned by the main process from the authenticated execution and its owner, never from a label, a pane
 * name or a title the agent chose. `label` is the app's own name for it, e.g. "Claude · pane 2".
 */
export interface ApprovalRequester {
  kind: 'agent' | 'mcp-server' | 'app'
  /** `pane:<id>` or `thread:<id>` for an agent, the server id for an MCP server, `oxespace` for the app. */
  id: string
  label: MainMessage
}

export interface ApprovalEnvironment {
  kind: 'local' | 'dev' | 'prod'
  /** The connection's name, as the person saved it. */
  name: string
  production: boolean
}

/** The requester's text exactly as it would run or be sent. Shown verbatim in a labelled, monospace, scrollable block. */
export interface ApprovalAgentText {
  text: string
  untrusted: true
  /** Length of the whole text before the cut. */
  length: number
  /** True when `text` was cut at APPROVAL_AGENT_TEXT_MAX: the request then offers deny options only. */
  truncated: boolean
}

export interface ApprovalOption {
  id: string
  label: MainMessage
  intent: ApprovalIntent
}

export interface ApprovalRequest {
  schemaVersion: typeof APPROVAL_SCHEMA_VERSION
  id: string
  /** Raised when main re-issues the same request (after a native fallback, a restart of its source); an answer for another generation is refused. */
  generation: number
  kind: ApprovalKind
  requester: ApprovalRequester
  risk: ApprovalRisk
  environment?: ApprovalEnvironment
  title: MainMessage
  summary: MainMessage
  /** What it applies to, from the app's own records: a repository path, a connection, a page URL. Never agent-chosen text. */
  target?: string
  /** The app's own warnings. Never mixed with `agentText`. */
  appNotes: MainMessage[]
  agentText: ApprovalAgentText
  options: ApprovalOption[]
  /** Always a deny option. */
  defaultOptionId: string
  /** The window must call `approvals.ack` within APPROVAL_ACK_TIMEOUT_MS, or the request goes native. */
  ackRequired: boolean
  createdAt: number
  expiresAt: number
}

export interface ApprovalAnswerInput { id: string; generation: number }
export interface ApprovalRespondInput extends ApprovalAnswerInput { optionId: string }

/** Why a window → main call was refused; each is also a C3 code (`approvals.refused.<reason>`). */
export const APPROVAL_REFUSALS = ['notPending', 'staleGeneration', 'alreadyAnswered', 'unknownOption', 'alreadyReported'] as const
export type ApprovalRefusal = typeof APPROVAL_REFUSALS[number]

export type ApprovalCallResult =
  | { ok: true; id: string }
  | { ok: false; refusal: ApprovalRefusal; message: MainMessage }

export type ApprovalResolvedBy = 'user' | 'native' | 'timeout' | 'cancelled'

export interface ApprovalResolved {
  id: string
  generation: number
  outcome: ApprovalIntent
  optionId?: string
  by: ApprovalResolvedBy
}

/** A decision kept for this session; the requester's text is not kept, only its hash. */
export interface ApprovalHistoryEntry {
  id: string
  kind: ApprovalKind
  requester: ApprovalRequester
  risk: ApprovalRisk
  title: MainMessage
  summary: MainMessage
  outcome: ApprovalIntent
  by: ApprovalResolvedBy
  textSha256: string
  createdAt: number
  resolvedAt: number
}

export interface ApprovalsApi {
  /** The pending queue, oldest first. */
  list(): Promise<ApprovalRequest[]>
  respond(input: ApprovalRespondInput): Promise<ApprovalCallResult>
  ack(input: ApprovalAnswerInput): Promise<ApprovalCallResult>
  /** The modal cannot show this request: neither an approval nor a denial. Main asks natively, once. */
  unavailable(input: ApprovalAnswerInput): Promise<ApprovalCallResult>
  history(): Promise<ApprovalHistoryEntry[]>
  onRequested(listener: (request: ApprovalRequest) => void): () => void
  onResolved(listener: (resolved: ApprovalResolved) => void): () => void
}
