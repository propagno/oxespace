/**
 * S7.1 · The agents read model for the E2E runs (docs/design/s7-mission-control.md §13, §14). No pane, conversation,
 * delegation or work run behind it: rows come from a fixture and change only when a spec drives them, through the same
 * shared rules main's runtime uses (`applyAgentsChange` on the window side, `dueNudges`, `stateAfterStop`).
 *
 * `OXESPACE_E2E_AGENTS=sample` lists the eight sample agents below; any other value is read as JSON
 * `{ rows: AgentOverviewRow[], silent?: AgentKey[], unavailable?: AgentKind[] }`. A `silent` agent never reports again:
 * after a Stop it turns `unknown` once the no-report window passes ("no stuck rows", §13); the others report `stopped`.
 * `OXESPACE_E2E_AGENTS_NEEDS_YOU_MS` and `OXESPACE_E2E_AGENTS_NO_REPORT_MS` shorten the two timers
 * (shared/agents/agentTimers.ts); a packaged build ignores all three.
 *
 * A spec drives it from the main process:
 *
 *   await app.evaluate((_electron, input) => globalThis.__oxeE2eAgents?.(input), { action: 'set', key: 'pane:p1', state: 'needs-you' })
 *
 *   set          a source report: the row's fields change, `sourceSeq` grows, `agents:changed` is pushed
 *   remove       the agent ended
 *   stop         a Stop was asked: a silent agent stays as it was, then `unknown`; another reports `stopped`
 *   unavailable  a source fails (`ok: false`) or comes back (`ok: true`)
 *   nudges       returns the needs-you nudges sent so far, one batch per notification, by request id
 *
 * The unfocused window of the needs-you timer is `BrowserWindow.blur()` in the spec.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { agentNotFound, normalizeMarkSeen } from '../../../shared/agents/agentsOverview'
import { AGENT_KINDS, AGENT_STATES, agentMode, compareAgentRows, parseAgentKey, type AgentKey, type AgentKind, type AgentState } from '../../../shared/agents/agentState'
import { agentTimersE2e, dueNudges, readAgentTimers, stateAfterStop, AGENT_TIMER_DEFAULTS, type AgentTimers } from '../../../shared/agents/agentTimers'
import { mainMessage } from '../../../shared/messages'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { AGENT_SOURCE_UNAVAILABLE_CODES, type AgentMarkSeenResult, type AgentOverviewRow, type AgentsChange, type AgentSourceStatus, type AgentsOverview } from '../../../shared/types/ipc/agents'
import { requireAppFrame } from '../ipc/ipc-guards'

export const E2E_AGENTS_GLOBAL = '__oxeE2eAgents'

export interface AgentsFixture { rows: AgentOverviewRow[]; silent: AgentKey[]; unavailable: AgentKind[] }

export type AgentsDriveInput =
  | ({ action: 'set'; key: AgentKey } & Partial<Omit<AgentOverviewRow, 'key' | 'kind' | 'id' | 'sourceSeq'>>)
  | { action: 'remove'; key: AgentKey }
  | { action: 'stop'; key: AgentKey }
  | { action: 'unavailable'; kind: AgentKind; ok: boolean }
  | { action: 'nudges' }

const row = (key: AgentKey, fields: Omit<AgentOverviewRow, 'key' | 'kind' | 'id' | 'mode' | 'seen' | 'lastSeenAt' | 'sourceSeq'> & Partial<AgentOverviewRow>): AgentOverviewRow => {
  const { kind, id } = parseAgentKey(key)!
  return { key, kind, id, mode: agentMode(kind), seen: false, lastSeenAt: null, sourceSeq: 1, ...fields }
}

/** Eight agents across modes (the S7 exit check): every state, a delegation nested under a conversation, a work run. */
export function sampleAgents(now: number): AgentOverviewRow[] {
  return [
    row('pane:p1', { workspaceId: 'w1', state: 'needs-you', since: now - 30_000, title: 'Claude · api', provider: 'claude',
      pendingRequest: { via: 'approval', id: 'approval-1', title: mainMessage('approvals.title.agent', {}), risk: 'high', since: now - 30_000, more: 1 } }),
    row('conversation:t1', { workspaceId: 'w1', state: 'needs-you', since: now - 10_000, title: 'Refactor the importer', provider: 'codex', mode: 'thread',
      pendingRequest: { via: 'thread', id: 'request-1', threadId: 't1', title: mainMessage('agents.request.approval', {}), risk: 'medium', since: now - 10_000, more: 0 },
      cost: { usd: 0.42, estimated: false } }),
    row('conversation:t2', { workspaceId: 'w1', state: 'failed', since: now - 120_000, title: 'Fix the flaky test', provider: 'claude', cost: { usd: 1.1, estimated: false } }),
    row('pane:p2', { workspaceId: 'w2', state: 'idle', since: now - 300_000, title: 'Codex · web', provider: 'codex', seen: true, lastSeenAt: now - 290_000 }),
    row('delegation:d1', { workspaceId: 'w1', state: 'working', waitingForLead: true, since: now - 60_000, title: 'Write the migration', provider: 'claude', parentKey: 'conversation:t1',
      worktree: { path: 'C:/repo-wt/d1', branch: 'feat/migration' } }),
    row('work:r1', { workspaceId: 'w2', state: 'finished', since: now - 20_000, title: 'Audit the copy', provider: 'claude', mode: 'thread', tasks: { done: 5, total: 5 }, cost: { usd: 1.58, estimated: true } }),
    row('conversation:t3', { workspaceId: 'w2', state: 'stopped', since: now - 600_000, title: 'Draft the release notes', provider: 'codex' }),
    row('pane:p3', { workspaceId: 'w2', state: 'unknown', since: now - 5_000, title: 'Claude · docs', provider: 'claude' })
  ]
}

/** The fixture of `OXESPACE_E2E_AGENTS`, or null when unset. Rows with an unknown key or state are dropped. */
export function readAgentsFixture(raw: string | undefined, now: number): AgentsFixture | null {
  if (!raw) return null
  if (raw === 'sample') return { rows: sampleAgents(now), silent: ['delegation:d1'], unavailable: [] }
  const parsed = JSON.parse(raw) as Partial<AgentsFixture>
  const rows = (parsed.rows ?? []).filter(item => parseAgentKey(item?.key) && (AGENT_STATES as readonly string[]).includes(item.state))
  return {
    rows: rows.map(item => ({ ...item, ...parseAgentKey(item.key)! })),
    silent: (parsed.silent ?? []).filter(key => parseAgentKey(key)) as AgentKey[],
    unavailable: (parsed.unavailable ?? []).filter(kind => (AGENT_KINDS as readonly string[]).includes(kind))
  }
}

export interface AgentsDoubleOptions {
  fixture: AgentsFixture
  timers: AgentTimers
  now: () => number
  publish: (change: AgentsChange) => void
  focused: () => boolean
  /** Runs `run` after `ms`; the window's timers in the app, a manual queue in unit tests. */
  after: (ms: number, run: () => void) => void
  nudgeAfterMs?: number | null
}

/** The double itself, without Electron, so its rules are unit-tested. `tick` runs the two timers once. */
export function createAgentsDouble(options: AgentsDoubleOptions) {
  const rows = new Map(options.fixture.rows.map(item => [item.key, structuredClone(item)]))
  const silent = new Set(options.fixture.silent)
  const sources = Object.fromEntries(AGENT_KINDS.map(kind => [kind, statusOf(kind, !options.fixture.unavailable.includes(kind))])) as Record<AgentKind, AgentSourceStatus>
  const lastReportAt = new Map<AgentKey, number>([...rows.keys()].map(key => [key, options.now()]))
  const stops = new Map<AgentKey, { at: number; reported: AgentState }>()
  const notified = new Set<string>()
  const nudges: string[][] = []
  let seq = 0

  function statusOf(kind: AgentKind, ok: boolean): AgentSourceStatus {
    return ok ? { ok: true } : { ok: false, message: mainMessage(AGENT_SOURCE_UNAVAILABLE_CODES[kind], {}) }
  }
  const push = (change: Omit<AgentsChange, 'seq'>): void => options.publish({ seq: ++seq, ...change })
  const update = (key: AgentKey, fields: Partial<AgentOverviewRow>, report: boolean): AgentOverviewRow | null => {
    const current = rows.get(key)
    if (!current) return null
    const next: AgentOverviewRow = { ...current, ...fields, key: current.key, kind: current.kind, id: current.id, sourceSeq: current.sourceSeq + 1 }
    if (fields.state && fields.state !== current.state && fields.since === undefined) next.since = options.now()
    rows.set(key, next)
    if (report) { lastReportAt.set(key, options.now()); stops.delete(key) }
    push({ upsert: [next] })
    return next
  }

  return {
    overview(): AgentsOverview {
      return structuredClone({ rows: [...rows.values()].sort(compareAgentRows), sources, seq })
    },
    markSeen(input: unknown): AgentMarkSeenResult {
      const checked = normalizeMarkSeen(input)
      if (!checked.ok) return checked
      const current = rows.get(checked.key)
      if (!current) return agentNotFound()
      const seenAt = Math.max(options.now(), current.lastSeenAt ?? 0)
      const next = update(checked.key, { seen: true, lastSeenAt: seenAt, ...(current.state === 'finished' ? { state: 'idle' as const } : {}) }, false)!
      return { ok: true, key: checked.key, seenAt, state: next.state }
    },
    drive(input: AgentsDriveInput): unknown {
      switch (input.action) {
        case 'set': {
          const { action: _action, key, ...fields } = input
          return update(key, fields, true)
        }
        case 'remove': {
          if (!rows.delete(input.key)) return false
          stops.delete(input.key)
          push({ removed: [input.key] })
          return true
        }
        case 'stop': {
          const current = rows.get(input.key)
          if (!current) return false
          stops.set(input.key, { at: options.now(), reported: current.state })
          if (!silent.has(input.key)) options.after(200, () => { if (stops.has(input.key)) update(input.key, { state: 'stopped' }, true) })
          return true
        }
        case 'unavailable': {
          sources[input.kind] = statusOf(input.kind, input.ok)
          push({ sources: { [input.kind]: sources[input.kind] } })
          return true
        }
        case 'nudges': return structuredClone(nudges)
      }
    },
    tick(): void {
      const now = options.now()
      for (const [key, stop] of stops) {
        const reported = rows.get(key)?.state ?? stop.reported
        const next = stateAfterStop(reported, { stopAt: stop.at, lastReportAt: lastReportAt.get(key) ?? 0, now, noReportMs: options.timers.noReportMs })
        if (next !== reported) { stops.delete(key); update(key, { state: next }, false) }
      }
      const waiting = [...rows.values()].filter(item => item.state === 'needs-you' && item.pendingRequest)
        .map(item => ({ key: item.key, requestId: item.pendingRequest!.id, since: item.pendingRequest!.since }))
      const nudgeAfterMs = options.nudgeAfterMs === undefined ? options.timers.needsYouMs : options.nudgeAfterMs
      for (const batch of dueNudges(waiting, notified, { now, nudgeAfterMs, focused: options.focused() })) {
        for (const request of batch) notified.add(request.requestId)
        nudges.push(batch.map(request => request.requestId))
      }
    }
  }
}

/** Registered by mock-ipc only; the handlers answer even without a fixture (an empty overview), as main will. */
export function registerAgentsMock(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): void {
  const e2e = agentTimersE2e(env, isPackaged)
  const timers = readAgentTimers(env, e2e)
  const fixture = (e2e ? readAgentsFixture(env.OXESPACE_E2E_AGENTS, Date.now()) : null) ?? { rows: [], silent: [], unavailable: [] }
  const double = createAgentsDouble({
    fixture,
    timers,
    now: Date.now,
    publish: change => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agents.changed, change) },
    focused: () => BrowserWindow.getFocusedWindow() !== null,
    after: (ms, run) => { setTimeout(run, ms) }
  })
  ipcMain.handle(IPC_CHANNELS.agents.overview, event => { requireAppFrame(event, 'Agents'); return double.overview() })
  ipcMain.handle(IPC_CHANNELS.agents.markSeen, (event, input: unknown) => { requireAppFrame(event, 'Agents'); return double.markSeen(input) })
  if (!e2e || fixture.rows.length === 0) return
  ;(globalThis as Record<string, unknown>)[E2E_AGENTS_GLOBAL] = (input: AgentsDriveInput) => double.drive(input)
  const every = Math.max(50, Math.min(timers.needsYouMs, timers.noReportMs, AGENT_TIMER_DEFAULTS.noReportMs) / 4)
  setInterval(() => double.tick(), every).unref()
}
