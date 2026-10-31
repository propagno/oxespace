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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { createAgentsDouble, readAgentsFixture, registerAgentsMock, sampleAgents, E2E_AGENTS_GLOBAL, type AgentsDriveInput } from '../electron/main/e2e/agents-mock'
// @ts-expect-error plain ESM script without types
import { protocolKotlin } from '../scripts/android/protocol-kotlin.mjs'
import { applyAgentsChange, normalizeMarkSeen, seenAtFor } from '../shared/agents/agentsOverview'
import {
  agentMarkSeenAuditDetail, agentsCursor, cutText, pageRemoteAgents, readAgentsCursor, readRemoteMarkSeen, REMOTE_AGENT_ID, splitRemoteAgentsEvent, toRemoteAgentRow,
  type RemoteAgentContext
} from '../shared/agents/remoteAgentRow'
import { AGENT_KINDS, AGENT_STATES, parseAgentKey, type AgentKey } from '../shared/agents/agentState'
import { AGENT_TIMER_DEFAULTS, dueNudges, readAgentTimers, stateAfterStop, agentTimersE2e } from '../shared/agents/agentTimers'
import enMain from '../shared/locales/en/main.json'
import ptMain from '../shared/locales/pt-BR/main.json'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import * as protocol from '../shared/remote/protocol'
import { REMOTE_COMMANDS, REMOTE_LIMITS, REMOTE_SUBSCRIPTIONS, REMOTE_TEXT_LIMITS, REMOTE_UNKNOWN_VALUES, type RemoteAgentRow, type RemoteCommandArgs } from '../shared/remote/protocol'
import { redactSecrets } from '../shared/secrets'
import { IPC_CHANNELS } from '../shared/types/ipc'
import {
  AGENT_REQUEST_TITLE_CODE_LIST, AGENT_REQUEST_TITLE_CODES, AGENT_SOURCE_UNAVAILABLE_CODES, AGENTS_REFUSALS, isAgentRequestTitle, type AgentOverviewRow, type AgentsChange, type AgentsOverview
} from '../shared/types/ipc/agents'

const lookup = (catalog: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)

const NOW = 1_800_000_000_000
const appEvent = { sender: { mainFrame: 'main' }, senderFrame: 'main' }
beforeEach(() => { handlers.clear(); sent.length = 0; delete (globalThis as Record<string, unknown>)[E2E_AGENTS_GLOBAL] })

const row = (key: AgentKey, fields: Partial<AgentOverviewRow> = {}): AgentOverviewRow => {
  const [kind, id] = key.split(/:(.*)/s) as [AgentOverviewRow['kind'], string]
  return { key, kind, id, workspaceId: 'w1', state: 'idle', since: NOW, title: id, mode: kind === 'pane' ? 'code' : 'thread', seen: false, lastSeenAt: null, rev: 1, ...fields }
}
const ok = { ok: true } as const
const sources = Object.fromEntries(AGENT_KINDS.map(kind => [kind, ok])) as AgentsOverview['sources']

describe('agents IPC contract (S7.1, C1)', () => {
  it('uses two invoke channels and two events in their own group', () => {
    expect(IPC_CHANNELS.agents).toEqual({ overview: 'agents:overview', markSeen: 'agents:mark-seen', changed: 'agents:changed', activate: 'agents:activate' })
  })

  it('is for the person: forbidden to agents, and the event is no action', () => {
    const capability = MCP_COVERAGE['agents.central']
    expect('forbidden' in capability && !('tools' in capability)).toBe(true)
    expect(capability.ipc).toEqual(['agents.overview', 'agents.markSeen', 'agents.activate'])
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
    // agents:activate: the notification click opens Respond for that agent and request (never inferred from focus).
    const onActivate = vi.fn()
    const offActivate = agents.onActivate!(onActivate)
    const [activateChannel, activateWrapped] = vi.mocked(ipc.on).mock.calls[1]
    expect(activateChannel).toBe(IPC_CHANNELS.agents.activate)
    activateWrapped({} as never, { agentId: 'pane:p1', requestId: 'a1' })
    expect(onActivate).toHaveBeenCalledWith({ agentId: 'pane:p1', requestId: 'a1' })
    offActivate()
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.agents.activate, activateWrapped)
  })

  it('checks a mark-seen: exactly a valid key, and an optional observedSince', () => {
    expect(normalizeMarkSeen({ key: 'conversation:t1' })).toEqual({ ok: true, key: 'conversation:t1' })
    expect(normalizeMarkSeen({ key: 'conversation:t1', observedSince: NOW })).toEqual({ ok: true, key: 'conversation:t1', observedSince: NOW })
    for (const input of [null, 'pane:p1', [], {}, { key: 'shell:x' }, { key: 'pane:p1', at: NOW }, { agentId: 'pane:p1' }, { key: 'pane:p1', observedSince: -5 }, { key: 'pane:p1', observedSince: 'now' }]) {
      expect(normalizeMarkSeen(input), JSON.stringify(input)).toMatchObject({ ok: false, refusal: 'invalid', message: { code: 'agents.refused.invalid' } })
    }
  })
})

describe('applying agents:changed (§5.3)', () => {
  const base: AgentsOverview = { rows: [row('pane:p1', { rev: 5 }), row('conversation:t1', { state: 'working', rev: 2 })], sources, seq: 10 }

  it('replaces by key, removes, sorts, and takes changed sources', () => {
    const change: AgentsChange = { seq: 11, upsert: [row('pane:p1', { state: 'needs-you', rev: 6 }), row('work:r1', { state: 'failed' })], removed: ['conversation:t1'], sources: { work: { ok: false, message: { code: 'agents.unavailable.work', params: {} } } } }
    const applied = applyAgentsChange(base, change)
    expect(applied.ok && applied.overview.rows.map(item => [item.key, item.state])).toEqual([['pane:p1', 'needs-you'], ['work:r1', 'failed']])
    expect(applied.ok && applied.overview.sources.work).toEqual({ ok: false, message: { code: 'agents.unavailable.work', params: {} } })
    expect(applied.ok && applied.overview.sources.pane).toEqual(ok)
    expect(applied.ok && applied.overview.seq).toBe(11)
  })

  it('never lets a late row overwrite a newer one', () => {
    const applied = applyAgentsChange(base, { seq: 11, upsert: [row('pane:p1', { state: 'working', rev: 4 }), row('conversation:t1', { state: 'idle', rev: 2 })] })
    expect(applied.ok && applied.overview.rows.find(item => item.key === 'pane:p1')?.rev).toBe(5)
    expect(applied.ok && applied.overview.rows.find(item => item.key === 'conversation:t1')?.state).toBe('working')
  })

  it('applies a change that only the read model made (mark-seen, terminal exit): rev grows with no source counter (ARCHITECT H1)', () => {
    const { double, changes } = (() => {
      const changes: AgentsChange[] = []
      const double = createAgentsDouble({ fixture: readAgentsFixture('sample', NOW)!, timers: AGENT_TIMER_DEFAULTS, now: () => NOW + 1, publish: change => changes.push(change), focused: () => true, after: () => undefined })
      return { double, changes }
    })()
    const before = double.overview()
    double.markSeen({ key: 'work:r1' })
    const [change] = changes
    expect(change.upsert?.[0]).toMatchObject({ key: 'work:r1', state: 'idle', rev: before.rows.find(item => item.key === 'work:r1')!.rev + 1 })
    const applied = applyAgentsChange(before, change)
    expect(applied.ok && applied.overview.rows.find(item => item.key === 'work:r1')).toMatchObject({ state: 'idle', seen: true })
  })

  it('stores the seen time so a newer finish stays Finished (Q6, observedSince)', () => {
    const finishedAt = 1_000
    expect(seenAtFor({ state: 'finished', since: finishedAt }, { stored: null, now: 5_000 })).toBe(5_000)
    expect(seenAtFor({ state: 'finished', since: finishedAt }, { stored: null, now: 5_000, observedSince: 900 })).toBe(900)
    expect(seenAtFor({ state: 'finished', since: finishedAt }, { stored: 950, now: 5_000, observedSince: 900 })).toBe(950)
    expect(seenAtFor({ state: 'finished', since: finishedAt }, { stored: null, now: 5_000, observedSince: finishedAt })).toBe(5_000)
    expect(seenAtFor({ state: 'idle', since: finishedAt }, { stored: 7_000, now: 5_000, observedSince: 900 })).toBe(7_000)
  })

  it('ignores a change already applied, and asks for a fresh read after a gap', () => {
    expect(applyAgentsChange(base, { seq: 10, removed: ['pane:p1'] })).toEqual({ ok: true, overview: base })
    expect(applyAgentsChange(base, { seq: 12, removed: ['pane:p1'] })).toEqual({ ok: false, reason: 'gap' })
  })
})

describe('the phone row (C5, §8)', () => {
  /** The gateway's cleaner stands in here as the redactor main has today (shared/secrets) plus scrubbing the person's roots. */
  const ROOTS = ['C:\\Users\\me\\client-x', '/home/me/client-x']
  const clean = (text: string): string => ROOTS.reduce((value, root) => value.split(root).join('…'), redactSecrets(text))
  const context = (fields: Partial<RemoteAgentContext> = {}): RemoteAgentContext => ({ clean, workspaceName: 'w', ...fields })

  it('adds the agents subscription and the mark-seen command', () => {
    expect(REMOTE_SUBSCRIPTIONS).toContain('agents')
    expect(REMOTE_COMMANDS).toContain('agent.markSeen')
    const args: RemoteCommandArgs['agent.markSeen'] = { agentId: 'conversation:t1', observedSince: NOW }
    expect(Object.keys(args)).toEqual(['agentId', 'observedSince'])
  })

  it('carries no path, session id, cost, seen time or revision', () => {
    const desktop = row('delegation:d1', {
      state: 'needs-you', provider: 'claude', parentKey: 'conversation:t1', cost: { usd: 3, estimated: false }, worktree: { path: 'C:/secret/wt', branch: 'feat/x' },
      lastSeenAt: NOW, rev: 9, tasks: { done: 1, total: 2 },
      pendingRequest: { via: 'approval', id: 'a1', title: { code: 'approvals.title.agent', params: {} }, risk: 'critical', since: NOW, more: 2 }
    })
    const remote = toRemoteAgentRow(desktop, context({ workspaceName: 'api', requestTitle: 'Asks to run a command', requestAnswerable: true }))
    expect(remote).toEqual({
      id: 'delegation:d1', kind: 'delegation', state: 'needs-you', since: NOW, title: 'd1', provider: 'claude', workspaceName: 'api', parentId: 'conversation:t1',
      request: { requestId: 'a1', title: 'Asks to run a command', risk: 'critical', answerable: false, more: 2 }, tasks: { done: 1, total: 2 }
    } satisfies RemoteAgentRow)
    expect(JSON.stringify(remote)).not.toMatch(/secret|usd|lastSeenAt|"rev"|worktree|session/i)
  })

  it('never lets a path or a token in free text reach the row (SECURITY H1)', () => {
    const token = 'ghp_' + 'A'.repeat(36)
    const key = 'sk-ant-' + 'b'.repeat(40)
    const desktop = row('conversation:t1', {
      state: 'needs-you', title: `deploy with ${token} from C:\\Users\\me\\client-x\\api and /home/me/client-x/web`,
      pendingRequest: { via: 'thread', id: 'r1', threadId: 't1', title: { code: 'agents.request.approval', params: {} }, since: NOW, more: 0 }
    })
    const remote = toRemoteAgentRow(desktop, context({ workspaceName: `client-x ${key}`, requestTitle: `Wants to run an action in C:\\Users\\me\\client-x with ${token}` }))
    const text = JSON.stringify(remote)
    for (const leaked of [token, key, 'C:\\\\Users', 'client-x\\\\api', '/home/me']) expect(text, leaked).not.toContain(leaked)
    expect(remote.title).toContain('[redacted]')
    expect(remote.title).toContain('…')
    expect(remote.workspaceName).toBe('client-x [redacted]')
    expect(remote.request?.title).toBe('Wants to run an action in … with [redacted]')
  })

  it('strips hidden characters before cleaning, so a token split by a zero-width space is still redacted (SECURITY M2)', () => {
    const token = 'ghp_' + 'A'.repeat(18) + '​' + 'A'.repeat(18)
    const remote = toRemoteAgentRow(row('delegation:d1', { title: `push with ${token}` }), context({ workspaceName: `ws ${token}`, requestTitle: `run ${token}` }))
    const whole = 'ghp_' + 'A'.repeat(36)
    for (const text of [remote.title, remote.workspaceName]) {
      expect(text).not.toContain(whole)
      expect(text).not.toContain('A'.repeat(18))
      expect(text).toContain('[redacted]')
    }
    const withRequest = toRemoteAgentRow(row('conversation:t1', { pendingRequest: { via: 'thread', id: 'r1', title: { code: 'agents.request.approval', params: {} }, since: NOW, more: 0 } }), context({ requestTitle: `run ${token}` }))
    expect(withRequest.request?.title).toBe('run [redacted]')
  })

  it('leaves out a request or a parent whose id fails the gateway rule, so no row outgrows its frame (SECURITY L5)', () => {
    const huge = 'r'.repeat(70_000)
    const desktop = row('conversation:t1', {
      state: 'needs-you', parentKey: `work:${'w'.repeat(300)}` as AgentKey,
      pendingRequest: { via: 'thread', id: huge, threadId: 't1', title: { code: 'agents.request.approval', params: {} }, since: NOW, more: 0 }
    })
    const remote = toRemoteAgentRow(desktop, context({ requestTitle: 'Wants to run an action', requestAnswerable: true }))
    expect(remote).not.toHaveProperty('request')
    expect(remote).not.toHaveProperty('parentId')
    expect(toRemoteAgentRow(row('pane:p1', { parentKey: 'shell:x' as AgentKey }), context())).not.toHaveProperty('parentId')
    expect(toRemoteAgentRow(row('pane:p1', { pendingRequest: { via: 'approval', id: 'a 1', title: { code: 'approvals.title.agent', params: {} }, since: NOW, more: 0 } }), context())).not.toHaveProperty('request')
    expect(toRemoteAgentRow(row('conversation:t2', { pendingRequest: { via: 'thread', id: 'r1', threadId: 'x'.repeat(201), title: { code: 'agents.request.question', params: {} }, since: NOW, more: 0 } }), context())).not.toHaveProperty('request')
    // The row and every page it lands on stay small.
    expect(new TextEncoder().encode(JSON.stringify(remote)).byteLength).toBeLessThan(4_096)
    const pages = pageRemoteAgents({ agents: Array.from({ length: 50 }, () => remote) })
    for (const page of pages) expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(REMOTE_LIMITS.maxFrameBytes)
  })

  it('requires the cleaner, and applies it to the title, the workspace name and the request title', () => {
    const seen: string[] = []
    const spy = (text: string) => { seen.push(text); return text }
    toRemoteAgentRow(row('pane:p1', { pendingRequest: { via: 'approval', id: 'a', title: { code: 'approvals.title.agent', params: {} }, since: NOW, more: 0 } }), { clean: spy, workspaceName: 'ws', requestTitle: 'rt' })
    expect(seen).toEqual(['p1', 'ws', 'rt'])
  })

  it('removes bidi, zero-width and tag characters, so a title cannot pose as another row (SECURITY M1)', () => {
    const remote = toRemoteAgentRow(row('delegation:d1', { title: 'Claude\u202e · api\u200b\u2066x\u2069\u{e0041}\ufeff' }), context())
    expect(remote.title).toBe('Claude · apix')
    expect(cutText('a\u200d\u200db', 10)).toBe('ab')
  })

  it('cuts titles to the protocol limit and drops control characters', () => {
    const remote = toRemoteAgentRow(row('pane:p1', { title: `a\nb${'x'.repeat(300)}` }), context())
    expect([...remote.title]).toHaveLength(200)
    expect(remote.title.startsWith('a b')).toBe(true)
  })

  it('sends a provider only when it is a plain id (SECURITY L1)', () => {
    expect(toRemoteAgentRow(row('pane:p1', { provider: 'codex' }), context()).provider).toBe('codex')
    expect(toRemoteAgentRow(row('pane:p1', { provider: 'claude-code.v2_beta' }), context()).provider).toBe('claude-code.v2_beta')
    for (const provider of ['Claude', 'my agent', 'C:/bin/agent', 'x'.repeat(65), 'a\u202eb', '']) {
      expect(toRemoteAgentRow(row('pane:p1', { provider }), context()), provider).not.toHaveProperty('provider')
    }
  })

  it('lets the phone answer only a conversation request it may answer, and stop only a running conversation', () => {
    const conversation = row('conversation:t1', { state: 'working', pendingRequest: { via: 'thread', id: 'r1', threadId: 't1', title: { code: 'agents.request.question', params: {} }, since: NOW, more: 0 } })
    expect(toRemoteAgentRow(conversation, context({ requestTitle: 'Has a question for you', requestAnswerable: true, canInterrupt: true }))).toMatchObject({
      threadId: 't1', canInterrupt: true, request: { threadId: 't1', requestId: 'r1', answerable: true }
    })
    expect(toRemoteAgentRow(conversation, context({ requestAnswerable: false })).request?.answerable).toBe(false)
    expect(toRemoteAgentRow(row('pane:p1', { state: 'working' }), context({ canInterrupt: true }))).toEqual(expect.not.objectContaining({ canInterrupt: true }))
    expect(toRemoteAgentRow(row('pane:p1'), context())).toMatchObject({ paneId: 'p1' })
  })

  it('narrows a request title to the parameterless title codes (SECURITY L2)', () => {
    expect(isAgentRequestTitle({ code: 'approvals.title.oxequery', params: {} })).toBe(true)
    expect(isAgentRequestTitle({ code: 'agents.request.tool', params: {} })).toBe(true)
    for (const value of [{ code: 'approvals.summary.mcpConfirm', params: { tool: 't', action: 'a', target: 'x' } }, { code: 'agents.request.tool', params: { text: 'agent text' } }, { code: 'agents.request.tool' }, null, 'agents.request.tool']) {
      expect(isAgentRequestTitle(value), JSON.stringify(value)).toBe(false)
    }
    for (const code of AGENT_REQUEST_TITLE_CODE_LIST) {
      expect(isMessageCode(code), code).toBe(true)
      for (const catalog of [enMain, ptMain]) expect(String(lookup(catalog, `messages.${code}`)), code).not.toMatch(/\{\{/)
    }
  })

  it('takes agent.markSeen strictly: exactly agentId (and observedSince), on the gateway id rule (SECURITY L3)', () => {
    expect(readRemoteMarkSeen({ agentId: 'conversation:3f1c-9a.b_c' })).toEqual({ ok: true, input: { key: 'conversation:3f1c-9a.b_c' } })
    expect(readRemoteMarkSeen({ agentId: 'work:r1', observedSince: NOW })).toEqual({ ok: true, input: { key: 'work:r1', observedSince: NOW } })
    const longest = `pane:${'a'.repeat(200 - 'pane:'.length)}`
    expect(readRemoteMarkSeen({ agentId: longest }).ok).toBe(true)
    for (const args of [null, [], {}, { key: 'pane:p1' }, { agentId: 'pane:p1', extra: 1 }, { agentId: `${longest}a` }, { agentId: 'pane:a b' }, { agentId: 'pane:é' }, { agentId: 'shell:x' },
      { agentId: 'pane:p1', observedSince: -1 }, { agentId: 'pane:p1', observedSince: 1.5 }, { agentId: 'pane:p1', observedSince: '1' }]) {
      expect(readRemoteMarkSeen(args), JSON.stringify(args)).toEqual({ ok: false, code: 'malformed' })
    }
    expect(agentMarkSeenAuditDetail({ key: 'conversation:t1' })).toEqual({ agentId: 'conversation:t1' })
    // Every key the desktop accepts is one the gateway accepts, and the other way round.
    for (const key of ['pane:p1', longest, 'pane:a b', `${longest}a`]) expect(parseAgentKey(key) !== null, key).toBe(REMOTE_AGENT_ID.test(key) && parseAgentKey(key) !== null)
  })
})

describe('agents frames stay under 64 KiB (ARCHITECT H2)', () => {
  /** The largest row the builder can make: every text at its limit in 4-byte characters, every id at 200. */
  const worst = (index: number): RemoteAgentRow => {
    const id = (prefix: string) => `${prefix}${String(index).padStart(6, '0')}`.padEnd(200, 'x')
    const wide = '\u{1F600}'.repeat(200)
    return {
      id: id('conversation:'), kind: 'conversation', state: 'needs-you', since: NOW, title: wide, provider: 'p'.repeat(64), workspaceName: wide,
      parentId: id('work:'), threadId: id(''), paneId: id(''),
      request: { threadId: id(''), requestId: id(''), title: wide, risk: 'critical', answerable: true, more: 999 }, tasks: { done: 99, total: 99 }, canInterrupt: true
    }
  }
  const frame = (data: unknown, last: boolean) => JSON.stringify({ type: 'snapshot', subscription: 's'.repeat(64), seq: Number.MAX_SAFE_INTEGER, schemaVersion: 1, data, cursor: `${'e'.repeat(36)}:${Number.MAX_SAFE_INTEGER}`, page: { index: 9_999, last } })
  const size = (text: string) => new TextEncoder().encode(text).byteLength

  it('pages a worst-case snapshot by bytes as well as by rows; only the last page carries unavailable and nudgeAfterMs', () => {
    const agents = Array.from({ length: 450 }, (_, index) => worst(index))
    const pages = pageRemoteAgents({ agents, unavailable: ['pane', 'conversation', 'delegation', 'work'], nudgeAfterMs: 300_000 })
    expect(pages.flatMap(page => page.agents)).toEqual(agents)
    for (const [index, page] of pages.entries()) {
      expect(size(frame(page, index === pages.length - 1)), `page ${index}`).toBeLessThanOrEqual(REMOTE_LIMITS.maxFrameBytes)
      expect(page.agents.length).toBeLessThanOrEqual(REMOTE_TEXT_LIMITS.agentsPage)
      expect('unavailable' in page || 'nudgeAfterMs' in page).toBe(index === pages.length - 1)
    }
    expect(pages.length).toBeGreaterThan(Math.ceil(450 / REMOTE_TEXT_LIMITS.agentsPage))
  })

  it('pages small rows by count', () => {
    const agents = Array.from({ length: 450 }, (_, index) => ({ id: `pane:p${index}`, kind: 'pane', state: 'idle', since: NOW, title: 't', workspaceName: 'w' }) as RemoteAgentRow)
    expect(pageRemoteAgents({ agents }).map(page => page.agents.length)).toEqual([200, 200, 50])
    expect(pageRemoteAgents({ agents: [] })).toEqual([{ agents: [] }])
  })

  it('splits a large change the same way: removals first, then upserts', () => {
    const upsert = Array.from({ length: 300 }, (_, index) => worst(index))
    const removed = Array.from({ length: 600 }, (_, index) => `pane:${String(index).padEnd(195, 'r')}`)
    const frames = splitRemoteAgentsEvent({ upsert, removed, unavailable: ['work'] })
    expect(frames.flatMap(item => item.removed ?? [])).toEqual(removed)
    expect(frames.flatMap(item => item.upsert ?? [])).toEqual(upsert)
    expect(frames[0].unavailable).toEqual(['work'])
    expect(frames.slice(1).every(item => !('unavailable' in item))).toBe(true)
    for (const item of frames) expect(size(frame(item, true).replace('"snapshot"', '"event"'))).toBeLessThanOrEqual(REMOTE_LIMITS.maxFrameBytes)
    expect(splitRemoteAgentsEvent({ unavailable: [] })).toEqual([{ unavailable: [] }])
  })

  it('resumes only within the same desktop run (cursor epoch:seq, ARCHITECT L4)', () => {
    const cursor = agentsCursor('run-a', 41)
    expect(readAgentsCursor(cursor, 'run-a')).toBe(41)
    for (const [value, epoch] of [[cursor, 'run-b'], ['41', 'run-a'], ['run-a:', 'run-a'], ['run-a:x', 'run-a'], [null, 'run-a']] as const) expect(readAgentsCursor(value, epoch)).toBeNull()
  })
})

describe('C5 unknown-value rule (coordinator ruling on ARCHITECT M1/Q5)', () => {
  const source = readFileSync(join(__dirname, '..', 'shared', 'remote', 'protocol.ts'), 'utf8')

  it('is written in the protocol header, and declared for the three sets', () => {
    const header = source.slice(0, source.indexOf('export const REMOTE_PROTOCOL_VERSION'))
    expect(header).toMatch(/does NOT bump the version/)
    expect(header).toMatch(/unknown state reads as\s+\*?\s*`unknown`/)
    expect(header).toMatch(/row of an unknown kind is dropped/)
    expect(header).toMatch(/unknown risk reads as `critical`/)
    expect(REMOTE_UNKNOWN_VALUES).toEqual({ RemoteAgentState: 'unknown', RemoteAgentKind: 'drop-row', RemoteApprovalRisk: 'critical' })
  })

  it('makes those fields strings in Kotlin, each with its read rule', () => {
    const kotlin: string = protocolKotlin(source, protocol)
    const row = kotlin.slice(kotlin.indexOf('data class RemoteAgentRow('), kotlin.indexOf('data class RemoteAgentsSnapshot('))
    expect(row).toContain('    val kind: String,\n')
    expect(row).toContain('    val state: String,\n')
    expect(row).toContain('        val risk: String? = null,\n')
    expect(kotlin).toContain('    val unavailable: List<String>? = null,')
    expect(kotlin).toContain('        fun read(wire: String): RemoteAgentState = fromWire(wire) ?: UNKNOWN')
    expect(kotlin).toContain('        fun read(wire: String): RemoteAgentKind? = fromWire(wire)')
    expect(kotlin).toContain('        fun read(wire: String): RemoteApprovalRisk = fromWire(wire) ?: CRITICAL')
    expect(kotlin).not.toContain('RemoteApprovalRisk? = wire?.let')
    // A set without a rule keeps its enum type and has no read().
    expect(kotlin).toContain('    val topic: RemoteSubscription,')
    expect(kotlin.slice(kotlin.indexOf('enum class RemoteSubscription'), kotlin.indexOf('enum class RemoteCommand'))).not.toContain('fun read(')
  })

  it('refuses a rule that names no set or no value', () => {
    expect(() => protocolKotlin(source, { ...protocol, REMOTE_UNKNOWN_VALUES: { RemoteNothing: 'null' } })).toThrow(/no list alias/)
    // The generator still knows the null rule, for a set where none is the safe reading.
    expect(protocolKotlin(source, { ...protocol, REMOTE_UNKNOWN_VALUES: { ...REMOTE_UNKNOWN_VALUES, RemoteApprovalRisk: 'null' } })).toContain('fun read(wire: String?): RemoteApprovalRisk? = wire?.let { fromWire(it) }')
    expect(() => protocolKotlin(source, { ...protocol, REMOTE_UNKNOWN_VALUES: { RemoteAgentState: 'gone' } })).toThrow(/not a value/)
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

  it('pushes source reports with a growing seq and rev', () => {
    const { double, changes } = make()
    double.drive({ action: 'set', key: 'pane:p2', state: 'needs-you' })
    double.drive({ action: 'remove', key: 'conversation:t3' })
    expect(changes.map(change => change.seq)).toEqual([1, 2])
    expect(changes[0].upsert?.[0]).toMatchObject({ key: 'pane:p2', state: 'needs-you', rev: 2, since: NOW })
    expect(changes[1].removed).toEqual(['conversation:t3'])
  })

  it('marks seen: finished becomes idle; unknown keys and bad input are refused', () => {
    const { double } = make()
    expect(double.markSeen({ key: 'work:r1' })).toEqual({ ok: true, key: 'work:r1', seenAt: NOW, state: 'idle' })
    expect(double.overview().rows.find(item => item.key === 'work:r1')).toMatchObject({ seen: true, lastSeenAt: NOW, state: 'idle' })
    expect(double.markSeen({ key: 'pane:nope' })).toMatchObject({ ok: false, refusal: 'notFound' })
    // A mark from a view older than the finish leaves the row Finished.
    double.drive({ action: 'set', key: 'work:r1', state: 'finished', since: NOW + 10 })
    expect(double.markSeen({ key: 'work:r1', observedSince: NOW - 1 })).toMatchObject({ ok: true, state: 'finished', seenAt: NOW })
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
