import { describe, expect, it } from 'vitest'
import { BACKGROUND_TRUST_MS, backgroundRunning, backgroundSummary } from '../../shared/threadBackground'
import { threadNavigationStatus } from '../../src/components/Threads/threadNavigationStatus'
import type { ConversationThread, ThreadEvent } from '../../shared/types/thread'

const NOW = 1_800_000_000_000
const task = (id: string, state: 'running' | 'completed', startedAt?: number): ThreadEvent => ({ type: 'subagent', id, action: 'Background command', state, receiverThreadIds: [], agents: [], ...(startedAt === undefined ? {} : { startedAt }) })
const thread = (change: Partial<ConversationThread>): ConversationThread => ({ id: 't', workspaceId: 'w', projectId: 'p', rootPath: '/r', provider: 'claude', nativeSessionId: null, title: 'T', pinned: false, status: 'idle', lastTurnStatus: 'completed', createdAt: 0, updatedAt: 0, ...change })

describe('background work in the thread summary', () => {
  it('counts the tasks still running and when the oldest started; finished and stale ones do not count', () => {
    expect(backgroundSummary([task('a', 'running', NOW - 5000), task('b', 'running', NOW - 1000), task('c', 'completed', NOW - 9000)], NOW)).toEqual({ running: 2, since: NOW - 5000 })
    expect(backgroundSummary([task('a', 'running', NOW - BACKGROUND_TRUST_MS - 1)], NOW)).toBeUndefined()
    expect(backgroundSummary([task('a', 'completed', NOW)], NOW)).toBeUndefined()
  })

  it('keeps a finished turn with background work out of "Completed" in the sidebar', () => {
    expect(threadNavigationStatus(thread({ background: { running: 1, since: Date.now() - 1000 } }))).toEqual({ kind: 'running', label: 'Background' })
    expect(threadNavigationStatus(thread({}))).toEqual({ kind: 'completed', label: 'Completed' })
    expect(backgroundRunning(thread({ background: { running: 1, since: Date.now() - BACKGROUND_TRUST_MS - 1 } }))).toBe(false)
    expect(threadNavigationStatus(thread({ status: 'approval', background: { running: 1, since: Date.now() } })).kind).toBe('attention')
  })
})
