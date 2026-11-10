// Frozen acceptance test for 1.5.0 CR-34 (OXE program, phase F10, task BE-CR34), TECH LEAD 08/11: a pane hidden from the
// phone never reaches it through the agents topic either, neither in the snapshot nor in an event, and it comes back
// when shown again. The same privacy promise as the terminal and the conversation. Written by the planner; the executor
// must not edit it. A fake desktop only, as in tests/unit/remote-agents.test.ts and F2's G6 test.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTopics } from '../../../electron/main/services/remote/topics'
import type { RemoteDesktop } from '../../../electron/main/services/remote/desktop'
import type { RemoteTopicFrame } from '../../../electron/main/services/remote/connection'
import type { RemoteAgentsEvent, RemoteAgentsSnapshot } from '../../../shared/remote/protocol'
import type { AgentRow, AgentsOverview } from '../../../shared/types/agents'
import { englishText } from '../../../electron/main/agent-text'

const ROOT = process.platform === 'win32' ? 'C:\\Users\\dev\\proj' : '/home/dev/proj'
afterEach(() => { vi.useRealTimers() })

function row(fields: Partial<AgentRow>): AgentRow {
  return { kind: 'pane', id: 'p1', state: 'working', provider: 'claude', mode: 'code', title: 'Build', workspaceId: 'ws', since: 100, seenAt: null, session: null, worktree: null, cost: null, requests: [], ...fields } as AgentRow
}
const sources = () => Object.fromEntries(['panes', 'threads', 'delegations'].map(source => [source, { ok: true, seq: 1 }])) as unknown as AgentsOverview['sources']

function open(rows: () => AgentRow[], hidden: Set<string>) {
  const listeners = new Set<() => void>()
  const desktop = {
    roots: () => [ROOT], agents: () => ({ agents: rows(), sources: sources() }), messageText: englishText, pendingRequests: () => [], markAgentSeen: () => true,
    onAgentsChanged: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
  } as unknown as RemoteDesktop
  const frames: RemoteTopicFrame[] = []
  const topics = createTopics({ desktop, phoneWrite: () => new Set(), phoneHidden: () => hidden, onWorkspacesChanged: () => () => {}, debounceMs: 10, pollMs: 60_000, now: () => 2_000 })
  const handle = topics.agents.open({ deviceId: 'd1' }, frame => frames.push(frame))!
  return { frames, handle, changed: () => { for (const listener of listeners) listener() } }
}
const keys = (items: Array<{ kind: string; id: string }> | undefined) => (items ?? []).map(item => `${item.kind}:${item.id}`).sort()

describe('CR-34 · the agents topic keeps a hidden pane off the phone', () => {
  test('CR-34: a hidden pane\'s row is not in the snapshot; the other pane and the conversation are', () => {
    const { frames, handle } = open(() => [row({ id: 'p1' }), row({ id: 'p2', title: 'Shell' }), row({ kind: 'thread', id: 't1', mode: 'thread', title: 'Chat' })], new Set(['p1']))
    const snapshot = frames[0].data as RemoteAgentsSnapshot
    expect(keys(snapshot.rows)).toEqual(['pane:p2', 'thread:t1'])
    expect(JSON.stringify(snapshot)).not.toContain('Build')
    handle.close()
  })

  test('CR-34: hiding a pane later removes its row on the next event, and its changes while hidden are never sent', async () => {
    vi.useFakeTimers()
    const hidden = new Set<string>()
    let state: AgentRow['state'] = 'working'
    const { frames, handle, changed } = open(() => [row({ id: 'p1', state }), row({ id: 'p2', title: 'Shell' })], hidden)
    expect(keys((frames[0].data as RemoteAgentsSnapshot).rows)).toEqual(['pane:p1', 'pane:p2'])
    hidden.add('p1')
    changed()
    await vi.advanceTimersByTimeAsync(20)
    const removal = frames.at(-1)!.data as RemoteAgentsEvent
    expect(keys(removal.removed)).toEqual(['pane:p1'])
    expect(keys(removal.upsert)).not.toContain('pane:p1')
    const sent = frames.length
    state = 'blocked'
    changed()
    await vi.advanceTimersByTimeAsync(20)
    for (const frame of frames.slice(sent)) expect(keys((frame.data as RemoteAgentsEvent).upsert)).not.toContain('pane:p1')
    handle.close()
  })

  test('CR-34: shown again, the pane\'s row comes back with its current state, not the one it had when hidden', async () => {
    vi.useFakeTimers()
    const hidden = new Set<string>()
    let state: AgentRow['state'] = 'working'
    const { frames, handle, changed } = open(() => [row({ id: 'p1', state }), row({ id: 'p2', title: 'Shell' })], hidden)
    expect((frames[0].data as RemoteAgentsSnapshot).rows.find(item => item.id === 'p1')).toMatchObject({ state: 'working' })
    hidden.add('p1')
    changed()
    await vi.advanceTimersByTimeAsync(20)
    expect(keys((frames.at(-1)!.data as RemoteAgentsEvent).removed)).toEqual(['pane:p1'])
    // It finishes while hidden: nothing of that is sent.
    state = 'finished'
    changed()
    await vi.advanceTimersByTimeAsync(20)
    hidden.delete('p1')
    changed()
    await vi.advanceTimersByTimeAsync(20)
    const back = frames.at(-1)!.data as RemoteAgentsEvent
    expect(keys(back.upsert)).toContain('pane:p1')
    expect(back.upsert?.find(item => item.id === 'p1')).toMatchObject({ kind: 'pane', id: 'p1', state: 'finished' })
    handle.close()
  })
})
