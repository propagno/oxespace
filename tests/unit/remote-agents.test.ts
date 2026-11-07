import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REMOTE_AGENT_KINDS, REMOTE_AGENT_SOURCES, REMOTE_AGENT_STATES, REMOTE_APPROVAL_RISKS, REMOTE_COMMANDS, REMOTE_SUBSCRIPTIONS,
  type RemoteAgentKey, type RemoteAgentRow, type RemoteAgentsEvent, type RemoteAgentsSnapshot
} from '../../shared/remote/protocol'
import { AGENT_KINDS, AGENT_SOURCES, AGENT_STATES, type AgentRow, type AgentsOverview } from '../../shared/types/agents'
import { APPROVAL_RISKS } from '../../shared/types/approvals'
import { mainMessage } from '../../shared/messages'
import { AgentRevisions, createTopics } from '../../electron/main/services/remote/topics'
import { toRemoteAgent } from '../../electron/main/services/remote/filters'
import { parseCommandArgs, RemoteCommands, auditDetail } from '../../electron/main/services/remote/commands'
import type { RemoteTopicFrame } from '../../electron/main/services/remote/connection'
import type { RemoteDesktop } from '../../electron/main/services/remote/desktop'
import { englishText } from '../../electron/main/agent-text'

/** S7.1 step 5: the phone's `agents` topic and `agent.markSeen` (CCR #513 §6). */

const ROOT = process.platform === 'win32' ? 'C:\\Users\\dev\\proj' : '/home/dev/proj'
const ok = (seq = 1) => Object.fromEntries(AGENT_SOURCES.map(source => [source, { ok: true, seq }])) as AgentsOverview['sources']

function row(fields: Partial<AgentRow> = {}): AgentRow {
  return {
    kind: 'thread', id: 't1', state: 'working', provider: 'claude', mode: 'thread', title: 'Fix the build', workspaceId: 'ws', since: 100,
    seenAt: null, session: 'native-secret-session', worktree: { path: `${ROOT}/wt`, branch: 'b' }, cost: { usd: 3.5 }, requests: [], ...fields
  }
}

function fakeDesktop(overview: () => AgentsOverview) {
  const listeners = new Set<() => void>()
  const marked: unknown[] = []
  const desktop = {
    roots: () => [ROOT],
    agents: overview,
    onAgentsChanged: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    markAgentSeen: (key: unknown) => { marked.push(key); return true },
    messageText: englishText,
    pendingRequests: () => []
  } as unknown as RemoteDesktop
  return { desktop, marked, changed: () => { for (const listener of listeners) listener() }, listening: () => listeners.size }
}

afterEach(() => { vi.useRealTimers() })

describe('the C5 agents contract', () => {
  it('carries the desktop\'s states, kinds, sources and risk words, in the same order', () => {
    expect([...REMOTE_AGENT_STATES]).toEqual([...AGENT_STATES])
    expect([...REMOTE_AGENT_KINDS]).toEqual([...AGENT_KINDS])
    expect([...REMOTE_AGENT_SOURCES]).toEqual([...AGENT_SOURCES])
    expect([...REMOTE_APPROVAL_RISKS]).toEqual([...APPROVAL_RISKS])
    // The wire words are written out (the phone reads them as text, MOBILE review); they must be exactly the lists.
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
    const wire: [
      Same<RemoteAgentRow['state'], typeof REMOTE_AGENT_STATES[number]>,
      Same<RemoteAgentRow['kind'], typeof REMOTE_AGENT_KINDS[number]>,
      Same<RemoteAgentKey['kind'], typeof REMOTE_AGENT_KINDS[number]>,
      Same<RemoteAgentsSnapshot['unavailable'][number], typeof REMOTE_AGENT_SOURCES[number]>,
      Same<RemoteAgentsEvent['unavailable'][number], typeof REMOTE_AGENT_SOURCES[number]>
    ] = [true, true, true, true, true]
    expect(wire).toEqual([true, true, true, true, true])
    expect(REMOTE_SUBSCRIPTIONS).toContain('agents')
    expect(REMOTE_COMMANDS).toContain('agent.markSeen')
  })

  it('a row never carries a path, a worktree, a session or a cost; the request title is main\'s, never the agent\'s', () => {
    const remote = toRemoteAgent(row({
      title: `Edit ${ROOT}/src/secret.ts`,
      requests: [
        { requestId: 'r2', title: mainMessage('agents.request.tool', {}), risk: 'high', answerable: true, since: 50 },
        { requestId: 'r1', title: mainMessage('agents.request.approval', {}), risk: null, answerable: false, since: 10 }
      ]
    }), 7, [ROOT], englishText)
    const text = JSON.stringify(remote)
    for (const leak of ['native-secret-session', 'worktree', 'cost', '3.5', `${ROOT}`, 'seenAt', 'workspaceId', 'mode']) expect(text, leak).not.toContain(leak)
    expect(remote).toMatchObject({ kind: 'thread', id: 't1', rev: 7, state: 'working', provider: 'claude', since: 100 })
    // The oldest request, with its C3 code beside main's English words.
    expect(remote.request).toEqual({ requestId: 'r1', title: 'Waiting for your approval', titleCode: 'agents.request.approval', titleParams: {}, risk: null, answerable: false })
  })
})

describe('what the phone is told about a request (SECURITY #531 L1, L3, L4)', () => {
  it('cleans string parameters like any remote text, keeps numbers and drops anything else', () => {
    const title = { code: 'worktree.removed', params: { path: `${ROOT}/wt/secret`, count: 3, nested: { x: 1 } } } as unknown as AgentRow['requests'][number]['title']
    const remote = toRemoteAgent(row({ kind: 'pane', id: 'p1', requests: [{ requestId: 'r', title, risk: null, answerable: false, since: 1 }] }), 1, [ROOT], englishText)
    expect(JSON.stringify(remote.request?.titleParams)).not.toContain(ROOT)
    expect(remote.request?.titleParams).toMatchObject({ count: 3 })
    expect(remote.request?.titleParams).not.toHaveProperty('nested')
  })

  it('a conversation request takes the risk and answerability of the phone pending list, else none', () => {
    const requests = [{ requestId: 'r1', title: mainMessage('agents.request.approval', {}), risk: null, answerable: true, since: 1 }]
    const listed = toRemoteAgent(row({ requests }), 1, [ROOT], englishText, () => ({ risk: 'high', answerable: true }))
    expect(listed.request).toMatchObject({ risk: 'high', answerable: true })
    const unlisted = toRemoteAgent(row({ requests }), 1, [ROOT], englishText, () => undefined)
    expect(unlisted.request).toMatchObject({ risk: null, answerable: false })
  })
})

describe('revisions', () => {
  const remote = (fields: Partial<AgentRow> = {}) => toRemoteAgent(row(fields), 0, [ROOT], englishText)

  it('rise on every change, stay on no change, and a removal gets a later one than anything before it', () => {
    const book = new AgentRevisions(1_000)
    const [first] = book.update([remote()])
    expect(first.rev).toBe(1_000_001)
    expect(book.update([remote()])[0].rev).toBe(first.rev)
    const [changed] = book.update([remote({ state: 'needs-you' })])
    expect(changed.rev).toBeGreaterThan(first.rev)
    book.update([])
    const removed = book.removedAt('thread:t1')
    expect(removed).toBeGreaterThan(changed.rev)
    expect(book.removedAt('thread:t1'), 'the same tombstone each time').toBe(removed)
    // Back again: later than its removal, so a phone holding the tombstone takes it.
    const [back] = book.update([remote()])
    expect(back.rev).toBeGreaterThan(removed)
  })

  it('never go back across a restart: the counter is seeded from the clock', () => {
    const before = new AgentRevisions(5_000)
    for (let index = 0; index < 50; index++) before.update([remote({ since: index })])
    const after = new AgentRevisions(5_001)
    expect(after.update([remote()])[0].rev).toBeGreaterThan(before.update([remote({ since: 999 })])[0].rev)
  })
})

describe('the agents topic', () => {
  function open(desktop: RemoteDesktop, cursor?: string) {
    const frames: RemoteTopicFrame[] = []
    const topics = createTopics({ desktop, phoneWrite: () => new Set(), onWorkspacesChanged: () => () => {}, debounceMs: 10, pollMs: 60_000, now: () => 2_000 })
    const handle = topics.agents.open({ deviceId: 'd1', ...(cursor ? { cursor } : {}) }, frame => frames.push(frame))
    return { frames, handle: handle!, topics }
  }

  it('sends a snapshot, then only what changed and what left, each with its rev; a cursor resumes there', async () => {
    vi.useFakeTimers()
    let rows = [row(), row({ kind: 'pane', id: 'p1', mode: 'code', state: 'needs-you', requests: [{ requestId: 'pane:p1:1', title: mainMessage('agents.request.pane', {}), risk: null, answerable: false, since: 5 }] })]
    const fake = fakeDesktop(() => ({ agents: rows, sources: ok() }))
    const { frames, handle } = open(fake.desktop)
    const snapshot = frames[0].data as RemoteAgentsSnapshot
    expect(frames[0].kind).toBe('snapshot')
    expect(snapshot.unavailable).toEqual([])
    expect(snapshot.rows.map(item => `${item.kind}:${item.id}`)).toEqual(['thread:t1', 'pane:p1'])
    const revs = new Map(snapshot.rows.map(item => [item.id, item.rev]))

    rows = [row({ state: 'finished' })]
    fake.changed()
    await vi.advanceTimersByTimeAsync(20)
    const event = frames[1].data as RemoteAgentsEvent
    expect(frames[1].kind).toBe('event')
    expect(event.upsert?.map(item => [item.id, item.state])).toEqual([['t1', 'finished']])
    expect(event.upsert![0].rev).toBeGreaterThan(revs.get('t1')!)
    expect(event.removed).toEqual([{ kind: 'pane', id: 'p1', rev: expect.any(Number) }])
    expect(event.removed![0].rev).toBeGreaterThan(revs.get('p1')!)

    // Nothing changed: nothing is sent.
    fake.changed()
    await vi.advanceTimersByTimeAsync(20)
    expect(frames).toHaveLength(2)
    handle.close()
    expect(fake.listening()).toBe(0)
  })

  it('a resumed cursor sends only what changed since; an unknown one gets a snapshot', async () => {
    let rows = [row()]
    const fake = fakeDesktop(() => ({ agents: rows, sources: ok() }))
    const { topics, frames, handle } = open(fake.desktop)
    const cursor = frames[0].cursor!
    handle.close()
    rows = [row(), row({ kind: 'work', id: 'w1', mode: 'code', provider: 'other' })]
    const later: RemoteTopicFrame[] = []
    topics.agents.open({ deviceId: 'd1', cursor }, frame => later.push(frame))!.close()
    expect(later[0].kind).toBe('event')
    expect((later[0].data as RemoteAgentsEvent).upsert?.map(item => item.id)).toEqual(['w1'])
    const fresh: RemoteTopicFrame[] = []
    topics.agents.open({ deviceId: 'd1', cursor: 'a.unknown' }, frame => fresh.push(frame))!.close()
    expect(fresh[0].kind).toBe('snapshot')
  })

  it('a source that fails keeps its last rows instead of removing them (SECURITY #531 L5)', async () => {
    vi.useFakeTimers()
    let failing = false
    const fake = fakeDesktop(() => ({
      agents: failing ? [row()] : [row(), row({ kind: 'pane', id: 'p1', mode: 'code' })],
      sources: failing ? { ...ok(), panes: { ok: false, reason: mainMessage('agents.source.unavailable', { source: 'panes' }) } } : ok()
    }))
    const { frames, handle } = open(fake.desktop)
    failing = true
    fake.changed()
    await vi.advanceTimersByTimeAsync(20)
    const event = frames[1].data as RemoteAgentsEvent
    expect(event.removed ?? []).toEqual([])
    expect(event.unavailable).toEqual(['panes'])
    handle.close()
  })

  it('names a source that could not be read, and still sends the others', () => {
    const fake = fakeDesktop(() => ({ agents: [row()], sources: { ...ok(), panes: { ok: false, reason: mainMessage('agents.source.unavailable', { source: 'panes' }) } } }))
    const { frames, handle } = open(fake.desktop)
    expect(frames[0].data).toMatchObject({ unavailable: ['panes'], rows: [{ id: 't1' }] })
    handle.close()
  })

  it('pages a long list under the frame cap', () => {
    const many = Array.from({ length: 400 }, (_, index) => row({ id: `t${index}`, title: 'x'.repeat(400) }))
    const fake = fakeDesktop(() => ({ agents: many, sources: ok() }))
    const { frames, handle } = open(fake.desktop)
    expect(frames.length).toBeGreaterThan(1)
    expect(frames.every(frame => frame.kind === 'snapshot')).toBe(true)
    expect(frames.flatMap(frame => (frame.data as RemoteAgentsSnapshot).rows).length).toBe(400)
    expect(frames.at(-1)?.cursor).toBeDefined()
    handle.close()
  })
})

describe('agent.markSeen', () => {
  it('reads its args strictly', () => {
    expect(parseCommandArgs('agent.markSeen', { kind: 'work', id: 'run-1' })).toEqual({ kind: 'work', id: 'run-1' })
    for (const bad of [null, {}, { kind: 'work' }, { kind: 'session', id: 'x' }, { kind: 'work', id: '' }, { kind: 'work', id: 'a b' }, { kind: 'work', id: 'x', extra: 1 }, { kind: 'work', id: 'x'.repeat(201) }]) {
      expect(() => parseCommandArgs('agent.markSeen', bad), JSON.stringify(bad)).toThrow()
    }
    expect(auditDetail('agent.markSeen', { kind: 'work', id: 'run-1' })).toBe('agent.markSeen work run-1')
  })

  it('is ok for any well-formed key, known or not, and refuses a malformed one', async () => {
    const fake = fakeDesktop(() => ({ agents: [], sources: ok() }))
    const commands = new RemoteCommands({ desktop: fake.desktop, now: () => 0, phoneWrite: () => new Set() })
    expect(await commands.run('d1', 'agent.markSeen', { kind: 'thread', id: 'nobody' })).toEqual({ ok: true })
    expect(await commands.run('d1', 'agent.markSeen', { kind: 'nope', id: 'x' })).toEqual({ ok: false, code: 'malformed' })
    expect(fake.marked).toEqual([{ kind: 'thread', id: 'nobody' }])
  })
})
