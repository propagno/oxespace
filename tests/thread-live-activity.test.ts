import { describe, expect, it } from 'vitest'
import { deriveThreadLiveActivity } from '../src/components/Threads/ThreadLiveActivity'
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
    expect(deriveThreadLiveActivity(snapshot, 2_000)).toMatchObject({ label: 'Analyzing request', summary: 'Checking the dependency graph.' })
    snapshot.events.push({ type: 'tool', id: 'command', name: 'commandExecution', state: 'running', detail: 'npm test', startedAt: 2_000 })
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toMatchObject({ label: 'Running command: npm test' })
    snapshot.thread.status = 'approval'
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toMatchObject({ label: 'Waiting for your input', stale: false })
    snapshot.thread.status = 'idle'
    expect(deriveThreadLiveActivity(snapshot, 3_000)).toBeNull()
  })
})
