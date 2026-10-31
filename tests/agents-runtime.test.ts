// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } },
  BrowserWindow: { fromWebContents: () => ({}), getAllWindows: () => [], getFocusedWindow: () => null }
}))

import { registerAgentsIpc } from '../electron/main/ipc/agents.ipc'
import { draftRows, stampRows, type AgentFacts, type ConversationFacts, type WorkFacts } from '../electron/main/services/agents/agent-rows'
import { AGENTS_COALESCE_MS, AgentsReadModel, type AgentSources } from '../electron/main/services/agents/read-model'
import { onRemoteAgentsResnapshot, remoteAgentsEvents, remoteAgentsSnapshot, requestRemoteAgentsResnapshot } from '../electron/main/services/agents/remote-seam'
import { nudgeNotice } from '../electron/main/services/agents/nudge-notice'
import { paneToneState } from '../shared/agents/agentState'
import { notifyAgentSource, notifyAgentStop, notifyAgentStopFailed, onAgentSource, onAgentStop, onAgentStopFailed, type AgentSourceEvent } from '../electron/main/services/agents/source-events'
import { applyAgentsChange } from '../shared/agents/agentsOverview'
import { IPC_CHANNELS } from '../shared/types/ipc'
import type { PaneAgentState } from '../shared/types/agent-state'
import type { ApprovalRequest } from '../shared/types/approvals'
import type { DelegationTask } from '../shared/types/delegation'
import type { AgentOverviewRow, AgentsChange, AgentsOverview } from '../shared/types/ipc/agents'
import type { ConversationThread, ThreadRequest } from '../shared/types/thread'
import type { Workspace } from '../shared/types/workspace'

const T0 = 1_800_000_000_000
const NEEDS_YOU_MS = 120_000
const NO_REPORT_MS = 10_000

const pane = (paneId: string, fields: Partial<PaneAgentState> = {}): PaneAgentState => ({ paneId, workspaceId: 'w1', agent: 'claude', state: 'working', source: 'hook', seen: false, since: T0, stateChangeSeq: 1, completionSeq: 0, ...fields })
const thread = (id: string, fields: Partial<ConversationThread> = {}): ConversationThread => ({ id, workspaceId: 'w1', projectId: 'p', rootPath: 'C:/repo', provider: 'claude', nativeSessionId: null, title: `Talk ${id}`, pinned: false, status: 'idle', createdAt: T0, updatedAt: T0, ...fields }) as ConversationThread
const request = (id: string, createdAt = T0, kind: ThreadRequest['kind'] = 'approval'): ThreadRequest => ({ id, nativeId: id, nativeMethod: 'x', kind, title: 'agent text', generation: 1, createdAt, state: 'pending' }) as unknown as ThreadRequest
const delegation = (id: string, fields: Partial<DelegationTask> = {}): DelegationTask => ({ id, workspaceId: 'w1', objective: `Do ${id}`, state: 'accepted', agentProfileId: 'prof', updatedAt: T0, surface: 'terminal', originPaneId: 'origin', path: '', branch: '', ...fields }) as DelegationTask
const approval = (id: string, requesterId: string, fields: Partial<ApprovalRequest> = {}): ApprovalRequest => ({ id, requester: { kind: 'agent', id: requesterId, label: { code: 'approvals.requester.app', params: {} } }, risk: 'high', title: { code: 'approvals.title.oxequery', params: {} }, createdAt: T0, ...fields }) as unknown as ApprovalRequest
const run = (id: string, supervisor: string, status: WorkFacts['run']['status'], tasks: WorkFacts['tasks'] = []): WorkFacts => ({ run: { id, supervisorThreadId: supervisor, workspaceId: 'w1', title: `Run ${id}`, status, updatedAt: T0 }, tasks })

/** Mutable sources the tests change, then announce with notifyAgentSource, as the real emitters do. */
function world() {
  const state = {
    panes: new Map<string, PaneAgentState>(),
    conversations: new Map<string, ConversationFacts>(),
    delegations: new Map<string, DelegationTask>(),
    work: new Map<string, WorkFacts>(),
    approvals: [] as ApprovalRequest[],
    workspaces: [{ id: 'w1', panes: [{ id: 'p1', displayName: 'API' }] }] as unknown as Workspace[],
    failing: new Set<string>()
  }
  const guard = <T>(source: string, run: () => T): T => { if (state.failing.has(source)) throw new Error(`${source} down`); return run() }
  const sources: AgentSources = {
    panes: { list: () => guard('pane', () => [...state.panes.values()]), get: id => guard('pane', () => state.panes.get(id) ?? null) },
    conversations: { all: () => guard('conversation', () => [...state.conversations.values()]), get: id => guard('conversation', () => state.conversations.get(id) ?? null) },
    delegations: { all: () => guard('delegation', () => [...state.delegations.values()]), get: id => guard('delegation', () => state.delegations.get(id) ?? null) },
    work: { all: () => guard('work', () => [...state.work.values()]), get: id => guard('work', () => state.work.get(id) ?? null) },
    approvals: { list: () => state.approvals },
    workspaces: () => state.workspaces,
    providerOf: id => (id === 'prof' ? 'codex' : undefined)
  }
  return { state, sources }
}

function model(options: { focused?: boolean; nudgeAfterMs?: number | null } = {}) {
  const { state, sources } = world()
  const marks = new Map<string, number>()
  const evict: string[] = []
  const warn = vi.fn()
  const seen = { all: () => new Map(marks), mark: vi.fn((key: string, at: number) => { marks.set(key, Math.max(marks.get(key) ?? 0, at)); return { seenAt: marks.get(key)!, evicted: [...evict.splice(0)] } }), delete: vi.fn((key: string) => { marks.delete(key) }) }
  const changes: AgentsChange[] = []
  const nudges: string[][] = []
  const focus = { value: options.focused ?? false }
  const publishFails = { value: false }
  const setting = { value: options.nudgeAfterMs === undefined ? NEEDS_YOU_MS as number | null : options.nudgeAfterMs }
  const paneSeen = vi.fn((paneId: string) => { const current = state.panes.get(paneId); if (current) { state.panes.set(paneId, { ...current, seen: true }); notifyAgentSource({ source: 'pane', id: paneId }) } })
  const readModel = new AgentsReadModel({
    sources, seen, subscribe: onAgentSource, subscribeStops: (listener, failed) => { const offs = [onAgentStop(listener), onAgentStopFailed(failed)]; return () => { for (const off of offs) off() } },
    publish: change => { if (publishFails.value) throw new Error('window gone'); changes.push(change) }, warn, nudge: rows => nudges.push(rows.map(row => row.pendingRequest!.id)),
    focused: () => focus.value, markPaneSeen: paneSeen, timers: { needsYouMs: NEEDS_YOU_MS, noReportMs: NO_REPORT_MS },
    nudgeAfterMs: () => setting.value
  })
  return { readModel, state, marks, evict, warn, publishFails, setting, seen, changes, nudges, focus, paneSeen, row: (key: string) => readModel.overview().rows.find(item => item.key === key) }
}

const stop: (() => void)[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); handlers.clear() })
afterEach(() => { for (const end of stop.splice(0)) end(); vi.useRealTimers() })
const started = (options?: Parameters<typeof model>[0], setup?: (m: ReturnType<typeof model>) => void) => {
  const m = model(options)
  setup?.(m)
  m.readModel.start()
  stop.push(() => m.readModel.stop())
  return m
}

describe('S7.1 runtime · aggregation per source', () => {
  it('maps a pane from its lifecycle, named after its pane', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1', { state: 'blocked' })) })
    expect(m.row('pane:p1')).toMatchObject({ kind: 'pane', state: 'needs-you', title: 'API', provider: 'claude', mode: 'code', rev: 1 })
  })

  it('maps a conversation with its first pending request, a main-built title and its lifetime cost', () => {
    const m = started({}, ({ state }) => {
      state.conversations.set('t1', { thread: thread('t1', { status: 'approval', costReport: { totalUsd: 1.5, turns: 3, updatedAt: T0, source: 'claude-result-step' } }), requests: [request('r2', T0 + 5, 'question'), request('r1', T0)] })
    })
    expect(m.row('conversation:t1')).toMatchObject({
      state: 'needs-you', cost: { usd: 1.5, estimated: false }, mode: 'thread',
      pendingRequest: { via: 'thread', id: 'r1', threadId: 't1', title: { code: 'agents.request.approval', params: {} }, since: T0, more: 1 }
    })
    expect(JSON.stringify(m.row('conversation:t1'))).not.toContain('agent text')
  })

  it('makes a pane with a B10 approval need the person, with the approval\'s risk and parameterless title', () => {
    const m = started({}, ({ state }) => {
      state.panes.set('p1', pane('p1', { state: 'working' }))
      state.approvals = [approval('a1', 'pane:p1'), approval('a2', 'pane:p1', { title: { code: 'approvals.summary.mcpConfirm', params: { tool: 't', action: 'a', target: 'x' } } as never, createdAt: T0 + 1 }), approval('mcp', 'server-x', { requester: { kind: 'mcp-server', id: 'srv', label: { code: 'approvals.requester.app', params: {} } } } as never)]
    })
    expect(m.row('pane:p1')).toMatchObject({ state: 'needs-you', pendingRequest: { via: 'approval', id: 'a1', risk: 'high', title: { code: 'approvals.title.oxequery' }, more: 1 } })
  })

  it('maps delegations by who asked: from the window it needs the person, from an agent it waits on its lead', () => {
    const m = started({}, ({ state }) => {
      state.delegations.set('d1', delegation('d1', { state: 'blocked', requestedBy: 'person' }))
      state.delegations.set('d2', delegation('d2', { state: 'review' }))
    })
    expect(m.row('delegation:d1')).toMatchObject({ state: 'needs-you', provider: 'codex', mode: 'code' })
    expect(m.row('delegation:d2')).toMatchObject({ state: 'working', waitingForLead: true })
  })

  it('maps an Agent Work run with its task count, under its supervising conversation', () => {
    const m = started({}, ({ state }) => {
      state.work.set('r1', run('r1', 't9', 'running', [{ status: 'succeeded', threadId: 'w1' }, { status: 'running', threadId: 'w2' }, { status: 'pending', threadId: null }]))
    })
    expect(m.row('work:r1')).toMatchObject({ state: 'working', tasks: { done: 1, total: 3 }, parentKey: 'conversation:t9' })
  })
})

describe('S7.1 runtime · one owner per agent', () => {
  it('hides a delegation\'s destination, shows its request on the delegation row, and nests workers under their run', () => {
    const m = started({}, ({ state }) => {
      state.panes.set('dest', pane('dest', { state: 'blocked' }))
      state.approvals = [approval('a1', 'pane:dest')]
      state.delegations.set('d1', delegation('d1', { paneId: 'dest', state: 'accepted' }))
      state.conversations.set('w1', { thread: thread('w1', { status: 'running' }), requests: [] })
      state.work.set('r1', run('r1', 't9', 'running', [{ status: 'running', threadId: 'w1' }]))
    })
    const keys = m.readModel.overview().rows.map(row => row.key)
    expect(keys).not.toContain('pane:dest')
    expect(m.row('delegation:d1')).toMatchObject({ state: 'needs-you', pendingRequest: { id: 'a1' } })
    expect(m.row('conversation:w1')).toMatchObject({ parentKey: 'work:r1' })
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('S7.1 runtime · pushes: grouped, within 1 s, only real changes, rev per row', () => {
  it('groups a burst of events into one push after the coalescing window, well within 1 s', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1')) })
    m.state.panes.set('p1', pane('p1', { state: 'blocked', stateChangeSeq: 2 }))
    notifyAgentSource({ source: 'pane', id: 'p1' })
    m.state.conversations.set('t1', { thread: thread('t1', { status: 'running' }), requests: [] })
    notifyAgentSource({ source: 'conversation', id: 't1' })
    expect(m.changes).toHaveLength(0)
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(AGENTS_COALESCE_MS).toBeLessThan(1_000)
    expect(m.changes).toHaveLength(1)
    expect(m.changes[0]).toMatchObject({ seq: 1, upsert: [expect.objectContaining({ key: 'pane:p1', state: 'needs-you', rev: 2 }), expect.objectContaining({ key: 'conversation:t1', rev: 1 })] })
  })

  it('sends nothing when an event changes no row', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1')) })
    notifyAgentSource({ source: 'pane', id: 'p1' })
    vi.advanceTimersByTime(1_000)
    expect(m.changes).toEqual([])
  })

  it('applies on the window: the overview plus each change equals the model', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1')) })
    let window: AgentsOverview = m.readModel.overview()
    m.state.panes.set('p1', pane('p1', { state: 'done', stateChangeSeq: 2 }))
    notifyAgentSource({ source: 'pane', id: 'p1' })
    vi.advanceTimersByTime(1_000)
    for (const change of m.changes) { const applied = applyAgentsChange(window, change); expect(applied.ok).toBe(true); if (applied.ok) window = applied.overview }
    expect(window).toEqual(m.readModel.overview())
  })

  it('removes a row whose source is gone, and deletes its seen mark', () => {
    const m = started({}, ({ state, marks }) => { state.conversations.set('t1', { thread: thread('t1'), requests: [] }); marks.set('conversation:t1', T0) })
    m.state.conversations.delete('t1')
    notifyAgentSource({ source: 'conversation', id: 't1', deleted: true })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.changes.at(-1)?.removed).toEqual(['conversation:t1'])
    expect(m.seen.delete).toHaveBeenCalledWith('conversation:t1')
    expect(m.marks.has('conversation:t1')).toBe(false)
  })

  it('removes a closed pane\'s row and mark when its agent leaves', () => {
    const m = started({}, ({ state, marks }) => { state.panes.set('p1', pane('p1')); marks.set('pane:p1', T0) })
    m.state.panes.delete('p1')
    notifyAgentSource({ source: 'pane', id: 'p1', deleted: true })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.changes.at(-1)?.removed).toEqual(['pane:p1'])
    expect(m.seen.delete).toHaveBeenCalledWith('pane:p1')
  })
})

describe('S7.1 runtime · each source answers separately', () => {
  it('marks a failing source with its C3 code, keeps the others, and reports its recovery', () => {
    const m = started({}, ({ state }) => { state.failing.add('delegation'); state.panes.set('p1', pane('p1')) })
    expect(m.readModel.overview().sources).toEqual({ pane: { ok: true }, conversation: { ok: true }, delegation: { ok: false, message: { code: 'agents.unavailable.delegation', params: {} } }, work: { ok: true } })
    expect(m.row('pane:p1')).toBeDefined()
    m.state.failing.delete('delegation')
    m.state.delegations.set('d1', delegation('d1'))
    notifyAgentSource({ source: 'delegation', id: 'd1' })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.changes.at(-1)).toMatchObject({ sources: { delegation: { ok: true } }, upsert: [expect.objectContaining({ key: 'delegation:d1' })] })
  })
})

describe('S7.1 runtime · seen', () => {
  const finishedConversation = (m: ReturnType<typeof model>) => {
    m.state.conversations.set('t1', { thread: thread('t1', { status: 'running' }), requests: [] })
  }

  it('shows a turn that finished as Finished until the person looks; the mark is stored and the row turns Idle with a new rev', () => {
    const m = started({}, finishedConversation)
    vi.setSystemTime(T0 + 5_000)
    m.state.conversations.set('t1', { thread: thread('t1', { status: 'idle', lastTurnStatus: 'completed', updatedAt: T0 + 5_000 }), requests: [] })
    notifyAgentSource({ source: 'conversation', id: 't1' })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    const finished = m.row('conversation:t1')!
    expect(finished).toMatchObject({ state: 'finished', seen: false })
    vi.setSystemTime(T0 + 9_000)
    expect(m.readModel.markSeen({ key: 'conversation:t1' })).toEqual({ ok: true, key: 'conversation:t1', seenAt: T0 + 9_000, state: 'idle' })
    expect(m.marks.get('conversation:t1')).toBe(T0 + 9_000)
    // ARCHITECT H1: the source did not change, the row did, so its revision grows and the window applies it.
    expect(m.changes.at(-1)?.upsert?.[0]).toMatchObject({ key: 'conversation:t1', state: 'idle', seen: true, rev: finished.rev + 1 })
  })

  it('keeps a newer finish Finished when the mark comes from an older view (observedSince)', () => {
    const m = started({}, finishedConversation)
    vi.setSystemTime(T0 + 5_000)
    m.state.conversations.set('t1', { thread: thread('t1', { status: 'idle', lastTurnStatus: 'completed' }), requests: [] })
    notifyAgentSource({ source: 'conversation', id: 't1' })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    vi.setSystemTime(T0 + 9_000)
    expect(m.readModel.markSeen({ key: 'conversation:t1', observedSince: T0 })).toMatchObject({ ok: true, state: 'finished', seenAt: T0 })
  })

  it('survives a restart: a stored mark after the finish makes it Idle, one before leaves it Finished', () => {
    const seenAfter = started({}, ({ state, marks }) => { state.conversations.set('t1', { thread: thread('t1', { lastTurnStatus: 'completed', updatedAt: T0 }), requests: [] }); marks.set('conversation:t1', T0 + 1) })
    expect(seenAfter.row('conversation:t1')?.state).toBe('idle')
    const seenBefore = started({}, ({ state, marks }) => { state.conversations.set('t1', { thread: thread('t1', { lastTurnStatus: 'completed', updatedAt: T0 }), requests: [] }); marks.set('conversation:t1', T0 - 1) })
    expect(seenBefore.row('conversation:t1')?.state).toBe('finished')
  })

  it('marks a pane through the agent-state service too, and refuses an unknown or bad key', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1', { state: 'done' })) })
    expect(m.row('pane:p1')?.state).toBe('finished')
    expect(m.readModel.markSeen({ key: 'pane:p1' })).toMatchObject({ ok: true, state: 'idle' })
    expect(m.paneSeen).toHaveBeenCalledWith('p1')
    expect(m.readModel.markSeen({ key: 'pane:nope' })).toMatchObject({ ok: false, refusal: 'notFound' })
    expect(m.readModel.markSeen({ key: 'nope' })).toMatchObject({ ok: false, refusal: 'invalid' })
  })

  it('ends an approved delegation once seen', () => {
    const m = started({}, ({ state }) => { state.delegations.set('d1', delegation('d1', { state: 'approved' })) })
    expect(m.row('delegation:d1')?.state).toBe('finished')
    m.readModel.markSeen({ key: 'delegation:d1' })
    expect(m.row('delegation:d1')).toBeUndefined()
    expect(m.changes.at(-1)?.removed).toEqual(['delegation:d1'])
  })
})

describe('S7.1 runtime · timers, one per row, never polled', () => {
  const waiting = (m: ReturnType<typeof model>) => { m.state.panes.set('p1', pane('p1')); m.state.approvals = [approval('a1', 'pane:p1')] }

  it('nudges once when a request has waited the needs-you time with no window focused', () => {
    const m = started({}, waiting)
    vi.advanceTimersByTime(NEEDS_YOU_MS - 1)
    expect(m.nudges).toEqual([])
    vi.advanceTimersByTime(1)
    expect(m.nudges).toEqual([['a1']])
    vi.advanceTimersByTime(10 * NEEDS_YOU_MS)
    expect(m.nudges).toEqual([['a1']])
  })

  it('waits while a window is focused, and nudges when it loses focus', () => {
    const m = started({ focused: true }, waiting)
    vi.advanceTimersByTime(NEEDS_YOU_MS + 5_000)
    expect(m.nudges).toEqual([])
    m.focus.value = false
    m.readModel.focusChanged()
    expect(m.nudges).toEqual([['a1']])
  })

  it('batches requests that come due within 10 s of each other, and never nudges when the setting is off', () => {
    const m = started({}, ({ state }) => {
      state.panes.set('p1', pane('p1')); state.panes.set('p2', pane('p2')); state.panes.set('p3', pane('p3'))
      state.approvals = [approval('a1', 'pane:p1'), approval('a2', 'pane:p2', { createdAt: T0 + 4_000 }), approval('a3', 'pane:p3', { createdAt: T0 + 30_000 })]
    })
    vi.advanceTimersByTime(NEEDS_YOU_MS + 30_000)
    expect(m.nudges).toEqual([['a1', 'a2'], ['a3']])
    const off = started({ nudgeAfterMs: null }, waiting)
    vi.advanceTimersByTime(10 * NEEDS_YOU_MS)
    expect(off.nudges).toEqual([])
  })

  it('drops the timer of a request that stops waiting', () => {
    const m = started({}, waiting)
    m.state.approvals = []
    notifyAgentSource({ source: 'approval' })
    vi.advanceTimersByTime(NEEDS_YOU_MS * 2)
    expect(m.nudges).toEqual([])
  })

  it('shows a stopped agent with no report as Not confirmed after the no-report window, never stuck', () => {
    const m = started({}, ({ state }) => { state.conversations.set('t1', { thread: thread('t1', { status: 'running' }), requests: [] }) })
    notifyAgentStop('conversation:t1')
    vi.advanceTimersByTime(NO_REPORT_MS - 1)
    expect(m.row('conversation:t1')?.state).toBe('working')
    vi.advanceTimersByTime(1)
    expect(m.row('conversation:t1')?.state).toBe('unknown')
    expect(m.changes.at(-1)?.upsert?.[0]).toMatchObject({ key: 'conversation:t1', state: 'unknown' })
    // A report afterwards takes over again.
    m.state.conversations.set('t1', { thread: thread('t1', { status: 'interrupted' }), requests: [] })
    notifyAgentSource({ source: 'conversation', id: 't1' })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.row('conversation:t1')?.state).toBe('stopped')
  })

  it('keeps the reported state when the source answers the Stop in time', () => {
    const m = started({}, ({ state }) => { state.conversations.set('t1', { thread: thread('t1', { status: 'running' }), requests: [] }) })
    notifyAgentStop('conversation:t1')
    vi.advanceTimersByTime(2_000)
    m.state.conversations.set('t1', { thread: thread('t1', { status: 'interrupted' }), requests: [] })
    notifyAgentSource({ source: 'conversation', id: 't1' })
    vi.advanceTimersByTime(NO_REPORT_MS * 2)
    expect(m.row('conversation:t1')?.state).toBe('stopped')
  })
})

describe('S7.1 runtime · rows (pure)', () => {
  it('raises rev only when the row\'s content changes', () => {
    const facts: AgentFacts = { panes: new Map([['p1', pane('p1')]]), conversations: new Map(), delegations: new Map(), work: new Map(), approvals: [], workspaces: [], providerOf: () => undefined }
    const first = stampRows(draftRows(facts), facts, new Map(), new Map(), new Set(), T0)
    const same = stampRows(draftRows(facts), facts, new Map(), first.history, new Set(), T0 + 1)
    expect(same.rows[0].rev).toBe(first.rows[0].rev)
    const stuck = stampRows(draftRows(facts), facts, new Map(), first.history, new Set(['pane:p1']), T0 + 2)
    expect(stuck.rows[0]).toMatchObject({ state: 'unknown', rev: first.rows[0].rev + 1, since: T0 + 2 })
  })
})

describe('S7.1 runtime · source events and IPC', () => {
  it('delivers source and stop notifications, and survives a failing listener', () => {
    const seen: AgentSourceEvent[] = [], stops: string[] = []
    const offs = [onAgentSource(() => { throw new Error('boom') }), onAgentSource(event => seen.push(event)), onAgentStop(key => stops.push(key))]
    notifyAgentSource({ source: 'work', id: 'r1' })
    notifyAgentStop('pane:p1')
    for (const off of offs) off()
    notifyAgentSource({ source: 'work', id: 'r2' })
    expect(seen).toEqual([{ source: 'work', id: 'r1' }])
    expect(stops).toEqual(['pane:p1'])
  })

  it('registers both handlers behind the frame check and loads the model only on the first call', async () => {
    const load = vi.fn(async () => ({ overview: () => ({ rows: [], sources: {}, seq: 0 }) as unknown as AgentsOverview, markSeen: () => ({ ok: true }) as never }))
    const sender = vi.fn()
    registerAgentsIpc({ model: load, sender, nudge: { get: async () => ({ afterMs: 120_000 }), set: async afterMs => ({ afterMs: afterMs as 60_000 }) } })
    expect(load).not.toHaveBeenCalled()
    await handlers.get(IPC_CHANNELS.agents.overview)!({})
    await handlers.get(IPC_CHANNELS.agents.markSeen)!({}, { key: 'pane:p1' })
    expect(sender).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(2)
    sender.mockImplementation(() => { throw new Error('Agents requires the application main frame') })
    await expect(handlers.get(IPC_CHANNELS.agents.overview)!({})).rejects.toThrow(/main frame/)
  })
})

describe('S7.1 runtime · the C5 seam (wired with #204)', () => {
  it('builds phone pages and events only through the required cleaner', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1')); state.approvals = [approval('a1', 'pane:p1')] })
    const clean = vi.fn((text: string) => text.replace('API', '[clean]'))
    const deps = { clean, workspaceName: (row: AgentOverviewRow) => `ws-${row.workspaceId}`, requestTitle: () => 'Wants to run an action', requestAnswerable: () => false, canInterrupt: () => false }
    const [page] = remoteAgentsSnapshot(m.readModel.overview(), deps, 120_000)
    expect(clean).toHaveBeenCalledWith('API')
    expect(clean).toHaveBeenCalledWith('ws-w1')
    expect(clean).toHaveBeenCalledWith('Wants to run an action')
    expect(page).toMatchObject({ agents: [{ id: 'pane:p1', title: '[clean]', request: { requestId: 'a1', answerable: false, risk: 'high' } }], nudgeAfterMs: 120_000 })
    m.state.failing.add('work')
    const events = remoteAgentsEvents({ seq: 1, sources: { work: { ok: false, message: { code: 'agents.unavailable.work', params: {} } } } }, { ...m.readModel.overview(), sources: { ...m.readModel.overview().sources, work: { ok: false, message: { code: 'agents.unavailable.work', params: {} } } } }, deps)
    expect(events).toEqual([{ unavailable: ['work'] }])
  })
})

describe('S7.1 runtime · after the ARCHITECT review of #356', () => {
  it('hides a delegation destination as soon as the delegation is saved with it (no double row while it starts)', () => {
    const m = started({}, ({ state }) => { state.delegations.set('d1', delegation('d1', { state: 'starting' })) })
    m.state.panes.set('dest', pane('dest'))
    m.state.delegations.set('d1', delegation('d1', { state: 'starting', paneId: 'dest' }))
    notifyAgentSource({ source: 'pane', id: 'dest' })
    notifyAgentSource({ source: 'delegation', id: 'd1' })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.readModel.overview().rows.map(row => row.key)).toEqual(['delegation:d1'])
    expect(m.changes.flatMap(change => change.upsert ?? []).map(row => row.key)).not.toContain('pane:dest')
  })

  it('has the delegation service notify on every save, not only on its events', async () => {
    const { DelegationApplicationService } = await import('../electron/main/services/delegation/delegation-application.service')
    const events: AgentSourceEvent[] = []
    const off = onAgentSource(event => events.push(event))
    const save = vi.fn()
    ;(DelegationApplicationService.prototype as unknown as { save(task: unknown): void }).save.call({ repository: { save } }, { id: 'd1' })
    off()
    expect(save).toHaveBeenCalledWith({ id: 'd1' })
    expect(events).toEqual([{ source: 'delegation', id: 'd1' }])
  })

  it('re-reads one item once per flush, however many events it gets', () => {
    const m = started({}, ({ state }) => { state.conversations.set('t1', { thread: thread('t1'), requests: [] }) })
    const get = vi.spyOn(m.readModel['deps'].sources.conversations, 'get')
    for (let index = 0; index < 20; index += 1) notifyAgentSource({ source: 'conversation', id: 't1' })
    expect(get).not.toHaveBeenCalled()
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('starts no no-report window for a Stop of an idle row, and ends it when the Stop fails', () => {
    const m = started({}, ({ state }) => {
      state.conversations.set('idle', { thread: thread('idle', { status: 'idle' }), requests: [] })
      state.conversations.set('busy', { thread: thread('busy', { status: 'running' }), requests: [] })
    })
    notifyAgentStop('conversation:idle')
    notifyAgentStop('conversation:busy')
    notifyAgentStopFailed('conversation:busy')
    vi.advanceTimersByTime(NO_REPORT_MS * 3)
    expect(m.row('conversation:idle')?.state).toBe('idle')
    expect(m.row('conversation:busy')?.state).toBe('working')
  })

  it('re-reads the whole source when it answers again after being down, so it is never OK with a partial cache', () => {
    const m = started({}, ({ state }) => {
      state.failing.add('conversation')
      state.conversations.set('t1', { thread: thread('t1'), requests: [] })
      state.conversations.set('t2', { thread: thread('t2', { status: 'running' }), requests: [] })
    })
    expect(m.readModel.overview().sources.conversation.ok).toBe(false)
    m.state.failing.delete('conversation')
    notifyAgentSource({ source: 'conversation', id: 't1' })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.readModel.overview().sources.conversation).toEqual({ ok: true })
    expect(m.readModel.overview().rows.map(row => row.key).sort()).toEqual(['conversation:t1', 'conversation:t2'])
  })

  it('keeps a pane the person stopped as Stopped while the pane exists, the renderer\'s word too, and ends it when the pane closes', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1', { state: 'working' })) })
    notifyAgentStop('pane:p1')
    m.state.panes.delete('p1')
    notifyAgentSource({ source: 'pane', id: 'p1', deleted: true })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.row('pane:p1')?.state).toBe('stopped')
    // One vocabulary: the desktop tone path says the same for an exited pane the person stopped.
    expect(paneToneState('exited', { seen: false, stoppedByPerson: true })).toEqual({ ended: false, state: 'stopped' })
    vi.advanceTimersByTime(NO_REPORT_MS * 2)
    expect(m.row('pane:p1')?.state).toBe('stopped')
    notifyAgentSource({ source: 'pane', id: 'p1', deleted: true, closed: true })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.row('pane:p1')).toBeUndefined()
  })

  it('still ends a pane row at once when its agent leaves without a Stop', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1')) })
    m.state.panes.delete('p1')
    notifyAgentSource({ source: 'pane', id: 'p1', deleted: true })
    vi.advanceTimersByTime(AGENTS_COALESCE_MS)
    expect(m.row('pane:p1')).toBeUndefined()
  })

  it('reschedules the nudge when the setting changes', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1')); state.approvals = [approval('a1', 'pane:p1')] })
    vi.advanceTimersByTime(30_000)
    m.setting.value = 60_000
    m.readModel.settingChanged()
    vi.advanceTimersByTime(29_999)
    expect(m.nudges).toEqual([])
    vi.advanceTimersByTime(1)
    expect(m.nudges).toEqual([['a1']])
  })

  it('stops nudging when the setting is turned off', () => {
    const m = started({}, ({ state }) => { state.panes.set('p1', pane('p1')); state.approvals = [approval('a1', 'pane:p1')] })
    m.setting.value = null
    m.readModel.settingChanged()
    vi.advanceTimersByTime(NEEDS_YOU_MS * 3)
    expect(m.nudges).toEqual([])
  })

  it('logs the failures nothing else reports, and a failing flush never throws into the timer', () => {
    const m = model()
    m.seen.all = () => { throw new Error('disk') }
    m.readModel.start()
    stop.push(() => m.readModel.stop())
    expect(m.warn).toHaveBeenCalledWith(expect.stringContaining('seen marks'), expect.any(Error))
    m.state.panes.set('p1', pane('p1'))
    m.publishFails.value = true
    notifyAgentSource({ source: 'pane', id: 'p1' })
    expect(() => vi.advanceTimersByTime(AGENTS_COALESCE_MS)).not.toThrow()
    expect(m.warn).toHaveBeenCalledWith(expect.stringContaining('could not update'), expect.any(Error))
  })

  it('forgets in memory a mark the store evicted at its cap', () => {
    const m = started({}, ({ state, marks }) => {
      state.conversations.set('t1', { thread: thread('t1', { lastTurnStatus: 'completed' }), requests: [] })
      state.conversations.set('t2', { thread: thread('t2', { lastTurnStatus: 'completed' }), requests: [] })
      marks.set('conversation:t2', T0 + 1)
    })
    expect(m.row('conversation:t2')?.state).toBe('idle')
    m.evict.push('conversation:t2')
    m.readModel.markSeen({ key: 'conversation:t1' })
    expect(m.row('conversation:t2')?.state).toBe('finished')
  })

  it('drops quiet rows first past the cap, then the oldest finished and failed, never needs-you or working', () => {
    const facts: AgentFacts = { panes: new Map(), conversations: new Map(), delegations: new Map(), work: new Map(), approvals: [], workspaces: [], providerOf: () => undefined }
    const draft = (key: string, state: AgentOverviewRow['state'], since: number) => ({ key: key as AgentOverviewRow['key'], kind: 'pane' as const, id: key.slice(5), workspaceId: 'w', mode: 'code' as const, title: key, state, sinceHint: since })
    const drafts = [
      ...Array.from({ length: 499 }, (_, index) => draft(`pane:f${index}`, 'failed', T0 + 10 + index)),
      draft('pane:old-failed', 'failed', T0), draft('pane:idle', 'idle', T0 + 5_000), draft('pane:working', 'working', T0), draft('pane:needs', 'needs-you', T0)
    ]
    const { rows } = stampRows(drafts, facts, new Map(), new Map(), new Set(), T0)
    const keys = new Set(rows.map(row => row.key))
    expect(rows).toHaveLength(500)
    expect(keys.has('pane:idle')).toBe(false)
    expect(keys.has('pane:old-failed')).toBe(false)
    expect(keys.has('pane:f0')).toBe(false)
    expect(keys.has('pane:working') && keys.has('pane:needs')).toBe(true)
  })

  it('words the notification and names what its click opens (agents:activate)', () => {
    const t = (key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ''}`
    const waiting = (key: string, id: string): AgentOverviewRow => ({ key: key as AgentOverviewRow['key'], kind: 'pane', id: key.slice(5), workspaceId: 'w', mode: 'code', title: `Agent ${id}`, state: 'needs-you', since: T0, seen: false, lastSeenAt: null, rev: 1,
      pendingRequest: { via: 'approval', id, title: { code: 'approvals.title.agent', params: {} }, since: T0, more: 0 } })
    expect(nudgeNotice([waiting('pane:p1', 'a1')], t, 120_000)).toEqual({
      title: 'messages.agents.nudge.single{"agent":"Agent a1","minutes":2}', body: 'messages.approvals.title.agent', activate: { agentId: 'pane:p1', requestId: 'a1' }
    })
    // #355: the title carries the chosen delay (1, 2 or 5), not the time measured.
    for (const [afterMs, minutes] of [[60_000, 1], [120_000, 2], [300_000, 5]] as const) {
      expect(nudgeNotice([waiting('pane:p1', 'a1')], t, afterMs)?.title).toBe(`messages.agents.nudge.single{"agent":"Agent a1","minutes":${minutes}}`)
    }
    expect(nudgeNotice([waiting('pane:p1', 'a1'), waiting('pane:p2', 'a2')], t, 120_000)).toMatchObject({ title: 'messages.agents.nudge.batch{"count":2}', activate: { agentId: 'pane:p1', requestId: 'a1' } })
    expect(nudgeNotice([], t, 120_000)).toBeNull()
    // With the setting off there is no notification at all.
    expect(nudgeNotice([waiting('pane:p1', 'a1')], t, null)).toBeNull()
  })

  it('takes the nudge setting through IPC as exactly { afterMs }', async () => {
    const set = vi.fn(async (afterMs: unknown) => ({ afterMs: afterMs as 300_000 }))
    registerAgentsIpc({ model: vi.fn(), sender: () => undefined, nudge: { get: async () => ({ afterMs: 120_000 }), set } })
    expect(await handlers.get(IPC_CHANNELS.agents.nudgeSetting)!({})).toEqual({ afterMs: 120_000 })
    expect(await handlers.get(IPC_CHANNELS.agents.setNudgeSetting)!({}, { afterMs: 300_000 })).toEqual({ afterMs: 300_000 })
    for (const input of [null, 300_000, {}, { afterMs: 300_000, extra: 1 }]) expect(() => handlers.get(IPC_CHANNELS.agents.setNudgeSetting)!({}, input), JSON.stringify(input)).toThrow(/afterMs/)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('asks the phone gateway for a fresh snapshot when the setting changes', () => {
    const listener = vi.fn()
    const off = onRemoteAgentsResnapshot(listener)
    requestRemoteAgentsResnapshot()
    off()
    requestRemoteAgentsResnapshot()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
