import { describe, expect, test, vi } from 'vitest'
import { ThreadDelegationHost } from '../../electron/main/services/delegation/thread-delegation-host'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import type { DelegationTask } from '../../shared/types/delegation'
import type { ThreadManager } from '../../electron/main/services/conversation/thread-manager'

function task(): DelegationTask {
  return { id: 'task-1', schemaVersion: 2, key: 'key', agentProfileId: 'codex-profile', objective: 'Implement checkout', handoff: 'Use the persisted bundle', acceptance: 'Tests pass',
    mode: 'isolated-change', surface: 'thread', branchIntent: { strategy: 'create', name: 'feature/card-1' }, workspaceId: 'workspace', project: 'project',
    originPaneId: 'origin', originExecutionId: 'origin-execution', cwd: 'C:/repo', path: 'C:/repo-worktrees/card-1', branch: 'feature/card-1', baseSha: 'abc',
    localChanges: '', state: 'starting', createdAt: 1, updatedAt: 1 }
}

describe('ThreadDelegationHost', () => {
  test('does not repeat bootstrap after an uncertain dispatch or queue work into a live session', async () => {
    const delegated = task(); delegated.destinationThreadId = 'thread-1'
    const current = { rootPath: delegated.path, provider: 'codex', nativeSessionId: null, status: 'idle' }
    const send = vi.fn()
    const manager = { read: () => ({ thread: current, events: [{ type: 'message', role: 'user', text: 'original bootstrap' }] }), send } as unknown as ThreadManager
    const host = new ThreadDelegationHost(Promise.resolve(manager), new ExecutionRegistry(), () => 'codex')
    await expect(host.start(delegated)).rejects.toThrow('BOOTSTRAP_OUTCOME_UNKNOWN')
    current.status = 'running'
    await expect(host.start(delegated)).rejects.toThrow('ALREADY_ACTIVE')
    expect(send).not.toHaveBeenCalled()
  })

  test('recovers only the persisted destination conversation binding', async () => {
    const delegated = task(); delegated.destinationThreadId = 'thread-1'
    const current = { rootPath: delegated.path, provider: 'codex', nativeSessionId: 'exact-session' }
    const manager = { read: vi.fn(() => ({ thread: current, events: [] })) } as unknown as ThreadManager
    const host = new ThreadDelegationHost(Promise.resolve(manager), new ExecutionRegistry(), () => 'codex')
    expect(await host.inspect(delegated)).toMatchObject({ nativeSessionId: 'exact-session', canonicalRoot: delegated.path })
    current.rootPath = 'C:/another-project'
    await expect(host.inspect(delegated)).rejects.toThrow('ROOT_MISMATCH')
  })
  test('persists the Thread before bootstrap and returns its exact native binding', async () => {
    const execution = new ExecutionRegistry()
    const current = { id: 'thread-1', workspaceId: 'workspace', projectId: 'project', rootPath: 'C:/repo-worktrees/card-1', provider: 'codex' as const,
      nativeSessionId: null as string | null, title: 'New thread', pinned: false, status: 'idle' as const, createdAt: 1, updatedAt: 1, generation: 1, queue: [] }
    const manager = {
      create: vi.fn(() => ({ thread: current, events: [] })),
      configure: vi.fn(async () => ({ thread: current, events: [] })),
      read: vi.fn(() => ({ thread: current, events: [] })),
      send: vi.fn(async (_id: string, prompt: string) => {
        expect(prompt).toContain('oxespace_delegation_context')
        execution.register({ owner: { kind: 'thread', id: current.id }, workspaceId: current.workspaceId, cwd: current.rootPath })
        current.nativeSessionId = 'native-session-1'; current.status = 'running'
      })
    } as unknown as ThreadManager
    const host = new ThreadDelegationHost(Promise.resolve(manager), execution, () => 'codex')
    const delegated = task()
    const persisted = vi.fn((id: string) => { delegated.destinationThreadId = id })
    const result = await host.start(delegated, persisted)
    expect(persisted).toHaveBeenCalledWith('thread-1')
    expect(manager.send).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ threadId: 'thread-1', nativeSessionId: 'native-session-1', provider: 'codex', generation: 1 })
  })

  test('resume refuses a different native session instead of selecting a recent one', async () => {
    const delegated = task()
    delegated.destinationThreadId = 'thread-1'
    delegated.nativeSession = { provider: 'codex', nativeSessionId: 'expected', canonicalRoot: delegated.path, generation: 1, observedAt: 1, resumable: true }
    const manager = { read: () => ({ thread: { id: 'thread-1', rootPath: delegated.path, provider: 'codex', nativeSessionId: 'different' }, events: [] }) } as unknown as ThreadManager
    const host = new ThreadDelegationHost(Promise.resolve(manager), new ExecutionRegistry(), () => 'codex')
    await expect(host.resume(delegated)).rejects.toThrow('NATIVE_SESSION_MISMATCH')
  })
})
