/**
 * S7.1 · The agents read model (docs/design/s7-mission-control.md §3, §5.3, §5.10, §13). Loaded on demand by
 * `wiring.ts` on the first `agents:*` call, never at boot.
 *
 * - **Incremental, never polled.** Each source event (`source-events.ts`) re-reads that one source item. A flush, at
 *   most `coalesceMs` later, rebuilds the rows from the cached facts and pushes only the rows whose content changed;
 *   nothing changed, nothing is sent. Each row's `rev` grows on any change; `seq` grows per push.
 * - **Each source answers separately.** A source that throws is `{ok:false}` with its C3 code; the others go on.
 * - **Timers per row, never polled.** A waiting request gets one `setTimeout` for the needs-you nudge; a Stop gets one
 *   for the no-report window. Both come from `shared/agents/agentTimers.ts`.
 */
import { agentKey, parseAgentKey, type AgentKey, type AgentKind } from '../../../../shared/agents/agentState'
import { agentNotFound, normalizeMarkSeen, seenAtFor } from '../../../../shared/agents/agentsOverview'
import { dueNudges, NUDGE_BATCH_MS, type AgentTimers } from '../../../../shared/agents/agentTimers'
import { mainMessage } from '../../../../shared/messages'
import type { PaneAgentState } from '../../../../shared/types/agent-state'
import type { ApprovalRequest } from '../../../../shared/types/approvals'
import type { DelegationTask } from '../../../../shared/types/delegation'
import { AGENT_SOURCE_UNAVAILABLE_CODES, type AgentMarkSeenResult, type AgentOverviewRow, type AgentsChange, type AgentSourceStatus, type AgentsOverview } from '../../../../shared/types/ipc/agents'
import type { Workspace } from '../../../../shared/types/workspace'
import { draftRows, stampRows, type AgentFacts, type ConversationFacts, type RowHistory, type WorkFacts } from './agent-rows'
import type { AgentSourceEvent } from './source-events'

/** How the read model reads each source. `get` returns null when the item is gone for good. */
export interface AgentSources {
  panes: { list(): PaneAgentState[]; get(paneId: string): PaneAgentState | null }
  conversations: { all(): ConversationFacts[]; get(threadId: string): ConversationFacts | null }
  delegations: { all(): DelegationTask[]; get(id: string): DelegationTask | null }
  work: { all(): WorkFacts[]; get(runId: string): WorkFacts | null }
  approvals: { list(): ApprovalRequest[] }
  workspaces(): Workspace[]
  providerOf(agentProfileId: string): string | undefined
}

export interface AgentsReadModelDeps {
  sources: AgentSources
  seen: { all(): Map<string, number>; mark(key: string, seenAt: number): number; delete(key: string): void }
  subscribe(listener: (event: AgentSourceEvent) => void): () => void
  /** Stops asked for an agent (`notifyAgentStop`); each starts its no-report window. */
  subscribeStops(listener: (key: string) => void): () => void
  publish(change: AgentsChange): void
  /** One desktop notification for these needs-you rows (one, or a batch). */
  nudge(rows: AgentOverviewRow[]): void
  focused(): boolean
  /** A pane keeps its own seen flag in the agent-state service; marking a pane row seen sets it there too. */
  markPaneSeen(paneId: string): void
  timers: AgentTimers
  /** The person's needs-you setting; `null` is off. Defaults to `timers.needsYouMs`. */
  nudgeAfterMs?: () => number | null
  now?: () => number
  /** Changes within this window go out as one push (§5.3: a change reaches the window within 1 s). */
  coalesceMs?: number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** Grouping window for pushes: well inside the 1 s promise, wide enough to fold a burst of thread events. */
export const AGENTS_COALESCE_MS = 150

const KIND_OF_SOURCE: Record<Exclude<AgentSourceEvent['source'], 'approval'>, AgentKind> = { pane: 'pane', conversation: 'conversation', delegation: 'delegation', work: 'work' }

export class AgentsReadModel {
  private readonly now: () => number
  private readonly coalesceMs: number
  private readonly setTimer: (run: () => void, ms: number) => unknown
  private readonly clearTimer: (timer: unknown) => void
  private readonly panes = new Map<string, PaneAgentState>()
  private readonly conversations = new Map<string, ConversationFacts>()
  private readonly delegations = new Map<string, DelegationTask>()
  private readonly work = new Map<string, WorkFacts>()
  private approvals: ApprovalRequest[] = []
  private readonly status: Record<AgentKind, AgentSourceStatus> = { pane: { ok: true }, conversation: { ok: true }, delegation: { ok: true }, work: { ok: true } }
  private seenAt = new Map<string, number>()
  private history = new Map<string, RowHistory>()
  private rows: AgentOverviewRow[] = []
  private sent: Record<AgentKind, string> = { pane: '', conversation: '', delegation: '', work: '' }
  private seq = 0
  private flushTimer: unknown = null
  private unsubscribe: (() => void) | null = null
  private unsubscribeStops: (() => void) | null = null
  /** Stops waiting for a report: key → when the Stop was asked, and its timer. */
  private readonly stops = new Map<string, { at: number; timer: unknown }>()
  private readonly lastReportAt = new Map<string, number>()
  private readonly stuck = new Set<string>()
  private readonly nudgeTimers = new Map<string, unknown>()
  private readonly nudged = new Set<string>()

  constructor(private readonly deps: AgentsReadModelDeps) {
    this.now = deps.now ?? Date.now
    this.coalesceMs = deps.coalesceMs ?? AGENTS_COALESCE_MS
    this.setTimer = deps.setTimer ?? ((run, ms) => { const timer = setTimeout(run, ms); timer.unref?.(); return timer })
    this.clearTimer = deps.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>))
  }

  /** The first read of every source, then live: from here on, only events change it. */
  start(): void {
    this.read('pane', () => { for (const pane of this.deps.sources.panes.list()) this.panes.set(pane.paneId, pane) })
    this.read('conversation', () => { for (const facts of this.deps.sources.conversations.all()) this.conversations.set(facts.thread.id, facts) })
    this.read('delegation', () => { for (const task of this.deps.sources.delegations.all()) this.delegations.set(task.id, task) })
    this.read('work', () => { for (const facts of this.deps.sources.work.all()) this.work.set(facts.run.id, facts) })
    this.readApprovals()
    try { this.seenAt = this.deps.seen.all() } catch { this.seenAt = new Map() }
    this.rebuild()
    this.sent = this.statusBodies()
    // Requests already waiting when the model loads get their timers now.
    this.scheduleNudges()
    this.unsubscribe = this.deps.subscribe(event => this.onSource(event))
    this.unsubscribeStops = this.deps.subscribeStops(key => this.noteStop(key))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribeStops?.()
    this.unsubscribe = this.unsubscribeStops = null
    if (this.flushTimer !== null) this.clearTimer(this.flushTimer)
    for (const { timer } of this.stops.values()) this.clearTimer(timer)
    for (const timer of this.nudgeTimers.values()) this.clearTimer(timer)
  }

  overview(): AgentsOverview {
    return structuredClone({ rows: this.rows, sources: this.status, seq: this.seq })
  }

  /** `agents:mark-seen`, and the phone's `agent.markSeen` once the gateway lands (#204). */
  markSeen(input: unknown): AgentMarkSeenResult {
    const checked = normalizeMarkSeen(input)
    if (!checked.ok) return checked
    const row = this.rows.find(item => item.key === checked.key)
    if (!row) return agentNotFound()
    const seenAt = seenAtFor(row, { stored: this.seenAt.get(row.key) ?? null, now: this.now(), observedSince: checked.observedSince })
    this.seenAt.set(row.key, this.deps.seen.mark(row.key, seenAt))
    if (row.kind === 'pane' && row.state === 'finished') this.deps.markPaneSeen(row.id)
    this.flush()
    return { ok: true, key: row.key, seenAt: this.seenAt.get(row.key)!, state: this.rows.find(item => item.key === row.key)?.state ?? row.state }
  }

  /**
   * A Stop was asked for this agent (S7.3's Stop, `thread.interrupt`, a pane stop). With no report from its source
   * within the no-report window, the row shows `unknown`, never "Stopping…" forever (§13).
   */
  noteStop(key: string): void {
    if (!parseAgentKey(key)) return
    const previous = this.stops.get(key)
    if (previous) this.clearTimer(previous.timer)
    const at = this.now()
    const timer = this.setTimer(() => {
      this.stops.delete(key)
      if ((this.lastReportAt.get(key) ?? 0) > at) return
      this.stuck.add(key)
      this.flush()
    }, this.deps.timers.noReportMs)
    this.stops.set(key, { at, timer })
  }

  /** The window lost focus: a request already waiting long enough is nudged now (§5.10). */
  focusChanged(): void {
    this.evaluateNudges()
  }

  private onSource(event: AgentSourceEvent): void {
    if (event.source === 'approval') this.readApprovals()
    else if (event.id) this.refresh(KIND_OF_SOURCE[event.source], event.id, event.deleted === true)
    this.scheduleFlush()
  }

  private refresh(kind: AgentKind, id: string, deleted: boolean): void {
    const key = agentKey(kind, id)
    this.lastReportAt.set(key, this.now())
    // A new report ends the no-report window.
    this.stuck.delete(key)
    const stop = this.stops.get(key)
    if (stop) { this.clearTimer(stop.timer); this.stops.delete(key) }
    const forget = <T>(map: Map<string, T>, value: T | null): void => {
      if (value && !deleted) { map.set(id, value); return }
      map.delete(id)
      // The source is gone: its seen mark goes with it.
      this.seenAt.delete(key)
      try { this.deps.seen.delete(key) } catch { /* the mark only costs a row until the cap */ }
    }
    this.read(kind, () => {
      if (kind === 'pane') forget(this.panes, deleted ? null : this.deps.sources.panes.get(id))
      else if (kind === 'conversation') forget(this.conversations, deleted ? null : this.deps.sources.conversations.get(id))
      else if (kind === 'delegation') forget(this.delegations, deleted ? null : this.deps.sources.delegations.get(id))
      else forget(this.work, deleted ? null : this.deps.sources.work.get(id))
    })
  }

  /** Runs one source read; a throw marks that source unavailable and leaves the others alone. */
  private read(kind: AgentKind, run: () => void): void {
    try {
      run()
      this.status[kind] = { ok: true }
    } catch {
      this.status[kind] = { ok: false, message: mainMessage(AGENT_SOURCE_UNAVAILABLE_CODES[kind], {}) }
    }
  }

  private readApprovals(): void {
    try { this.approvals = this.deps.sources.approvals.list().filter(request => request.requester.kind === 'agent') } catch { /* rows keep the requests last read */ }
  }

  private facts(): AgentFacts {
    let workspaces: Workspace[] = []
    try { workspaces = this.deps.sources.workspaces() } catch { /* pane rows fall back to the agent's name */ }
    return { panes: this.panes, conversations: this.conversations, delegations: this.delegations, work: this.work, approvals: this.approvals, workspaces,
      providerOf: id => { try { return this.deps.sources.providerOf(id) } catch { return undefined } } }
  }

  private rebuild(): { upsert: AgentOverviewRow[]; removed: AgentKey[] } {
    const facts = this.facts()
    const before = new Map(this.rows.map(row => [row.key, row.rev]))
    const { rows, history } = stampRows(draftRows(facts), facts, this.seenAt, this.history, this.stuck, this.now())
    this.rows = rows
    this.history = history
    const after = new Set(rows.map(row => row.key))
    return {
      upsert: rows.filter(row => before.get(row.key) !== row.rev),
      removed: [...before.keys()].filter(key => !after.has(key)) as AgentKey[]
    }
  }

  private statusBodies(): Record<AgentKind, string> {
    return Object.fromEntries(Object.entries(this.status).map(([kind, value]) => [kind, JSON.stringify(value)])) as Record<AgentKind, string>
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return
    this.flushTimer = this.setTimer(() => { this.flushTimer = null; this.flush() }, this.coalesceMs)
  }

  /** Rebuilds and pushes what changed: rows by revision, sources by value. Nothing changed, nothing is sent. */
  private flush(): void {
    if (this.flushTimer !== null) { this.clearTimer(this.flushTimer); this.flushTimer = null }
    const { upsert, removed } = this.rebuild()
    const bodies = this.statusBodies()
    const sources = Object.fromEntries((Object.keys(bodies) as AgentKind[]).filter(kind => bodies[kind] !== this.sent[kind]).map(kind => [kind, this.status[kind]]))
    this.sent = bodies
    this.scheduleNudges()
    if (!upsert.length && !removed.length && !Object.keys(sources).length) return
    this.seq += 1
    this.deps.publish(structuredClone({ seq: this.seq, ...(upsert.length ? { upsert } : {}), ...(removed.length ? { removed } : {}), ...(Object.keys(sources).length ? { sources } : {}) }))
  }

  private waiting() {
    return this.rows.filter(row => row.state === 'needs-you' && row.pendingRequest).map(row => ({ key: row.key, requestId: row.pendingRequest!.id, since: row.pendingRequest!.since }))
  }

  /** One timer per waiting request, at the moment it is due; requests that stopped waiting lose theirs. */
  private scheduleNudges(): void {
    const nudgeAfterMs = this.nudgeAfterMs()
    const waiting = this.waiting()
    const live = new Set(waiting.map(item => item.requestId))
    for (const [requestId, timer] of this.nudgeTimers) if (!live.has(requestId) || nudgeAfterMs === null) { this.clearTimer(timer); this.nudgeTimers.delete(requestId) }
    for (const requestId of this.nudged) if (!live.has(requestId)) this.nudged.delete(requestId)
    if (nudgeAfterMs === null) return
    for (const request of waiting) {
      if (this.nudged.has(request.requestId) || this.nudgeTimers.has(request.requestId)) continue
      const delay = Math.max(0, request.since + nudgeAfterMs - this.now())
      this.nudgeTimers.set(request.requestId, this.setTimer(() => { this.nudgeTimers.delete(request.requestId); this.evaluateNudges() }, delay))
    }
  }

  private nudgeAfterMs(): number | null {
    return this.deps.nudgeAfterMs ? this.deps.nudgeAfterMs() : this.deps.timers.needsYouMs
  }

  private evaluateNudges(): void {
    // Requests that come due within the batch window of the first go out with it (§5.10: "3 agents need you").
    const batches = dueNudges(this.waiting(), this.nudged, { now: this.now() + NUDGE_BATCH_MS, nudgeAfterMs: this.nudgeAfterMs(), focused: this.deps.focused() })
    const now = this.now(), after = this.nudgeAfterMs()
    for (const batch of batches) {
      // Only a batch whose first request is really due now; the rest wait for their own timer.
      if (after === null || now - batch[0].since < after) continue
      for (const request of batch) { this.nudged.add(request.requestId); const timer = this.nudgeTimers.get(request.requestId); if (timer) { this.clearTimer(timer); this.nudgeTimers.delete(request.requestId) } }
      const keys = new Set(batch.map(request => request.key))
      this.deps.nudge(this.rows.filter(row => keys.has(row.key)))
    }
  }
}
