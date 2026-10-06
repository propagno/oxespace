import { describe, expect, it } from 'vitest'
import { settleVolatileThreadSnapshot } from '../../electron/main/services/conversation/thread-recovery.service'
import type { ThreadSnapshot } from '../../shared/types/thread'

function runningSnapshot(): ThreadSnapshot {
  return {
    thread: {
      id: 'thread', workspaceId: 'workspace', projectId: 'project', rootPath: '/repo', provider: 'codex',
      nativeSessionId: 'native', title: 'Fault fixture', pinned: false, status: 'approval', cliActive: true,
      createdAt: 1, updatedAt: 1, generation: 7,
      queue: [{ id: 'queue', operationId: 'queue-op', text: 'Next', createdAt: 2, state: 'sending' }]
    },
    turns: [{ id: 'turn', operationId: 'turn-op', sequence: 1, startedAt: 2, status: 'running', configuration: {} }],
    events: [
      { type: 'message', id: 'turn', role: 'user', text: 'Work' },
      { type: 'tool', id: 'tool', name: 'command', state: 'running', detail: 'npm test', files: [{ path: 'a.ts', kind: 'update', source: 'native-patch', state: 'running' }] },
      { type: 'request', id: 'request', request: { id: 'request', nativeId: 'native-request', nativeMethod: 'approve', kind: 'approval', title: 'Approve', generation: 7, createdAt: 2, state: 'pending' } },
      { type: 'approval', id: 'approval', title: 'Approve', detail: 'command' },
      { type: 'subagent', id: 'agent', action: 'spawn', state: 'running', receiverThreadIds: ['child'], agents: [{ threadId: 'child', status: 'running' }] },
      { type: 'turn-diff', id: 'diff', turnId: 'native-turn', files: [{ path: 'b.ts', kind: 'add', source: 'native-patch', state: 'running' }] }
    ]
  }
}

describe('Thread fault corpus', () => {
  it.each(['restart', 'shutdown'] as const)('settles every volatile phase after %s without replaying queue delivery', cause => {
    const snapshot = runningSnapshot()
    settleVolatileThreadSnapshot(snapshot, cause, 99)
    expect(snapshot.thread).toMatchObject({ status: 'interrupted', cliActive: false, queue: [{ state: 'unknown' }] })
    expect(snapshot.thread.providerObservation).toMatchObject({ state: 'unknown', source: 'unavailable', observedAt: 99 })
    expect(snapshot.turns?.[0]).toMatchObject({ status: 'interrupted', completedAt: 99 })
    expect(snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool', state: 'unknown', completedAt: 99 }),
      expect.objectContaining({ type: 'request-resolved', id: 'request', state: 'cancelled' }),
      expect.objectContaining({ type: 'approval-resolved', id: 'approval' }),
      expect.objectContaining({ type: 'subagent', state: 'unknown', completedAt: 99 }),
      expect.objectContaining({ type: 'completed', status: 'interrupted' })
    ]))
    const diff = snapshot.events.find(event => event.type === 'turn-diff')
    expect(diff?.type === 'turn-diff' ? diff.files[0].state : undefined).toBe('unknown')
  })
})
