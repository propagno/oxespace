import {
  REMOTE_QUEUE_PREVIEW, REMOTE_TEXT_LIMITS,
  type RemoteAgentRow, type RemoteDelegation, type RemoteJob, type RemotePane, type RemotePendingRequest, type RemoteThreadHeader, type RemoteThreadItem, type RemoteThreadSummary, type RemoteWorkspace
} from '../../../../shared/remote/protocol'
import type { ConversationThread, ThreadEvent, ThreadRequest, ThreadTurn } from '../../../../shared/types/thread'
import type { RemoteDelegationRow, RemoteJobRow, RemotePendingRow, RemoteWorkspaceRow } from './desktop'
import { clean, relativeTo } from './text'
import { riskFromShell } from '../../../../shared/approval-rules'
import type { AgentRow } from '../../../../shared/types/agents'
import type { MainMessage } from '../../../../shared/messages'
import { toToolDiff } from './tool-diff'
import { workspaceColorIndex } from '../../../../shared/workspace-color'

/**
 * Desktop data to C5 payloads. Each mapper names what it keeps; anything not named here (absolute paths, cwd, native
 * session ids, cost and context usage, attachment names, command lines of jobs, a delegation's paths, base, evidence,
 * context and handoff) never leaves. Free text is redacted, its paths replaced, and cut to `REMOTE_TEXT_LIMITS`.
 */

const TITLE = 200
const LABEL = 500

const text = (value: string | undefined, roots: readonly string[], limit: number) => clean(value, roots, limit).text

// ---- workspaces ---------------------------------------------------------------------------------------------------

export function toWorkspace(row: RemoteWorkspaceRow, phoneWrite: ReadonlySet<string>, roots: readonly string[], conversation?: (paneId: string) => boolean): RemoteWorkspace {
  return {
    id: row.id, name: text(row.name, roots, TITLE) || 'Workspace', active: row.active,
    // 1.5.0 A67 (#693): the slot the desktop shows, chosen or derived from the id; always 1–8.
    color: workspaceColorIndex({ id: row.id, color: row.color ?? null }),
    panes: row.panes.map((pane): RemotePane => {
      const agent = pane.agent
      return {
        id: pane.id,
        title: text(pane.displayName || pane.agentName || agent || pane.shellName || (pane.type === 'terminal' ? 'Terminal' : pane.type), roots, TITLE) || 'Terminal',
        kind: pane.type !== 'terminal' ? 'other' : agent || pane.agentName ? 'agent' : 'terminal',
        ...(agent ? { agent: text(agent, roots, 64) } : {}),
        ...(pane.agentState ? { agentState: pane.agentState } : {}),
        phoneWrite: phoneWrite.has(pane.id),
        // BE-A46-c5: only the flag; the conversation itself is read with `pane.conversation`.
        ...(conversation?.(pane.id) ? { conversation: true } : {})
      }
    })
  }
}

// ---- threads ------------------------------------------------------------------------------------------------------

export function toThreadSummary(thread: ConversationThread, pending: number, roots: readonly string[]): RemoteThreadSummary {
  return {
    id: thread.id, workspaceId: thread.workspaceId, title: text(thread.title, [thread.rootPath, ...roots], TITLE), provider: thread.provider, status: thread.status,
    ...(thread.lastTurnStatus ? { lastTurnStatus: thread.lastTurnStatus } : {}),
    ...(thread.background?.running ? { backgroundRunning: thread.background.running } : {}),
    pendingRequests: pending, updatedAt: thread.updatedAt
  }
}

/**
 * The header of one conversation. With `live` (the turns the window or delta read, and the clock), a running turn
 * adds how long it has run and how long the provider has been quiet (CCR #509 §1–2), measured here so the phone
 * needs no agreement between clocks; the quiet time uses the same signal as the desktop's live activity line.
 */
export function toThreadHeader(thread: ConversationThread, pending: number, roots: readonly string[], live?: { turns?: readonly ThreadTurn[]; now: number }): RemoteThreadHeader {
  const steering = thread.capabilities?.features?.steering
  const preview = (thread.queue ?? []).filter(item => item.state === 'queued' || item.state === 'sending').slice(0, REMOTE_QUEUE_PREVIEW.items).map(item => {
    const body = clean(item.text, [thread.rootPath, ...roots], REMOTE_QUEUE_PREVIEW.text)
    return { id: item.id, text: body.text, ...(body.truncated ? { truncated: true } : {}) }
  })
  return {
    ...toThreadSummary(thread, pending, roots),
    ...(thread.model ? { model: text(thread.model, roots, 100) } : {}),
    queued: thread.queue?.length ?? 0,
    canSteer: Boolean(steering?.enabled && steering.authorized && steering.availability === 'supported'),
    ...turnClock(thread, live),
    ...(preview.length ? { queuedPreview: preview } : {})
  }
}

function turnClock(thread: ConversationThread, live: { turns?: readonly ThreadTurn[]; now: number } | undefined): { turnElapsedMs?: number; quietMs?: number } {
  if (!live || (thread.status !== 'running' && thread.status !== 'approval')) return {}
  const turn = [...(live.turns ?? [])].reverse().find(item => item.status === 'running')
  const startedAt = turn?.startedAt
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return {}
  const elapsed = Math.max(0, Math.round(live.now - startedAt))
  if (thread.status !== 'running') return { turnElapsedMs: elapsed }
  const signal = thread.connection?.lastNativeSignalAt
  const last = typeof signal === 'number' && signal >= startedAt ? signal : startedAt
  return { turnElapsedMs: elapsed, quietMs: Math.max(0, Math.round(live.now - last)) }
}

/** One timeline event as the phone shows it, or null for what the phone never gets. */
export function toThreadItem(event: ThreadEvent, seq: number, rootsIn: readonly string[], patchOf?: (artifactId: string) => string | undefined): RemoteThreadItem | null {
  const roots = rootsIn
  switch (event.type) {
    case 'message': {
      const body = clean(event.text, roots, REMOTE_TEXT_LIMITS.itemText)
      return { type: 'message', id: event.id, role: event.role, text: body.text, ...(body.truncated ? { truncated: true } : {}), ...(event.attachments?.length ? { attachments: event.attachments.length } : {}) }
    }
    case 'reasoning': {
      const body = clean(event.text, roots, REMOTE_TEXT_LIMITS.itemText)
      return { type: 'reasoning', id: event.id, text: body.text, ...(body.truncated ? { truncated: true } : {}), completed: event.completedAt !== undefined }
    }
    case 'tool': {
      const detail = clean(event.detail, roots, REMOTE_TEXT_LIMITS.detail)
      const output = event.output === undefined ? undefined : clean(event.output, roots, REMOTE_TEXT_LIMITS.itemText)
      const changed = event.files?.length ? toToolDiff(event.files, roots, patchOf) : { redacted: 0 }
      const redacted = detail.redacted + (output?.redacted ?? 0) + changed.redacted
      return {
        type: 'tool', id: event.id, name: text(event.name, roots, TITLE), state: event.state, detail: detail.text,
        ...(output ? { output: output.text } : {}), ...(output?.truncated ? { outputTruncated: true } : {}),
        ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}), ...(event.files?.length ? { filesChanged: event.files.length } : {}),
        ...(event.interrupted ? { interrupted: true } : {}), ...(redacted ? { redacted } : {}), ...(changed.diff ? { diff: changed.diff } : {})
      }
    }
    case 'plan':
      return { type: 'plan', id: event.id, steps: event.steps.slice(0, 100).map(step => ({ label: text(step.label, roots, LABEL), status: step.status })) }
    case 'request':
      return { type: 'request', id: event.id, requestId: event.request.id, kind: event.request.kind, title: text(event.request.title, roots, TITLE), state: event.request.state }
    case 'subagent':
      return { type: 'subagent', id: event.id, state: event.state, agents: event.agents.length }
    case 'completed':
      return { type: 'completed', id: `completed:${seq}`, status: event.status, ...(event.errorCode ? { errorCode: event.errorCode } : {}) }
    default:
      // session, location, context usage, cost, CLI commands, model pickers, configuration, turn diffs, queue rows,
      // activity and signals: never on the phone.
      return null
  }
}

// ---- pending requests ---------------------------------------------------------------------------------------------

/** Only the desktop answers these: guarded requests, permissions, elicitation, tools and any secret question. */
const isDatabaseWriteRequest = (request: ThreadRequest): boolean => {
  if (request.impact?.kind === 'db') return true
  const tool = request.toolName?.replace(/^mcp__.+?__/, '')
  return tool === 'oxespace_db_execute' || tool === 'oxespace_mongo_write'
}

export function isAnswerable(request: ThreadRequest): boolean {
  if (request.state !== 'pending' || request.policy?.guarded || isDatabaseWriteRequest(request)) return false
  if (request.kind === 'approval') return decisionsOf(request).length > 0
  if (request.kind === 'question') return !!request.questions?.length && !request.questions.some(question => question.secret)
  return false
}

/** The provider's decisions, without "accept for the session", which the phone never offers. */
export function decisionsOf(request: ThreadRequest): Array<'accept' | 'decline' | 'cancel'> {
  const offered = request.availableDecisions ?? (request.kind === 'approval' ? ['accept', 'decline'] : ['decline'])
  return offered.filter((decision): decision is 'accept' | 'decline' | 'cancel' => decision === 'accept' || decision === 'decline' || decision === 'cancel')
}

export function toPendingRequest({ thread, request }: RemotePendingRow, roots: readonly string[]): RemotePendingRequest {
  const all = [thread.rootPath, ...roots]
  const command = request.command === undefined ? undefined : clean(request.command, all, REMOTE_TEXT_LIMITS.detail)
  const allWarnings = request.policy?.warnings ?? []
  const warnings = allWarnings.slice(0, 20).map(warning => clean(warning, all, REMOTE_TEXT_LIMITS.detail))
  const redacted = (command?.redacted ?? 0) + warnings.reduce((sum, warning) => sum + warning.redacted, 0)
  const cwd = request.cwd ? relativeTo(thread.rootPath, request.cwd) : undefined
  const shownPaths = (request.paths ?? []).map(path => relativeTo(thread.rootPath, path)).filter((path): path is string => path !== undefined)
  const paths = shownPaths.slice(0, 100)
  const detail = request.detail ? clean(request.detail, all, REMOTE_TEXT_LIMITS.detail) : undefined
  // Every question and option the phone is shown, each cut to the same limit as a command; what was cut is noted.
  const open = (request.questions ?? []).filter(question => !question.secret)
  let questionsCut = open.length > 20
  const questions = open.slice(0, 20).map(question => {
    const header = question.header ? clean(question.header, all, TITLE) : undefined
    const body = clean(question.question, all, REMOTE_TEXT_LIMITS.detail)
    const options = (question.options ?? []).slice(0, 50).map(option => ({ label: clean(option.label, all, REMOTE_TEXT_LIMITS.detail), description: option.description ? clean(option.description, all, REMOTE_TEXT_LIMITS.detail) : undefined }))
    if (header?.truncated || body.truncated || (question.options?.length ?? 0) > 50 || options.some(option => option.label.truncated || option.description?.truncated)) questionsCut = true
    return {
      id: question.id,
      ...(header ? { header: header.text } : {}),
      question: body.text,
      ...(options.length ? { options: options.map(option => ({ label: option.label.text, ...(option.description ? { description: option.description.text } : {}) })) } : {}),
      ...(question.multiple ? { multiple: true } : {}),
      ...(question.required !== undefined ? { required: question.required } : {})
    }
  })
  // Anything the phone cannot show whole leaves the decision to the desktop: no accept on what was not seen, and a
  // question not seen whole is not answered from the phone at all, not even declined.
  const truncated = !!command?.truncated || !!detail?.truncated || (!!request.cwd && cwd === undefined) || paths.length < (request.paths?.length ?? 0) ||
    allWarnings.length > 20 || warnings.some(warning => warning.truncated) || questionsCut
  const desktopOnly = (truncated && request.kind === 'question') || isDatabaseWriteRequest(request)
  const risk = request.impact?.risk ?? (request.policy?.level ? riskFromShell(request.policy.level) : undefined)
  return {
    threadId: thread.id, workspaceId: thread.workspaceId, threadTitle: text(thread.title, all, TITLE), requestId: request.id, generation: request.generation,
    kind: request.kind, title: text(request.title, all, TITLE),
    ...(detail ? { detail: detail.text } : {}),
    ...(command ? { command: command.text } : {}),
    ...(cwd ? { cwd } : {}),
    ...(request.reason ? { reason: text(request.reason, all, REMOTE_TEXT_LIMITS.detail) } : {}),
    ...(request.toolName ? { toolName: text(request.toolName, all, TITLE) } : {}),
    ...(paths.length ? { paths } : {}),
    ...(risk ? { risk } : {}),
    ...(warnings.length ? { warnings: warnings.map(warning => warning.text) } : {}),
    ...(redacted ? { redacted } : {}),
    ...(questions.length ? { questions } : {}),
    ...(truncated ? { truncated: true as const } : {}),
    decisions: desktopOnly ? [] : truncated ? decisionsOf(request).filter(decision => decision !== 'accept') : decisionsOf(request),
    answerable: isAnswerable(request) && !desktopOnly,
    createdAt: request.createdAt,
    ...(request.expiresAt !== undefined ? { expiresAt: request.expiresAt } : {})
  }
}

// ---- jobs and delegations -----------------------------------------------------------------------------------------

export function toJob(row: RemoteJobRow, roots: readonly string[]): RemoteJob {
  return { id: row.id, workspaceId: row.workspaceId, label: text(row.label, roots, TITLE), status: row.status, exitCode: row.exitCode, startedAt: row.startedAt, finishedAt: row.finishedAt }
}

export function toDelegation(row: RemoteDelegationRow, roots: readonly string[]): RemoteDelegation {
  return {
    id: row.id, workspaceId: row.workspaceId, objective: text(row.objective, roots, REMOTE_TEXT_LIMITS.objective), state: row.state,
    ...(row.error ? { error: text(row.error, roots, REMOTE_TEXT_LIMITS.detail) } : {}),
    ...(row.branch ? { branch: text(row.branch, roots, TITLE) } : {}),
    ...(row.destinationThreadId ? { destinationThreadId: row.destinationThreadId } : {}),
    updatedAt: row.updatedAt
  }
}

/**
 * S7.1 · One agent for the phone (CCR #513 §6): the state already mapped, the oldest pending request with main's own
 * title (never the agent's text), and nothing that names a place or an account: no path, worktree, session or cost.
 */
export function toRemoteAgent(
  row: AgentRow, rev: number, roots: readonly string[], words: (message: MainMessage) => string,
  /** How the phone itself sees a conversation's request (`toPendingRequest`): its risk, and whether it can answer it. */
  asShown?: (threadId: string, requestId: string) => Pick<RemotePendingRequest, 'risk' | 'answerable'> | undefined
): RemoteAgentRow {
  const oldest = [...row.requests].sort((a, b) => a.since - b.since)[0]
  const shown = oldest && row.kind === 'thread' ? asShown?.(row.id, oldest.requestId) : undefined
  return {
    kind: row.kind, id: row.id, rev, state: row.state, provider: row.provider,
    title: clean(row.title, roots, REMOTE_TEXT_LIMITS.objective).text, since: row.since,
    ...(oldest ? {
      request: {
        requestId: oldest.requestId, title: clean(words(oldest.title), roots, REMOTE_TEXT_LIMITS.detail).text, titleCode: oldest.title.code,
        titleParams: remoteParams(oldest.title.params, roots),
        // A conversation's request as the phone's own pending list has it (SECURITY #531 L3, L4); one the phone does
        // not list is not answerable from it.
        risk: row.kind === 'thread' ? shown?.risk ?? null : oldest.risk,
        answerable: row.kind === 'thread' ? shown?.answerable ?? false : oldest.answerable
      }
    } : {})
  }
}

/** A message's parameters for the phone: strings cleaned like any remote text, numbers kept, anything else dropped. */
function remoteParams(params: object, roots: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') out[key] = clean(value, roots, REMOTE_TEXT_LIMITS.detail).text
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}
