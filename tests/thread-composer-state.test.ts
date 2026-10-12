import { describe, expect, it } from 'vitest'
import { deriveThreadComposerState } from '../src/components/Threads/threadComposerState'
import type { ConversationThread } from '../shared/types/thread'

const thread = (value: Partial<ConversationThread> = {}): ConversationThread => ({ id: 'thread', workspaceId: 'workspace', projectId: 'project', rootPath: '/repo', provider: 'codex', title: 'Thread', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1, ...value })

describe('Thread composer state', () => {
  it('uses deterministic precedence for local action, provider state, connection and queue', () => {
    expect(deriveThreadComposerState(undefined, false)).toBe('disabled')
    expect(deriveThreadComposerState(thread({ cliActive: true }), false)).toBe('disabled')
    expect(deriveThreadComposerState(thread({ status: 'approval' }), true)).toBe('sending')
    expect(deriveThreadComposerState(thread({ status: 'approval' }), false)).toBe('approval')
    expect(deriveThreadComposerState(thread({ connection: { state: 'reconnecting', attempt: 2, changedAt: 1 } }), false)).toBe('reconnecting')
    expect(deriveThreadComposerState(thread({ queue: [{ id: 'q', text: 'x', createdAt: 1, state: 'unknown' }] }), false)).toBe('unknown')
    expect(deriveThreadComposerState(thread({ queue: [{ id: 'q', text: 'x', createdAt: 1, state: 'queued' }] }), false)).toBe('queued')
    expect(deriveThreadComposerState(thread({ status: 'running' }), false)).toBe('running')
    expect(deriveThreadComposerState(thread(), false)).toBe('idle')
  })
})
