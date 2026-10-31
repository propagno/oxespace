import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { Workspace } from '../shared/types/workspace'
import type { ConversationThread } from '../shared/types/thread'

const toast = vi.fn()
vi.mock('../src/ui/Toast', () => ({ toast: (input: unknown) => toast(input) }))

const { optimistic } = await import('../src/store/optimistic')
const { useThreadStore } = await import('../src/store/thread.store')
const { useWorkspaceStore } = await import('../src/store/workspace.store')

interface Counter { count: number; label: string }
const counterStore = () => create<Counter>(() => ({ count: 0, label: 'a' }))
const lastToast = () => toast.mock.calls.at(-1)?.[0] as { title: string; intent: string; action: { label: string; run: () => void } }

beforeEach(() => toast.mockClear())

describe('optimistic', () => {
  it('shows the change before the save finishes and keeps the reconciled answer', async () => {
    const store = counterStore()
    let finish!: (value: number) => void
    const done = optimistic(store.setState, store.getState, state => ({ count: state.count + 1 }), () => new Promise<number>(resolve => { finish = resolve }),
      { rollbackMessage: 'Could not count', reconcile: value => ({ count: value }) })
    expect(store.getState().count).toBe(1)
    finish(5)
    await expect(done).resolves.toBe(5)
    expect(store.getState().count).toBe(5)
    expect(toast).not.toHaveBeenCalled()
  })

  it('restores only the keys it wrote and offers to try again', async () => {
    const store = counterStore()
    const commit = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce('ok')
    const done = optimistic(store.setState, store.getState, () => ({ count: 1 }), commit, { rollbackMessage: 'Could not count' })
    store.setState({ label: 'b' })
    await expect(done).resolves.toBeUndefined()
    expect(store.getState()).toMatchObject({ count: 0, label: 'b' })
    expect(lastToast()).toMatchObject({ title: 'Could not count', intent: 'danger', action: { label: 'Try again' } })
    lastToast().action.run()
    await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(2))
    expect(store.getState().count).toBe(1)
  })

  it('uses revert against the current state and rethrows without a toast when asked', async () => {
    const store = counterStore()
    const done = optimistic(store.setState, store.getState, state => ({ count: state.count + 1 }), () => Promise.reject(new Error('no')),
      { rollbackMessage: 'Could not count', rethrow: true, revert: state => ({ count: state.count - 1 }) })
    store.setState({ count: 10 })
    await expect(done).rejects.toThrow('no')
    expect(store.getState().count).toBe(9)
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('optimistic flows with a failed save', () => {
  it('pins a conversation at once and unpins it again when the save fails', async () => {
    const thread = { id: 't', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'codex', title: 'T', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 } as ConversationThread
    let fail!: (error: Error) => void
    const pin = vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { pin, read: vi.fn() } } })
    useThreadStore.setState({ threads: [thread], selectedId: null, snapshot: null })
    const done = useThreadStore.getState().pinThread('t', true)
    expect(useThreadStore.getState().threads[0].pinned).toBe(true)
    fail(new Error('database is locked'))
    await done
    expect(useThreadStore.getState().threads[0].pinned).toBe(false)
    expect(lastToast()).toMatchObject({ title: 'Could not pin the conversation', intent: 'danger', action: { label: 'Try again' } })
  })

  it('closes a workspace at once and brings it back when the delete fails', async () => {
    const workspace = (id: string, isActive: boolean) => ({ id, name: id, isActive, panes: [] }) as unknown as Workspace
    let fail!: (error: Error) => void
    Object.defineProperty(window, 'oxe', { configurable: true, value: { workspace: { delete: vi.fn(() => new Promise<void>((_resolve, reject) => { fail = reject })) } } })
    useWorkspaceStore.setState({ workspaces: [workspace('one', true), workspace('two', false)], activeWorkspaceId: 'one' })
    const done = useWorkspaceStore.getState().closeWorkspace('one')
    expect(useWorkspaceStore.getState().workspaces.map(item => item.id)).toEqual(['two'])
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('two')
    fail(new Error('locked'))
    await done
    expect(useWorkspaceStore.getState().workspaces.map(item => item.id)).toEqual(['one', 'two'])
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('one')
    expect(lastToast()).toMatchObject({ title: 'Could not close the workspace', intent: 'danger' })
  })
})
