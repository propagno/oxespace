import { describe, expect, it } from 'vitest'
import type { ConversationThread } from '../shared/types/thread'
import { threadNavigationStatus } from '../src/components/Threads/threadNavigationStatus'

const thread = (status: ConversationThread['status'], lastTurnStatus?: ConversationThread['lastTurnStatus']): ConversationThread => ({
  id: 'thread', workspaceId: 'workspace', projectId: 'project', rootPath: '/project', provider: 'codex',
  nativeSessionId: null, title: 'Example', pinned: false, status, ...(lastTurnStatus ? { lastTurnStatus } : {}), createdAt: 1, updatedAt: 1
})

describe('Thread navigation status', () => {
  it.each([
    ['idle', undefined, 'ready', 'Ready'],
    ['idle', 'completed', 'completed', 'Completed'],
    ['running', undefined, 'running', 'Running'],
    ['approval', undefined, 'attention', 'Needs input'],
    ['failed', undefined, 'failed', 'Failed'],
    ['interrupted', undefined, 'interrupted', 'Interrupted']
  ] as const)('maps %s and last turn %s to %s', (status, lastTurnStatus, kind, label) => {
    expect(threadNavigationStatus(thread(status, lastTurnStatus))).toEqual({ kind, label })
  })
})
