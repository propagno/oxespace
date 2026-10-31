/**
 * S7.1 · The seam between the agents read model and the phone (C5 `agents`). Everything the gateway needs is here and
 * tested; the gateway itself (#180/#204) is not on main yet.
 *
 * TODO(#204): when the gateway lands, its `agents` subscription calls `remoteAgentsSnapshot` on subscribe (and on a
 * needs-you setting change, a fresh snapshot to every subscriber) and `remoteAgentsEvents` for each `agents:changed`,
 * with the cursor `agentsCursor(epoch, seq)`. Its `agent.markSeen` command parses with `readRemoteMarkSeen`, calls
 * `AgentsReadModel.markSeen`, and records `agentMarkSeenAuditDetail` in the audit. `clean` is #204's `remote/text.ts`
 * cleaner, with `scrubPaths` and the workspace and project roots.
 */
import { pageRemoteAgents, splitRemoteAgentsEvent, toRemoteAgentRow } from '../../../../shared/agents/remoteAgentRow'
import type { RemoteAgentsEvent, RemoteAgentsSnapshot } from '../../../../shared/remote/protocol'
import type { AgentOverviewRow, AgentsChange, AgentsOverview } from '../../../../shared/types/ipc/agents'

export interface RemoteAgentsSeamDeps {
  /** Required: the gateway's free-text cleaner (secrets and paths under the person's roots). */
  clean: (text: string) => string
  /** The workspace's name, never its path. */
  workspaceName(row: AgentOverviewRow): string
  /** The row's request title in words (`tMain` of its C3 title). */
  requestTitle(row: AgentOverviewRow): string | undefined
  /** `RemotePendingRequest.answerable` for that request. */
  requestAnswerable(row: AgentOverviewRow): boolean
  /** Stop from the phone is allowed now (v1: running conversations). */
  canInterrupt(row: AgentOverviewRow): boolean
}

const remoteRow = (row: AgentOverviewRow, deps: RemoteAgentsSeamDeps) => toRemoteAgentRow(row, {
  clean: deps.clean,
  workspaceName: deps.workspaceName(row),
  ...(row.pendingRequest ? { requestTitle: deps.requestTitle(row), requestAnswerable: deps.requestAnswerable(row) } : {}),
  canInterrupt: deps.canInterrupt(row)
})

const resnapshot = new Set<() => void>()

/** TODO(#204): the gateway listens here and sends every `agents` subscriber a fresh snapshot (the setting changed). */
export function onRemoteAgentsResnapshot(listener: () => void): () => void {
  resnapshot.add(listener)
  return () => { resnapshot.delete(listener) }
}

/** The needs-you setting changed: phones get it in a fresh snapshot, never on an event (C5). */
export function requestRemoteAgentsResnapshot(): void {
  for (const listener of resnapshot) {
    try { listener() } catch { /* one subscriber's failure is the gateway's to report */ }
  }
}

/** The pages of an `agents` snapshot; the last carries the failed sources and the needs-you setting. */
export function remoteAgentsSnapshot(overview: AgentsOverview, deps: RemoteAgentsSeamDeps, nudgeAfterMs: number | null): RemoteAgentsSnapshot[] {
  const unavailable = (Object.keys(overview.sources) as (keyof AgentsOverview['sources'])[]).filter(kind => !overview.sources[kind].ok)
  return pageRemoteAgents({ agents: overview.rows.map(row => remoteRow(row, deps)), ...(unavailable.length ? { unavailable } : {}), ...(nudgeAfterMs !== null ? { nudgeAfterMs } : {}) })
}

/**
 * The events of one `agents:changed`. `unavailable` is sent whole when any source changed, so it replaces the list
 * the phone holds; `overview` is the read model's state after the change.
 */
export function remoteAgentsEvents(change: AgentsChange, overview: AgentsOverview, deps: RemoteAgentsSeamDeps): RemoteAgentsEvent[] {
  const unavailable = change.sources ? (Object.keys(overview.sources) as (keyof AgentsOverview['sources'])[]).filter(kind => !overview.sources[kind].ok) : undefined
  return splitRemoteAgentsEvent({
    ...(change.upsert?.length ? { upsert: change.upsert.map(row => remoteRow(row, deps)) } : {}),
    ...(change.removed?.length ? { removed: change.removed } : {}),
    ...(unavailable ? { unavailable } : {})
  })
}
