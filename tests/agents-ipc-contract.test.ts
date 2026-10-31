import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const sent: [string, unknown][] = []
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } },
  BrowserWindow: {
    fromWebContents: () => ({}),
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) } }],
    getFocusedWindow: () => null
  }
}))

import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { createAgentsDouble, readAgentsFixture, registerAgentsMock, sampleAgents, E2E_AGENTS_GLOBAL, type AgentsDriveInput } from '../electron/main/e2e/agents-mock'
import { applyAgentsChange, normalizeMarkSeen, toRemoteAgentRow } from '../shared/agents/agentsOverview'
import { AGENT_KINDS, AGENT_STATES, type AgentKey } from '../shared/agents/agentState'
import { AGENT_TIMER_DEFAULTS, dueNudges, readAgentTimers, stateAfterStop, agentTimersE2e } from '../shared/agents/agentTimers'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import { REMOTE_COMMANDS, REMOTE_SUBSCRIPTIONS, type RemoteAgentRow, type RemoteCommandArgs } from '../shared/remote/protocol'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { AGENT_REQUEST_TITLE_CODES, AGENT_SOURCE_UNAVAILABLE_CODES, AGENTS_REFUSALS, type AgentOverviewRow, type AgentsChange, type AgentsOverview } from '../shared/types/ipc/agents'

const NOW = 1_800_000_000_000
const appEvent = { sender: { mainFrame: 'main' }, senderFrame: 'main' }
beforeEach(() => { handlers.clear(); sent.length = 0; delete (globalThis as Record<string, unknown>)[E2E_AGENTS_GLOBAL] })

const row = (key: AgentKey, fields: Partial<AgentOverviewRow> = {}): AgentOverviewRow => {
  const [kind, id] = key.split(/:(.*)/s) as [AgentOverviewRow['kind'], string]
  return { key, kind, id, workspaceId: 'w1', state: 'idle', since: NOW, title: id, mode: kind === 'pane' ? 'code' : 'thread', seen: false, lastSeenAt: null, sourceSeq: 1, ...fields }
}
const ok = { ok: true } as const
const sources = Object.fromEntries(AGENT_KINDS.map(kind => [kind, ok])) as AgentsOverview['sources']

describe('agents IPC contract (S7.1, C1)', () => {
  it('uses two invoke channels and one event in their own group', () => {
    expect(IPC_CHANNELS.agents).toEqual({ overview: 'agents:overview', markSeen: 'agents:mark-seen', changed: 'agents:changed' })
  })

  it('is for the person: forbidden to agents, and the event is no action', () => {
    const capability = MCP_COVERAGE['agents.central']
    expect('forbidden' in capability && !('tools' in capability)).toBe(true)
    expect(capability.ipc).toEqual(['agents.overview', 'agents.markSeen'])
    expect(MCP_COVERAGE['app.events'].ipc).toContain('*.changed')
  })

  it('has a message code for every refusal, source failure and request title', () => {
    for (const refusal of AGENTS_REFUSALS) expect(isMessageCode(`agents.refused.${refusal}`), refusal).toBe(true)
    for (const code of [...Object.values(AGENT_SOURCE_UNAVAILABLE_CODES), ...Object.values(AGENT_REQUEST_TITLE_CODES)]) expect(isMessageCode(code), code).toBe(true)
  })

  it('exposes the calls and the event through its own preload module', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const agents = createOxeApi(ipc).agents!
    await agents.overview!()
    await agents.markSeen!({ key: 'pane:p1' })
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([[IPC_CHANNELS.agents.overview], [IPC_CHANNELS.agents.markSeen, { key: 'pane:p1' }]])
    const listener = vi.fn()
    const off = agents.onChanged!(listener)
    const [[channel, wrapped]] = vi.mocked(ipc.on).mock.calls
    expect(channel).toBe(IPC_CHANNELS.agents.changed)
    wrapped({} as never, { seq: 1 })
    expect(listener).toHaveBeenCalledWith({ seq: 1 })
    off()
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.agents.changed, wrapped)
  })

  it('checks a mark-seen: exactly a valid key', () => {
    expect(normalizeMarkSeen({ key: 'conversation:t1' })).toEqual({ ok: true, key: 'conversation:t1' })
    for (const input of [null, 'pane:p1', [], {}, { key: 'shell:x' }, { key: 'pane:p1', at: NOW }, { agentId: 'pane:p1' }]) {
      expect(normalizeMarkSeen(input), JSON.stringify(input)).toMatchObject({ ok: false, refusal: 'invalid', message: { code: 'agents.refused.invalid' } })
    }
  })
})

describe('applying agents:changed (§5.3)', () => {
  const base: AgentsOverview = { rows: [row('pane:p1', { sourceSeq: 5 }), row('conversation:t1', { state: 'working', sourceSeq: 2 })], sources, seq: 10 }

  it('replaces by key, removes, sorts, and takes changed sources', () => {
    const change: AgentsChange = { seq: 11, upsert: [row('pane:p1', { state: 'needs-you', sourceSeq: 6 }), row('work:r1', { state: 'failed' })], removed: ['conversation:t1'], sources: { work: { ok: false, message: { code: 'agents.unavailable.work', params: {} } } } }
    const applied = applyAgentsChange(base, change)
    expect(applied.ok && applied.overview.rows.map(item => [item.key, item.state])).toEqual([['pane:p1', 'needs-you'], ['work:r1', 'failed']])
    expect(applied.ok && applied.overview.sources.work).toEqual({ ok: false, message: { code: 'agents.unavailable.work', params: {} } })
    expect(applied.ok && applied.overview.sources.pane).toEqual(ok)
    expect(applied.ok && applied.overview.seq).toBe(11)
  })

  it('never lets a late row overwrite a newer one', () => {
    const applied = applyAgentsChange(base, { seq: 11, upsert: [row('pane:p1', { state: 'working', sourceSeq: 4 }), row('conversation:t1', { state: 'idle', sourceSeq: 2 })] })
    expect(applied.ok && applied.overview.rows.find(item => item.key === 'pane:p1')?.sourceSeq).toBe(5)
    expect(applied.ok && applied.overview.rows.find(item => item.key === 'conversation:t1')?.state).toBe('working')
  })

  it('ignores a change already applied, and asks for a fresh read after a gap', () => {
    expect(applyAgentsChange(base, { seq: 10, removed: ['pane:p1'] })).toEqual({ ok: true, overview: base })
    expect(applyAgentsChange(base, { seq: 12, removed: ['pane:p1'] })).toEqual({ ok: false, reason: 'gap' })
  })
})

describe('the phone row (C5, §8)', () => {
  it('adds the agents subscription and the mark-seen command', () => {
    expect(REMOTE_SUBSCRIPTIONS).toContain('agents')
    expect(REMOTE_COMMANDS).toContain('agent.markSeen')
    const args: RemoteCommandArgs['agent.markSeen'] = { agentId: 'conversation:t1' }
    expect(Object.keys(args)).toEqual(['agentId'])
  })

  it('carries no path, session id, cost, seen time or source sequence', () => {
    const desktop = row('delegation:d1', {
      state: 'needs-you', provider: 'claude', parentKey: 'conversation:t1', cost: { usd: 3, estimated: false }, worktree: { path: 'C:/secret/wt', branch: 'feat/x' },
      lastSeenAt: NOW, sourceSeq: 9, tasks: { done: 1, total: 2 },
      pendingRequest: { via: 'approval', id: 'a1', title: { code: 'approvals.title.agent', params: {} }, risk: 'critical', since: NOW, more: 2 }
    })
    const remote = toRemoteAgentRow(desktop, { workspaceName: 'api', requestTitle: 'Asks to run a command', requestAnswerable: true })
    expect(remote).toEqual({
      id: 'delegation:d1', kind: 'delegation', state: 'needs-you', since: NOW, title: 'd1', provider: 'claude', workspaceName: 'api', parentId: 'conversation:t1',
      request: { requestId: 'a1', title: 'Asks to run a command', risk: 'critical', answerable: false, more: 2 }, tasks: { done: 1, total: 2 }
    } satisfies RemoteAgentRow)
    expect(JSON.stringify(remote)).not.toMatch(/secret|usd|lastSeenAt|sourceSeq|worktree|session/i)
  })

  it('lets the phone answer only a conversation request it may answer, and stop only a running conversation', () => {
    const conversation = row('conversation:t1', { state: 'working', pendingRequest: { via: 'thread', id: 'r1', threadId: 't1', title: { code: 'agents.request.question', params: {} }, since: NOW, more: 0 } })
    expect(toRemoteAgentRow(conversation, { workspaceName: 'w', requestTitle: 'Has a question for you', requestAnswerable: true, canInterrupt: true })).toMatchObject({
      threadId: 't1', canInterrupt: true, request: { threadId: 't1', requestId: 'r1', answerable: true }
    })
    expect(toRemoteAgentRow(conversation, { workspaceName: 'w', requestAnswerable: false }).request?.answerable).toBe(false)
    expect(toRemoteAgentRow(row('pane:p1', { state: 'working' }), { workspaceName: 'w', canInterrupt: true })).toEqual(expect.not.objectContaining({ canInterrupt: true }))
    expect(toRemoteAgentRow(row('pane:p1'), { workspaceName: 'w' })).toMatchObject({ paneId: 'p1' })
  })

  it('cuts titles to the protocol limit and drops control characters', () => {
    const remote = toRemoteAgentRow(row('pane:p1', { title: `a\nb${'x'.repeat(300)}` }), { workspaceName: 'w' })
    expect([...remote.title]).toHaveLength(200)
    expect(remote.title.startsWith('a b')).toBe(true)
  })
})

describe('testable timers (§14)', () => {
  it('honours the e2e variables only in an unpackaged e2e build, and only to shorten', () => {
    const env = { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENTS_NEEDS_YOU_MS: '500', OXESPACE_E2E_AGENTS_NO_REPORT_MS: '300' }
    expect(AGENT_TIMER_DEFAULTS).toEqual({ needsYouMs: 120_000, noReportMs: 10_000 })
    expect(readAgentTimers(env, agentTimersE2e(env, false))).toEqual({ needsYouMs: 500, noReportMs: 300 })
    expect(readAgentTimers(env, agentTimersE2e(env, true))).toEqual(AGENT_TIMER_DEFAULTS)
    expect(readAgentTimers({ ...env, OXESPACE_E2E_MOCK_NATIVE: undefined }, agentTimersE2e({ ...env, OXESPACE_E2E_MOCK_NATIVE: undefined }, false))).toEqual(AGENT_TIMER_DEFAULTS)
    for (const raw of ['0', '10', '-5', '1e3', 'abc', '999999999', ' ']) {
      expect(readAgentTimers({ OXESPACE_E2E_AGENTS_NO_REPORT_MS: raw }, true).noReportMs, raw).toBe(10_000)
    }
  })

  it('nudges once per request, only while unfocused, batching requests due within 10 s', () => {
    const waiting = [{ key: 'pane:p1', requestId: 'a', since: 0 }, { key: 'pane:p2', requestId: 'b', since: 5_000 }, { key: 'pane:p3', requestId: 'c', since: 30_000 }, { key: 'pane:p4', requestId: 'd', since: 200_000 }]
    expect(dueNudges(waiting, new Set(), { now: 200_000, nudgeAfterMs: 120_000, focused: true })).toEqual([])
    expect(dueNudges(waiting, new Set(), { now: 200_000, nudgeAfterMs: null, focused: false })).toEqual([])
    expect(dueNudges(waiting, new Set(), { now: 200_000, nudgeAfterMs: 120_000, focused: false }).map(batch => batch.map(item => item.requestId))).toEqual([['a', 'b'], ['c']])
    expect(dueNudges(waiting, new Set(['a', 'b']), { now: 200_000, nudgeAfterMs: 120_000, focused: false }).map(batch => batch.map(item => item.requestId))).toEqual([['c']])
  })

  it('turns a row with no report after a Stop into unknown, never stuck', () => {
    expect(stateAfterStop('working', { stopAt: 100, lastReportAt: 50, now: 5_000, noReportMs: 10_000 })).toBe('working')
    expect(stateAfterStop('working', { stopAt: 100, lastReportAt: 50, now: 10_100, noReportMs: 10_000 })).toBe('unknown')
    expect(stateAfterStop('stopped', { stopAt: 100, lastReportAt: 200, now: 99_000, noReportMs: 10_000 })).toBe('stopped')
  })
})

describe('the e2e double (agents-mock)', () => {
  const make = (fixture = readAgentsFixture('sample', NOW)!, focused = false) => {
    let now = NOW
    const queue: [number, () => void][] = []
    const changes: AgentsChange[] = []
    const double = createAgentsDouble({ fixture, timers: { needsYouMs: 1_000, noReportMs: 500 }, now: () => now, publish: change => changes.push(change), focused: () => focused, after: (ms, run) => queue.push([now + ms, run]) })
    const advance = (ms: number) => { now += ms; for (const [at, run] of queue.splice(0)) if (at <= now) run(); else queue.push([at, run]); double.tick() }
    return { double, changes, advance }
  }

  it('lists eight sample agents across modes, in order, with one of every state', () => {
    const agents = sampleAgents(NOW)
    expect(agents).toHaveLength(8)
    expect(new Set(agents.map(item => item.state))).toEqual(new Set(AGENT_STATES))
    expect(new Set(agents.map(item => item.kind))).toEqual(new Set(AGENT_KINDS))
    const { double } = make()
    expect(double.overview().rows.map(item => item.state)).toEqual(['needs-you', 'needs-you', 'failed', 'working', 'finished', 'idle', 'stopped', 'unknown'])
    expect(double.overview().sources).toEqual(sources)
  })

  it('pushes source reports with a growing seq and sourceSeq', () => {
    const { double, changes } = make()
    double.drive({ action: 'set', key: 'pane:p2', state: 'needs-you' })
    double.drive({ action: 'remove', key: 'conversation:t3' })
    expect(changes.map(change => change.seq)).toEqual([1, 2])
    expect(changes[0].upsert?.[0]).toMatchObject({ key: 'pane:p2', state: 'needs-you', sourceSeq: 2, since: NOW })
    expect(changes[1].removed).toEqual(['conversation:t3'])
  })

  it('marks seen: finished becomes idle; unknown keys and bad input are refused', () => {
    const { double } = make()
    expect(double.markSeen({ key: 'work:r1' })).toEqual({ ok: true, key: 'work:r1', seenAt: NOW, state: 'idle' })
    expect(double.overview().rows.find(item => item.key === 'work:r1')).toMatchObject({ seen: true, lastSeenAt: NOW, state: 'idle' })
    expect(double.markSeen({ key: 'pane:nope' })).toMatchObject({ ok: false, refusal: 'notFound' })
    expect(double.markSeen({ key: 'nope' })).toMatchObject({ ok: false, refusal: 'invalid' })
  })

  it('keeps a silent agent quiet after Stop, then shows it as unknown; another reports stopped', () => {
    const { double, advance } = make()
    double.drive({ action: 'stop', key: 'delegation:d1' })
    double.drive({ action: 'stop', key: 'conversation:t2' })
    advance(250)
    const state = (key: string) => double.overview().rows.find(item => item.key === key)?.state
    expect(state('conversation:t2')).toBe('stopped')
    expect(state('delegation:d1')).toBe('working')
    advance(300)
    expect(state('delegation:d1')).toBe('unknown')
  })

  it('nudges each waiting request once while the window is unfocused', () => {
    const { double, advance } = make()
    // The two sample requests already waited longer than the shortened 1 s; they are 20 s apart, so two notifications.
    advance(100)
    expect(double.drive({ action: 'nudges' })).toEqual([['approval-1'], ['request-1']])
    double.drive({ action: 'set', key: 'pane:p2', state: 'needs-you', pendingRequest: { via: 'approval', id: 'approval-2', title: { code: 'approvals.title.agent', params: {} }, since: NOW + 100, more: 0 } })
    advance(500)
    expect(double.drive({ action: 'nudges' })).toHaveLength(2)
    advance(600)
    advance(5_000)
    expect(double.drive({ action: 'nudges' })).toEqual([['approval-1'], ['request-1'], ['approval-2']])
  })

  it('does not nudge while a window is focused', () => {
    const { double, advance } = make(undefined, true)
    advance(5_000)
    expect(double.drive({ action: 'nudges' })).toEqual([])
  })

  it('reports a failing source with its message code', () => {
    const { double, changes } = make()
    double.drive({ action: 'unavailable', kind: 'delegation', ok: false })
    expect(changes.at(-1)?.sources).toEqual({ delegation: { ok: false, message: { code: 'agents.unavailable.delegation', params: {} } } })
    expect(double.overview().sources.delegation.ok).toBe(false)
  })

  it('reads a JSON fixture and drops rows it cannot place', () => {
    const fixture = readAgentsFixture(JSON.stringify({ rows: [row('pane:p9', { state: 'working' }), { ...row('pane:x'), state: 'busy' }, { ...row('pane:y'), key: 'shell:y' }], silent: ['pane:p9', 'bad'], unavailable: ['work', 'other'] }), NOW)
    expect(fixture?.rows.map(item => item.key)).toEqual(['pane:p9'])
    expect(fixture?.silent).toEqual(['pane:p9'])
    expect(fixture?.unavailable).toEqual(['work'])
    expect(readAgentsFixture(undefined, NOW)).toBeNull()
  })

  it('registers the two handlers; the fixture and the spec hook exist only in an unpackaged e2e build', async () => {
    const env = { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_AGENTS: 'sample' }
    registerAgentsMock(env, true)
    expect([...handlers.keys()].sort()).toEqual([IPC_CHANNELS.agents.markSeen, IPC_CHANNELS.agents.overview].sort())
    expect((await handlers.get(IPC_CHANNELS.agents.overview)!(appEvent) as AgentsOverview).rows).toEqual([])
    expect((globalThis as Record<string, unknown>)[E2E_AGENTS_GLOBAL]).toBeUndefined()

    handlers.clear()
    registerAgentsMock(env, false)
    expect((await handlers.get(IPC_CHANNELS.agents.overview)!(appEvent) as AgentsOverview).rows).toHaveLength(8)
    const drive = (globalThis as Record<string, unknown>)[E2E_AGENTS_GLOBAL] as (input: AgentsDriveInput) => unknown
    drive({ action: 'set', key: 'pane:p1', state: 'working' })
    expect(sent.at(-1)?.[0]).toBe(IPC_CHANNELS.agents.changed)
    expect(() => handlers.get(IPC_CHANNELS.agents.overview)!({ sender: { mainFrame: 'main' }, senderFrame: 'child' })).toThrow(/main frame/)
  })
})
