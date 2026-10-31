/**
 * S7.1 · The agents read model (docs/design/s7-mission-control.md §3, §5.3, §5.10, §13). Loaded on demand by
 * `wiring.ts`, on the first `agents:*` call or the first source event, never at boot.
 *
 * - **Incremental, never polled.** A source event (`source-events.ts`) only marks its item dirty. A flush, at most
 *   `coalesceMs` later, re-reads each dirty item once, rebuilds the rows from the cached facts, and pushes only the rows
 *   whose content changed; nothing changed, nothing is sent. Each row's `rev` grows on any change; `seq` per push.
 * - **Each source answers separately.** A source that throws is `{ok:false}` with its C3 code; the others go on. While
 *   it is down, its next event re-reads the whole source, so it is never reported OK with a partial cache.
 * - **Timers per row, never polled.** A waiting request gets one `setTimeout` for the needs-you nudge; a Stop of a
 *   working or needs-you row gets one for the no-report window. Both come from `shared/agents/agentTimers.ts`.
 *   Needs-you rows without a request (a blocked run, a delegation in review) are shown but not notified in v1.
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
  seen: { all(): Map<string, number>; mark(key: string, seenAt: number): { seenAt: number; evicted: string[] }; delete(key: string): void }
  subscribe(listener: (event: AgentSourceEvent) => void): () => void
  /** Stops asked for an agent (`notifyAgentStop`), and Stops that failed (`notifyAgentStopFailed`). */
  subscribeStops(listener: (key: string) => void, failed: (key: string) => void): () => void
  publish(change: AgentsChange): void
  /** One desktop notification for these needs-you rows (one, or a batch). */
  nudge(rows: AgentOverviewRow[]): void
  focused(): boolean
  /** A pane keeps its own seen flag in the agent-state service; marking a pane row seen sets it there too. */
  markPaneSeen(paneId: string): void
  timers: AgentTimers
  /** The person's needs-you setting (`agent_settings`); `null` is off. Defaults to `timers.needsYouMs`. */
  nudgeAfterMs?: () => number | null
  /** A failure nothing else reports (a read of the seen marks or the approvals, a flush). */
  warn?: (message: string, error: unknown) => void
  now?: () => number
  /** Changes within this window go out as one push (§5.3: a change reaches the window within 1 s). */
  coalesceMs?: number
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** Grouping window for pushes: well inside the 1 s promise, wide enough to fold a burst of thread events. */
export const AGENTS_COALESCE_MS = 150

const KIND_OF_SOURCE: Record<Exclude<AgentSourceEvent['source'], 'approval'>, AgentKind> = { pane: 'pane', conversation: 'conversation', delegation: 'delegation', work: 'work' }
/** States a Stop applies to (§5.5 offers Stop only there); a Stop of anything else starts no window. */
const STOPPABLE = new Set(['working', 'needs-you'])

export class AgentsReadModel {
  private readonly now: () => number
  private readonly coalesceMs: number
  private readonly setTimer: (run: () => void, ms: number) => unknown
  private readonly clearTimer: (timer: unknown) => void
  private readonly warn: (message: string, error: unknown) => void
  private readonly panes = new Map<string, PaneAgentState>()
  private readonly stoppedPanes = new Set<string>()
  private readonly conversations = new Map<string, ConversationFacts>()
  private readonly delegations = new Map<string, DelegationTask>()
  private readonly work = new Map<string, WorkFacts>()
  private approvals: ApprovalRequest[] = []
  private approvalsDirty = false
  private readonly status: Record<AgentKind, AgentSourceStatus> = { pane: { ok: true }, conversation: { ok: true }, delegation: { ok: true }, work: { ok: true } }
  private seenAt = new Map<string, number>()
  private history = new Map<string, RowHistory>()
  private rows: AgentOverviewRow[] = []
  private sent: Record<AgentKind, string> = { pane: '', conversation: '', delegation: '', work: '' }
  private seq = 0
  private flushTimer: unknown = null
  private unsubscribe: (() => void)[] = []
  /** Items to re-read at the next flush; `true` when the source said it is gone. */
  private readonly dirty = new Map<AgentKind, Map<string, { deleted: boolean; closed: boolean }>>()
  /** Stops waiting for a report: key → when the Stop was asked, and its timer. */
  private readonly stops = new Map<string, { at: number; timer: unknown }>()
  private readonly stuck = new Set<string>()
  private readonly nudgeTimers = new Map<string, unknown>()
  private readonly nudged = new Set<string>()

  constructor(private readonly deps: AgentsReadModelDeps) {
    this.now = deps.now ?? Date.now
    this.coalesceMs = deps.coalesceMs ?? AGENTS_COALESCE_MS
    this.setTimer = deps.setTimer ?? ((run, ms) => { const timer = setTimeout(run, ms); timer.unref?.(); return timer })
    this.clearTimer = deps.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>))
    this.warn = deps.warn ?? ((message, error) => console.warn(`[agents] ${message}`, error))
  }

  /** The first read of every source, then live: from here on, only events change it. */
  start(): void {
    for (const kind of ['pane', 'conversation', 'delegation', 'work'] as const) this.readAll(kind)
    this.readApprovals()
    try { this.seenAt = this.deps.seen.all() } catch (error) { this.seenAt = new Map(); this.warn('could not read the seen marks; finished agents may show as Finished again', error) }
    this.rebuild()
    this.sent = this.statusBodies()
    this.scheduleNudges()
    this.unsubscribe = [this.deps.subscribe(event => this.onSource(event)), this.deps.subscribeStops(key => this.noteStop(key), key => this.cancelStop(key))]
  }

  stop(): void {
    for (const off of this.unsubscribe) off()
    this.unsubscribe = []
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
    const stored = this.deps.seen.mark(row.key, seenAt)
    this.seenAt.set(row.key, stored.seenAt)
    // The cap evicted these marks in the database: forget them here too, so memory and disk agree.
    for (const key of stored.evicted) this.seenAt.delete(key)
    if (row.kind === 'pane' && row.state === 'finished') this.deps.markPaneSeen(row.id)
    this.flush()
    return { ok: true, key: row.key, seenAt: stored.seenAt, state: this.rows.find(item => item.key === row.key)?.state ?? row.state }
  }

  /**
   * A Stop was asked for this agent (`thread.interrupt`, `terminal.stop`). For a working or needs-you row only: with
   * no report from its source within the no-report window, the row shows `unknown`, never "Stopping…" forever (§13).
   */
  noteStop(key: string): void {
    if (!parseAgentKey(key)) return
    const row = this.rows.find(item => item.key === key)
    if (!row || !STOPPABLE.has(row.state)) return
    this.cancelStop(key)
    const at = this.now()
    // A report cancels this timer (`refresh`), so when it fires nothing was heard since the Stop.
    const timer = this.setTimer(() => { this.stops.delete(key); this.stuck.add(key); this.safeFlush() }, this.deps.timers.noReportMs)
    this.stops.set(key, { at, timer })
  }

  /** The Stop failed: nothing was stopped, so its window ends and the row keeps what its source says. */
  cancelStop(key: string): void {
    const stop = this.stops.get(key)
    if (stop) { this.clearTimer(stop.timer); this.stops.delete(key) }
  }

  /** The window lost focus: a request already waiting long enough is nudged now (§5.10). */
  focusChanged(): void {
    this.evaluateNudges()
  }

  /** The needs-you setting changed: every waiting request's timer is set again from the new delay. */
  settingChanged(): void {
    for (const timer of this.nudgeTimers.values()) this.clearTimer(timer)
    this.nudgeTimers.clear()
    this.scheduleNudges()
  }

  private onSource(event: AgentSourceEvent): void {
    if (event.source === 'approval') this.approvalsDirty = true
    else if (event.id) {
      const kind = KIND_OF_SOURCE[event.source]
      const items = this.dirty.get(kind) ?? new Map<string, { deleted: boolean; closed: boolean }>()
      const previous = items.get(event.id)
      items.set(event.id, { deleted: (previous?.deleted ?? false) || event.deleted === true, closed: (previous?.closed ?? false) || event.closed === true })
      this.dirty.set(kind, items)
    }
    this.scheduleFlush()
  }

  /** Re-reads each dirty item once; a source that is down is re-read whole. */
  private readDirty(): void {
    if (this.approvalsDirty) { this.approvalsDirty = false; this.readApprovals() }
    for (const [kind, items] of this.dirty) {
      this.dirty.delete(kind)
      const recovering = !this.status[kind].ok
      for (const [id, { deleted, closed }] of items) this.report(kind, id, deleted, closed)
      if (recovering) { this.readAll(kind); continue }
      for (const [id, { deleted, closed }] of items) this.refresh(kind, id, deleted, closed)
    }
  }

  /** A report from the source ends the item's no-report window; a pane whose agent left inside it is Stopped. */
  private report(kind: AgentKind, id: string, deleted: boolean, closed: boolean): void {
    const key = agentKey(kind, id)
    this.stuck.delete(key)
    if (kind === 'pane') {
      if (closed) this.stoppedPanes.delete(id)
      else if (deleted && this.stops.has(key)) this.stoppedPanes.add(id)
      else if (!deleted) this.stoppedPanes.delete(id)
    }
    this.cancelStop(key)
  }

  private refresh(kind: AgentKind, id: string, deleted: boolean, closed: boolean): void {
    const key = agentKey(kind, id)
    const gone = (map: Map<string, unknown>): void => {
      map.delete(id)
      // The source is gone: its seen mark goes with it.
      this.seenAt.delete(key)
      try { this.deps.seen.delete(key) } catch (error) { this.warn(`could not delete the seen mark of ${key}`, error) }
    }
    this.read(kind, () => {
      if (kind === 'pane') {
        // A pane the person stopped keeps its last state as a Stopped row until the pane itself closes.
        if (this.stoppedPanes.has(id) && !closed) return
        const value = deleted ? null : this.deps.sources.panes.get(id)
        if (value) this.panes.set(id, value)
        else gone(this.panes)
      } else if (kind === 'conversation') {
        const value = deleted ? null : this.deps.sources.conversations.get(id)
        if (value) this.conversations.set(id, value)
        else gone(this.conversations)
      } else if (kind === 'delegation') {
        const value = deleted ? null : this.deps.sources.delegations.get(id)
        if (value) this.delegations.set(id, value)
        else gone(this.delegations)
      } else {
        const value = deleted ? null : this.deps.sources.work.get(id)
        if (value) this.work.set(id, value)
        else gone(this.work)
      }
    })
  }

  /** The whole source, replacing its cache: at start, and when a source that was down answers again. */
  private readAll(kind: AgentKind): void {
    this.read(kind, () => {
      if (kind === 'pane') this.replace(this.panes, this.deps.sources.panes.list(), pane => pane.paneId)
      else if (kind === 'conversation') this.replace(this.conversations, this.deps.sources.conversations.all(), facts => facts.thread.id)
      else if (kind === 'delegation') this.replace(this.delegations, this.deps.sources.delegations.all(), task => task.id)
      else this.replace(this.work, this.deps.sources.work.all(), facts => facts.run.id)
    })
  }

  private replace<T>(map: Map<string, T>, items: T[], id: (item: T) => string): void {
    map.clear()
    for (const item of items) map.set(id(item), item)
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
    try { this.approvals = this.deps.sources.approvals.list().filter(request => request.requester.kind === 'agent') } catch (error) { this.warn('could not read the pending approvals; rows keep the last ones read', error) }
  }

  private facts(): AgentFacts {
    let workspaces: Workspace[] = []
    try { workspaces = this.deps.sources.workspaces() } catch (error) { this.warn('could not read the workspaces; pane rows fall back to the agent name', error) }
    return { panes: this.panes, stoppedPanes: this.stoppedPanes, conversations: this.conversations, delegations: this.delegations, work: this.work, approvals: this.approvals, workspaces,
      providerOf: id => { try { return this.deps.sources.providerOf(id) } catch { return undefined } } }
  }

  private rebuild(): { upsert: AgentOverviewRow[]; removed: AgentKey[] } {
    const facts = this.facts()
    const before = new Map(this.rows.map(row => [row.key, row.rev]))
    const drafts = draftRows(facts)
    const { rows, history } = stampRows(drafts, facts, this.seenAt, this.history, this.stuck, this.now())
    this.rows = rows
    this.history = history
    const after = new Set(rows.map(row => row.key))
    // Bounded caches: a row the cap left out (or a delegation that ended) leaves the cache; its next event brings it back.
    for (const draft of drafts) {
      if (after.has(draft.key)) continue
      if (draft.kind === 'conversation') this.conversations.delete(draft.id)
      else if (draft.kind === 'delegation') this.delegations.delete(draft.id)
      else if (draft.kind === 'work') this.work.delete(draft.id)
    }
    for (const key of this.stuck) if (!after.has(key as AgentKey)) this.stuck.delete(key)
    for (const id of this.stoppedPanes) if (!this.panes.has(id)) this.stoppedPanes.delete(id)
    return { upsert: rows.filter(row => before.get(row.key) !== row.rev), removed: [...before.keys()].filter(key => !after.has(key)) as AgentKey[] }
  }

  private statusBodies(): Record<AgentKind, string> {
    return Object.fromEntries(Object.entries(this.status).map(([kind, value]) => [kind, JSON.stringify(value)])) as Record<AgentKind, string>
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return
    this.flushTimer = this.setTimer(() => { this.flushTimer = null; this.safeFlush() }, this.coalesceMs)
  }

  /** A flush from a timer: a failure is logged, never thrown into the event loop; the next event tries again. */
  private safeFlush(): void {
    try { this.flush() } catch (error) { this.warn('could not update the agents', error) }
  }

  /** Re-reads what changed, rebuilds, and pushes what changed: rows by revision, sources by value. */
  private flush(): void {
    if (this.flushTimer !== null) { this.clearTimer(this.flushTimer); this.flushTimer = null }
    this.readDirty()
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
    const now = this.now(), after = this.nudgeAfterMs()
    // Requests that come due within the batch window of the first go out with it (§5.10: "3 agents need you").
    const batches = dueNudges(this.waiting(), this.nudged, { now: now + NUDGE_BATCH_MS, nudgeAfterMs: after, focused: this.deps.focused() })
    for (const batch of batches) {
      // Only a batch whose first request is really due now; the rest wait for their own timer.
      if (after === null || now - batch[0].since < after) continue
      for (const request of batch) { this.nudged.add(request.requestId); const timer = this.nudgeTimers.get(request.requestId); if (timer) { this.clearTimer(timer); this.nudgeTimers.delete(request.requestId) } }
      const keys = new Set(batch.map(request => request.key))
      this.deps.nudge(this.rows.filter(row => keys.has(row.key)))
    }
  }
}
