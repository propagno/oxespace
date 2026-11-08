// Frozen acceptance test for the 1.5.0 F2 gap G6 (OXE program, phase F2, second batch; MOBILE's phone audit): once
// R13 removes the work source from the agents read model, the phone's agents topic never reports 'work' as unavailable
// and keeps no last rows for it, while a source that exists and fails is still reported. Written by the planner; the
// executor must not edit it. A fake desktop only, as in tests/unit/remote-agents.test.ts.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTopics } from '../../../electron/main/services/remote/topics'
import type { RemoteDesktop } from '../../../electron/main/services/remote/desktop'
import type { RemoteTopicFrame } from '../../../electron/main/services/remote/connection'
import { REMOTE_AGENT_SOURCES, type RemoteAgentsEvent, type RemoteAgentsSnapshot } from '../../../shared/remote/protocol'
import type { AgentRow, AgentsOverview } from '../../../shared/types/agents'
import { mainMessage } from '../../../shared/messages'
import { englishText } from '../../../electron/main/agent-text'

const ROOT = process.platform === 'win32' ? 'C:\\Users\\dev\\proj' : '/home/dev/proj'
afterEach(() => { vi.useRealTimers() })

function row(fields: Partial<AgentRow> = {}): AgentRow {
  return { kind: 'thread', id: 't1', state: 'working', provider: 'claude', mode: 'thread', title: 'Fix the build', workspaceId: 'ws', since: 100, seenAt: null, session: null, worktree: null, cost: null, requests: [], ...fields } as AgentRow
}
/** The sources a 1.5.0 overview reports: no 'work', since R13 removed it. */
const withoutWork = (failing: string[] = []) => Object.fromEntries(['panes', 'threads', 'delegations'].map(source => [source, failing.includes(source) ? { ok: false, reason: mainMessage('agents.source.unavailable', { source }) } : { ok: true, seq: 1 }])) as unknown as AgentsOverview['sources']
const everySource = () => ({ ...withoutWork(), work: { ok: true, seq: 1 } }) as unknown as AgentsOverview['sources']

function open(overview: () => AgentsOverview) {
  const listeners = new Set<() => void>()
  const desktop = {
    roots: () => [ROOT], agents: overview, messageText: englishText, pendingRequests: () => [], markAgentSeen: () => true,
    onAgentsChanged: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
  } as unknown as RemoteDesktop
  const frames: RemoteTopicFrame[] = []
  const topics = createTopics({ desktop, phoneWrite: () => new Set(), onWorkspacesChanged: () => () => {}, debounceMs: 10, pollMs: 60_000, now: () => 2_000 })
  const handle = topics.agents.open({ deviceId: 'd1' }, frame => frames.push(frame))!
  return { frames, handle, changed: () => { for (const listener of listeners) listener() } }
}

describe('G6 · the phone\'s agents topic after Work is gone', () => {
  test('G6: the protocol still lists work for older phones', () => {
    expect(REMOTE_AGENT_SOURCES).toContain('work')
  })

  test('G6: an overview without a work source never makes work unavailable, on the snapshot or on an event', async () => {
    vi.useFakeTimers()
    let rows = [row()]
    const { frames, handle, changed } = open(() => ({ agents: rows, sources: withoutWork() }))
    expect((frames[0].data as RemoteAgentsSnapshot).unavailable).toEqual([])
    rows = [row({ state: 'finished' })]
    changed()
    await vi.advanceTimersByTimeAsync(20)
    expect((frames[1].data as RemoteAgentsEvent).unavailable).toEqual([])
    handle.close()
  })

  test('G6: a work row seen earlier is removed, not kept forever as a "last row"', async () => {
    vi.useFakeTimers()
    let upgraded = false
    const { frames, handle, changed } = open(() => upgraded
      ? { agents: [row()], sources: withoutWork() }
      : { agents: [row(), row({ kind: 'work', id: 'w1', mode: 'code', provider: 'other' } as Partial<AgentRow>)], sources: everySource() })
    expect((frames[0].data as RemoteAgentsSnapshot).rows.map(item => item.id).sort()).toEqual(['t1', 'w1'])
    upgraded = true
    changed()
    await vi.advanceTimersByTimeAsync(20)
    const event = frames[1].data as RemoteAgentsEvent
    expect(event.unavailable).toEqual([])
    expect((event.removed ?? []).map(key => `${key.kind}:${key.id}`)).toEqual(['work:w1'])
    handle.close()
  })

  test('G6: a source that exists and fails is still reported', () => {
    const { frames, handle } = open(() => ({ agents: [row()], sources: withoutWork(['panes']) }))
    expect(frames[0].data).toMatchObject({ unavailable: ['panes'], rows: [{ id: 't1' }] })
    handle.close()
  })
})
