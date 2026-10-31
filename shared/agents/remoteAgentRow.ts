/**
 * S7.1 · The phone's side of the agents read model (C5 `agents`, docs/design/s7-mission-control.md §8): building a row
 * from a desktop row, paging rows and events into frames, the subscription cursor, and the `agent.markSeen` args.
 * Gateway only: the renderer imports `agentsOverview.ts`, never this module, so the remote protocol stays out of it.
 *
 * Privacy (§8): no path, no session id, no cost, no seen time, no revision. Free text (titles, workspace names, request
 * titles) goes through the gateway's cleaner first, the same one the `threads` and `delegations` topics use, which
 * removes secrets and paths under the person's roots; then hidden and control characters go and the text is cut.
 */
import { HIDDEN_CHARACTERS } from '../hidden-characters'
import { REMOTE_LIMITS, REMOTE_TEXT_LIMITS, type RemoteAgentMarkSeenArgs, type RemoteAgentRow, type RemoteAgentsEvent, type RemoteAgentsSnapshot } from '../remote/protocol'
import type { AgentMarkSeenInput, AgentOverviewRow } from '../types/ipc/agents'
import { isEpochMs } from './agentsOverview'
import { parseAgentKey, type AgentKey } from './agentState'

const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g
const HIDDEN = new RegExp(HIDDEN_CHARACTERS.source, 'gu')

/**
 * One line of shown text: control characters become a space, the hidden characters of `shared/hidden-characters.ts`
 * (bidi controls, zero-width, tags…) are removed, so a title cannot pose as another row; then cut on code points.
 */
export function cutText(text: string, max: number): string {
  const points = [...text.replace(HIDDEN, '').replace(CONTROL, ' ').replace(/ {2,}/g, ' ').trim()]
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : points.join('')
}

/** A provider or manifest id as the phone may receive it; anything else is left out. */
export const REMOTE_PROVIDER_PATTERN = /^[a-z0-9._-]{1,64}$/

export interface RemoteAgentContext {
  /**
   * Required: the gateway's cleaner for free text (secrets, and paths under the workspace and project roots), the one
   * `toThreadSummary` and `toDelegation` use. Applied to the title, the workspace name and the request title.
   */
  clean: (text: string) => string
  /** The workspace's name, never its path. */
  workspaceName: string
  /** The request's main-built title, already in words (the desktop's language), when the row has one. */
  requestTitle?: string
  /** Whether the phone may answer that request (`RemotePendingRequest.answerable`). */
  requestAnswerable?: boolean
  /** The desktop allows Stop from the phone now (v1: running conversations only, §11.2). */
  canInterrupt?: boolean
}

const shown = (context: RemoteAgentContext, text: string): string => cutText(context.clean(text), REMOTE_TEXT_LIMITS.agentTitle)

/** The phone's row: the same state, mapped on the desktop. Only this function builds one. */
export function toRemoteAgentRow(row: AgentOverviewRow, context: RemoteAgentContext): RemoteAgentRow {
  const remote: RemoteAgentRow = {
    id: row.key,
    kind: row.kind,
    state: row.state,
    since: row.since,
    title: shown(context, row.title),
    workspaceName: shown(context, context.workspaceName)
  }
  if (row.provider && REMOTE_PROVIDER_PATTERN.test(row.provider)) remote.provider = row.provider
  if (row.parentKey) remote.parentId = row.parentKey
  if (row.kind === 'conversation') remote.threadId = row.id
  if (row.kind === 'pane') remote.paneId = row.id
  if (row.pendingRequest) {
    const request = row.pendingRequest
    remote.request = {
      requestId: request.id,
      title: shown(context, context.requestTitle ?? ''),
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

// ---- frames (H2) --------------------------------------------------------------------------------------------------

/** Bytes a frame keeps for its envelope (type, subscription, seq, cursor, page, unavailable, nudgeAfterMs). */
export const AGENTS_FRAME_RESERVE_BYTES = 2_048
/** Bytes of `data` one agents frame may carry. */
export const AGENTS_FRAME_DATA_BYTES = REMOTE_LIMITS.maxFrameBytes - AGENTS_FRAME_RESERVE_BYTES

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength

/** Greedy packing: in order, at most `maxRows` items and `maxBytes` of JSON per group (an item over it goes alone). */
function pack<Item>(items: readonly Item[], maxRows: number, maxBytes: number, overhead: number): Item[][] {
  const groups: Item[][] = []
  let current: Item[] = [], used = overhead
  for (const item of items) {
    const size = bytes(item) + 1
    if (current.length > 0 && (current.length >= maxRows || used + size > maxBytes)) { groups.push(current); current = []; used = overhead }
    current.push(item)
    used += size
  }
  if (current.length > 0 || groups.length === 0) groups.push(current)
  return groups
}

/**
 * A snapshot as pages: each at most `REMOTE_TEXT_LIMITS.agentsPage` rows **and** `AGENTS_FRAME_DATA_BYTES` of data.
 * Only the page marked `last` carries `unavailable` and `nudgeAfterMs`: the phone applies the snapshot when it arrives.
 */
export function pageRemoteAgents(snapshot: RemoteAgentsSnapshot): RemoteAgentsSnapshot[] {
  const { agents, ...tail } = snapshot
  const pages: RemoteAgentsSnapshot[] = pack(agents, REMOTE_TEXT_LIMITS.agentsPage, AGENTS_FRAME_DATA_BYTES, bytes({ agents: [], ...tail })).map(rows => ({ agents: rows }))
  Object.assign(pages[pages.length - 1], tail)
  return pages
}

/**
 * One change as frames under the same limits: removals first (with `unavailable`), then upserts, in order. The phone
 * applies each frame as it comes, so a split change only shows its rows a few milliseconds apart.
 */
export function splitRemoteAgentsEvent(event: RemoteAgentsEvent): RemoteAgentsEvent[] {
  const frames: RemoteAgentsEvent[] = []
  const head = event.unavailable ? { unavailable: event.unavailable } : {}
  if (event.removed?.length) {
    for (const removed of pack(event.removed, Number.MAX_SAFE_INTEGER, AGENTS_FRAME_DATA_BYTES, bytes({ removed: [], ...head }))) frames.push({ ...(frames.length === 0 ? head : {}), removed })
  }
  if (event.upsert?.length) {
    for (const upsert of pack(event.upsert, REMOTE_TEXT_LIMITS.agentsPage, AGENTS_FRAME_DATA_BYTES, bytes({ upsert: [], ...head }))) frames.push({ ...(frames.length === 0 ? head : {}), upsert })
  }
  if (frames.length === 0) frames.push({ ...head })
  return frames
}

// ---- cursor (L4) --------------------------------------------------------------------------------------------------

/**
 * The `agents` cursor: `<epoch>:<seq>`. `epoch` is new each time the desktop app starts (main's `seq` restarts at 0),
 * so a phone that reconnects after a desktop restart gets a fresh snapshot, never a false "no gap".
 */
export const agentsCursor = (epoch: string, seq: number): string => `${epoch}:${seq}`

/** The `seq` to resume after, or null when the cursor is from another epoch or not one: send a snapshot. */
export function readAgentsCursor(cursor: unknown, epoch: string): number | null {
  if (typeof cursor !== 'string') return null
  const at = cursor.lastIndexOf(':')
  if (at <= 0 || cursor.slice(0, at) !== epoch) return null
  const seq = cursor.slice(at + 1)
  return /^[0-9]{1,15}$/.test(seq) ? Number(seq) : null
}

// ---- agent.markSeen (L3) ------------------------------------------------------------------------------------------

/** The gateway's id rule, which every key the desktop builds passes (`AGENT_KEY_MAX`, `AGENT_KEY_ID_PATTERN`). */
export const REMOTE_AGENT_ID = /^[A-Za-z0-9._:-]{1,200}$/

/** Strict parse of `agent.markSeen` args: exactly `{ agentId }` or `{ agentId, observedSince }`; anything else is `malformed`. */
export function readRemoteMarkSeen(args: unknown): { ok: true; input: AgentMarkSeenInput } | { ok: false; code: 'malformed' } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, code: 'malformed' }
  const { agentId, observedSince, ...rest } = args as Partial<Record<keyof RemoteAgentMarkSeenArgs, unknown>>
  if (Object.keys(rest).length > 0 || typeof agentId !== 'string' || !REMOTE_AGENT_ID.test(agentId) || !parseAgentKey(agentId)) return { ok: false, code: 'malformed' }
  if (observedSince !== undefined && !isEpochMs(observedSince)) return { ok: false, code: 'malformed' }
  return { ok: true, input: { key: agentId as AgentKey, ...(observedSince !== undefined ? { observedSince } : {}) } }
}

/** What the desktop's audit records for an `agent.markSeen`, beside the device id: the agent it marked. */
export const agentMarkSeenAuditDetail = (input: AgentMarkSeenInput): { agentId: string } => ({ agentId: input.key })
