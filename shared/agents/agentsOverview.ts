/**
 * S7.1 · Rules every desktop reader of the agents read model shares: applying a change without letting a late event
 * overwrite a newer row (§5.3), checking a mark-seen, and the seen time it stores. Pure; main's runtime, the window's
 * store and the e2e double call the same code. The phone's row lives in `remoteAgentRow.ts`, so the renderer never
 * imports the remote protocol.
 */
import { mainMessage } from '../messages'
import type { AgentMarkSeenResult, AgentOverviewRow, AgentsChange, AgentsOverview, AgentsRefusal } from '../types/ipc/agents'
import { compareAgentRows, parseAgentKey, type AgentKey } from './agentState'

export type AppliedAgentsChange = { ok: true; overview: AgentsOverview } | { ok: false; reason: 'gap' }

/**
 * The overview after `change`. An old `seq` (already applied) changes nothing; a gap asks the reader to read the whole
 * overview again. A row is replaced only by one with a higher `rev`; a removal always applies. Rows stay sorted.
 */
export function applyAgentsChange(overview: AgentsOverview, change: AgentsChange): AppliedAgentsChange {
  if (change.seq <= overview.seq) return { ok: true, overview }
  if (change.seq !== overview.seq + 1) return { ok: false, reason: 'gap' }
  const rows = new Map(overview.rows.map(row => [row.key, row]))
  for (const key of change.removed ?? []) rows.delete(key)
  for (const row of change.upsert ?? []) {
    const current = rows.get(row.key)
    if (!current || row.rev > current.rev) rows.set(row.key, row)
  }
  return {
    ok: true,
    overview: { rows: [...rows.values()].sort(compareAgentRows), sources: { ...overview.sources, ...change.sources }, seq: change.seq }
  }
}

export type AgentsRefused = Extract<AgentMarkSeenResult, { ok: false }>
export const agentsRefusal = (refusal: AgentsRefusal): AgentsRefused => ({ ok: false, refusal, message: mainMessage(`agents.refused.${refusal}`, {}) })

/** A time from the window or the phone: a non-negative integer of epoch ms. */
export const isEpochMs = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Shape check of `agents:mark-seen`: exactly `{ key }` or `{ key, observedSince }`, a valid key, an epoch-ms time. */
export function normalizeMarkSeen(input: unknown): { ok: true; key: AgentKey; observedSince?: number } | AgentsRefused {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return agentsRefusal('invalid')
  const { key, observedSince, ...rest } = input as { key?: unknown; observedSince?: unknown }
  if (Object.keys(rest).length > 0 || !parseAgentKey(key)) return agentsRefusal('invalid')
  if (observedSince === undefined) return { ok: true, key: key as AgentKey }
  return isEpochMs(observedSince) ? { ok: true, key: key as AgentKey, observedSince } : agentsRefusal('invalid')
}

/** The refusal for a key no listed agent has. */
export const agentNotFound = (): AgentsRefused => agentsRefusal('notFound')

/**
 * The `seenAt` a mark stores (Q6). Without `observedSince`, main's clock. With it, when the row is Finished and
 * finished after what the person saw (`since > observedSince`), the stored time moves up to `observedSince` only, so
 * the row stays Finished. The stored time never moves backwards.
 */
export function seenAtFor(row: Pick<AgentOverviewRow, 'state' | 'since'>, input: { stored: number | null; now: number; observedSince?: number }): number {
  const stored = input.stored ?? 0
  if (input.observedSince !== undefined && row.state === 'finished' && row.since > input.observedSince) return Math.max(stored, input.observedSince)
  return Math.max(stored, input.now)
}
