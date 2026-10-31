/**
 * S7.1 · Rules every reader of the agents read model shares: applying a change without letting a late event overwrite
 * a newer row (§5.3), checking a mark-seen, and turning a desktop row into the phone's (§8: no paths, no session ids,
 * no per-row cost). Pure; main's runtime, the window's store, the e2e double and the remote gateway call the same code.
 */
import { mainMessage } from '../messages'
import { REMOTE_TEXT_LIMITS, type RemoteAgentRow } from '../remote/protocol'
import type { AgentMarkSeenResult, AgentOverviewRow, AgentsChange, AgentsOverview, AgentsRefusal } from '../types/ipc/agents'
import { compareAgentRows, parseAgentKey, type AgentKey } from './agentState'

export type AppliedAgentsChange = { ok: true; overview: AgentsOverview } | { ok: false; reason: 'gap' }

/**
 * The overview after `change`. An old `seq` (already applied) changes nothing; a gap asks the reader to read the whole
 * overview again. A row is replaced only by one with a higher `sourceSeq`; a removal always applies. Rows stay sorted.
 */
export function applyAgentsChange(overview: AgentsOverview, change: AgentsChange): AppliedAgentsChange {
  if (change.seq <= overview.seq) return { ok: true, overview }
  if (change.seq !== overview.seq + 1) return { ok: false, reason: 'gap' }
  const rows = new Map(overview.rows.map(row => [row.key, row]))
  for (const key of change.removed ?? []) rows.delete(key)
  for (const row of change.upsert ?? []) {
    const current = rows.get(row.key)
    if (!current || row.sourceSeq > current.sourceSeq) rows.set(row.key, row)
  }
  return {
    ok: true,
    overview: { rows: [...rows.values()].sort(compareAgentRows), sources: { ...overview.sources, ...change.sources }, seq: change.seq }
  }
}

const refuse = (refusal: AgentsRefusal): Extract<AgentMarkSeenResult, { ok: false }> => ({ ok: false, refusal, message: mainMessage(`agents.refused.${refusal}`, {}) })

/** Shape check of `agents:mark-seen` (and the phone's `agent.markSeen`): exactly `{ key }`, a valid key. */
export function normalizeMarkSeen(input: unknown): { ok: true; key: AgentKey } | Extract<AgentMarkSeenResult, { ok: false }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refuse('invalid')
  const keys = Object.keys(input)
  if (keys.length !== 1 || keys[0] !== 'key') return refuse('invalid')
  const key = (input as { key: unknown }).key
  return parseAgentKey(key) ? { ok: true, key: key as AgentKey } : refuse('invalid')
}

/** The refusal for a key no listed agent has. */
export const agentNotFound = (): Extract<AgentMarkSeenResult, { ok: false }> => refuse('notFound')

/** Characters of a text, cut on code points. */
export function cutText(text: string, max: number): string {
  const points = [...text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()]
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : points.join('')
}

export interface RemoteAgentContext {
  /** The workspace's name, never its path. */
  workspaceName: string
  /** The request's main-built title, already in words (the desktop's language), when the row has one. */
  requestTitle?: string
  /** Whether the phone may answer that request (`RemotePendingRequest.answerable`). */
  requestAnswerable?: boolean
  /** The desktop allows Stop from the phone now (v1: running conversations only, §11.2). */
  canInterrupt?: boolean
}

/**
 * The phone's row: the same state, mapped on the desktop. Left out on purpose: the worktree path, the cost, the seen
 * time and the source sequence (the subscription has its own), and any session id (rows never carry one).
 */
export function toRemoteAgentRow(row: AgentOverviewRow, context: RemoteAgentContext): RemoteAgentRow {
  const remote: RemoteAgentRow = {
    id: row.key,
    kind: row.kind,
    state: row.state,
    since: row.since,
    title: cutText(row.title, REMOTE_TEXT_LIMITS.agentTitle),
    workspaceName: cutText(context.workspaceName, REMOTE_TEXT_LIMITS.agentTitle)
  }
  if (row.provider) remote.provider = row.provider
  if (row.parentKey) remote.parentId = row.parentKey
  if (row.kind === 'conversation') remote.threadId = row.id
  if (row.kind === 'pane') remote.paneId = row.id
  if (row.pendingRequest) {
    const request = row.pendingRequest
    remote.request = {
      requestId: request.id,
      title: cutText(context.requestTitle ?? '', REMOTE_TEXT_LIMITS.agentTitle),
      answerable: request.via === 'thread' && context.requestAnswerable === true,
      more: request.more
    }
    const threadId = request.threadId ?? (row.kind === 'conversation' ? row.id : undefined)
    if (threadId) remote.request.threadId = threadId
    if (request.risk) remote.request.risk = request.risk
  }
  if (row.tasks) remote.tasks = { done: row.tasks.done, total: row.tasks.total }
  if (context.canInterrupt && row.kind === 'conversation' && row.state === 'working') remote.canInterrupt = true
  return remote
}
