import { describe, expect, it } from 'vitest'
import { deriveThreadLiveActivity, usualToolRun } from '../src/components/Threads/ThreadLiveActivity'
import type { ThreadSnapshot } from '../shared/types/thread'

function fixture(): ThreadSnapshot {
  return {
    thread: { id: 'thread', workspaceId: 'workspace', projectId: 'project', rootPath: '/project', provider: 'codex',
      nativeSessionId: 'native', title: 'Inspect', pinned: false, status: 'running', createdAt: 1_000, updatedAt: 1_000,
      connection: { state: 'connected', attempt: 0, changedAt: 1_000, lastHeartbeatAt: 1_000 } },
    turns: [{ id: 'turn', sequence: 1, status: 'running', startedAt: 1_000, configuration: {} }],
    events: [{ type: 'message', id: 'turn', role: 'user', text: 'Inspect' }, { type: 'activity', id: 'preparing', phase: 'preparing', at: 1_000 }]
  }
}

describe('live Thread activity', () => {
  it('times the running step and says when it takes much longer than usual here', () => {
    const snapshot = fixture()
    // Earlier test runs in this conversation took 10 to 20 seconds.
    snapshot.events.push(
      { type: 'tool', id: 'a', name: 'Bash', state: 'completed', detail: 'npm test', startedAt: 1_000, completedAt: 11_000 },
      { type: 'tool', id: 'b', name: 'Bash', state: 'completed', detail: 'npm test', startedAt: 12_000, completedAt: 32_000 },
      { type: 'tool', id: 'c', name: 'Bash', state: 'running', detail: 'npm test', startedAt: 40_000 })
    expect(usualToolRun(snapshot.events, 'Bash')).toBe(20_000)
    expect(deriveThreadLiveActivity(snapshot, 82_000)).toMatchObject({ toolElapsed: '42s', slowTool: false })
    expect(deriveThreadLiveActivity(snapshot, 101_000)).toMatchObject({ toolElapsed: '1m 01s', slowTool: true })
    // A first run has nothing to compare with: slow only after the 30 s floor.
    expect(usualToolRun(snapshot.events, 'Grep')).toBeNull()
  })
  it('does not mistake earlier assistant text for current output and summarizes structured commands', () => {
    const snapshot = fixture()
    snapshot.events.push({ type: 'message', id: 'comment', role: 'assistant', text: 'I will inspect' }, { type: 'activity', id: 'think', phase: 'reasoning', at: 2000 })
    expect(deriveThreadLiveActivity(snapshot, 3000)?.label).toBe('Analyzing request')
    snapshot.events.push({ type: 'tool', id: 'shell', name: 'Bash', state: 'running', detail: JSON.stringify({ command: 'npm test' }, null, 2) })
    expect(deriveThreadLiveActivity(snapshot, 3000)?.label).toBe('Running command: npm test')
  })
  it('reports the observed phase and does not mistake a long silent turn for confirmed failure', () => {
    const snapshot = fixture()
    expect(deriveThreadLiveActivity(snapshot, 10_000)).toMatchObject({ label: 'Preparing project context', elapsed: '9s', stale: false })
    expect(deriveThreadLiveActivity(snapshot, 62_000)).toMatchObject({ stale: true, signalAge: 'No provider signal yet · 1m 01s' })
    snapshot.thread.connection!.lastNativeSignalAt = 60_000
    expect(deriveThreadLiveActivity(snapshot, 62_000)).toMatchObject({ stale: false, signalAge: 'Last provider signal 2s ago' })
  })

  it('prioritizes a running tool and an approval over earlier reasoning summaries', () => {
    const snapshot = fixture()
    snapshot.events.push({ type: 'activity', id: 'reasoning', phase: 'reasoning', at: 1_500, summary: 'Checking the dependency graph.' })
    expect(deriveThreadLiveActivity(snapshot, 2_000)).toMatchObject({ label: 'Analyzing request' })
    snapshot.events.push({ type: 'tool', id: 'command', name: 'commandExecution', state: 'running', detail: 'npm test', startedAt: 2_000 })
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toMatchObject({ label: 'Running command: npm test' })
    snapshot.thread.status = 'approval'
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toMatchObject({ label: 'Waiting for your input', stale: false })
    snapshot.thread.status = 'idle'
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toBeNull()
  })

  it('marks a wait as answerable only while a request is there to answer', () => {
    const snapshot = fixture()
    snapshot.thread.status = 'approval'
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toMatchObject({ awaitingInput: true, actionableRequest: false })
    snapshot.pendingRequests = [{ id: 'r', nativeId: 'r', nativeMethod: 'x', kind: 'approval', title: 'Allow', generation: 0, createdAt: 2_000, state: 'pending' }]
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toMatchObject({ awaitingInput: true, actionableRequest: true })
  })

  it('does not show a finished turn as waiting for a provider update because a background task never reported its end', () => {
    const snapshot = fixture()
    snapshot.thread.status = 'idle'
    snapshot.turns![0].status = 'completed'
    snapshot.events.push({ type: 'subagent', id: 'task', action: 'Background command', state: 'running', receiverThreadIds: ['t'], agents: [], startedAt: 5_000 })
    const hour = 3_600_000
    expect(deriveThreadLiveActivity(snapshot, 5_000 + 20 * 60_000)).toMatchObject({ label: 'Waiting for 1 background task', stale: false, elapsed: '20m 00s' })
    expect(deriveThreadLiveActivity(snapshot, 5_000 + 3 * hour)).toBeNull()
  })
})
