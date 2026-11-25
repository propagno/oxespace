import { useEffect, useState } from 'react'
import type { AgentKey, AgentRow, AgentsChange, AgentsOverview } from '../../../shared/types/agents'

type AgentsBridge = {
  overview?: () => Promise<AgentsOverview>
  onChanged?: (listener: (change: AgentsChange) => void) => (() => void) | void
}

const oxeAgents = (): AgentsBridge | undefined =>
  (window as unknown as { oxe?: { agents?: AgentsBridge } }).oxe?.agents

export const agentKeyOf = (key: AgentKey): string => `${key.kind}:${key.id}`

/** Main's change applied to the rows the window holds: removed ones go, upserted ones replace theirs in place or join. */
export function applyAgentsChange(rows: AgentRow[], change: AgentsChange): AgentRow[] {
  const removed = new Set((change.removed ?? []).map(agentKeyOf))
  const upsert = new Map((change.upsert ?? []).map(row => [agentKeyOf(row), row]))
  const next: AgentRow[] = []
  for (const row of rows) {
    const key = agentKeyOf(row)
    if (removed.has(key)) continue
    const replaced = upsert.get(key)
    if (replaced) { next.push(replaced); upsert.delete(key) } else next.push(row)
  }
  return [...next, ...upsert.values()]
}

/** Every agent main reports, kept current by its pushes. Empty when the bridge is not there. */
export function useAgentsOverview(): AgentRow[] {
  const [agents, setAgents] = useState<AgentRow[]>([])
  useEffect(() => {
    const api = oxeAgents()
    if (!api || typeof api.overview !== 'function') return
    let alive = true
    // Changes pushed while the first read is in flight are applied on top of it.
    let early: AgentsChange[] | null = []
    const off = typeof api.onChanged === 'function' ? api.onChanged(change => {
      if (!alive || !change) return
      if (early) { early.push(change); return }
      setAgents(rows => applyAgentsChange(rows, change))
    }) : undefined
    api.overview().then(overview => {
      if (!alive) return
      let rows = Array.isArray(overview?.agents) ? overview.agents : []
      for (const change of early ?? []) rows = applyAgentsChange(rows, change)
      early = null
      setAgents(rows)
    }).catch(() => { early = null })
    return () => { alive = false; if (typeof off === 'function') off() }
  }, [])
  return agents
}

/**
 * Main's overview plus the terminals main's agent-state broadcast reports as waiting (the terminal store's live
 * attention) that the overview does not list yet: one row per pane, never two. The overview's row always wins.
 */
export function withWaitingPanes(agents: readonly AgentRow[], liveCode: Record<string, string>, waiting: Record<string, { since: number }>,
  workspaces: ReadonlyArray<{ id: string; panes: ReadonlyArray<{ id: string; type: string; agentName?: string | null; displayName?: string | null }> }>): AgentRow[] {
  const known = new Set(agents.filter(row => row.kind === 'pane').map(row => row.id))
  const extra: AgentRow[] = []
  for (const [paneId, state] of Object.entries(liveCode)) {
    if (state !== 'needs-you' || known.has(paneId)) continue
    const workspace = workspaces.find(item => item.panes.some(pane => pane.id === paneId))
    const pane = workspace?.panes.find(item => item.id === paneId)
    if (!workspace || !pane || pane.type !== 'terminal') continue
    const since = waiting[paneId]?.since ?? 0
    extra.push({ kind: 'pane', id: paneId, state: 'needs-you', provider: 'other', mode: 'code', title: pane.agentName ?? '', workspaceId: workspace.id, since,
      seenAt: null, session: null, worktree: null, cost: null, requests: [] } as AgentRow)
  }
  return extra.length ? [...agents, ...extra] : [...agents]
}

/** The pill's number: every answerable request of a needs-you agent plus every waiting terminal (OXE-176). */
export function pendingCount(agents: readonly AgentRow[]): number {
  let count = 0
  for (const row of agents) {
    if (row.state !== 'needs-you') continue
    if (row.kind === 'pane') count += 1
    else count += (row.requests ?? []).filter(request => request.answerable).length
  }
  return count
}
