import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitDiff } from '../../shared/types/git'
import { useGitStore } from '../../src/store/git.store'

const diff = (base: string, path: string): GitDiff => ({ files: [{ path, additions: 1, deletions: 0, hunks: [], mtime: null }], base, includeUncommitted: true, compiledAt: 1 })

describe('classic review with a chosen side B', () => {
  let listener: ((value: GitDiff) => void) | null = null
  const getDiff = vi.fn(async (input: { base: string; head?: string }) => diff(input.base, input.head ? 'ref-side.ts' : 'tree-side.ts'))

  beforeEach(() => {
    listener = null
    getDiff.mockClear()
    useGitStore.setState({ byWorkspaceId: {} })
    ;(globalThis as unknown as { window: { oxe: unknown } }).window.oxe = {
      git: { getDiff, onDiffUpdate: (callback: (value: GitDiff) => void) => { listener = callback; return () => { listener = null } } }
    }
  })

  it('sends side B to the main process only when one is chosen', async () => {
    const store = useGitStore.getState()
    store.setBase('w', 'main')
    await store.loadDiff('w', '/repo')
    expect(getDiff).toHaveBeenLastCalledWith({ workspaceId: 'w', rootPath: '/repo', base: 'main', includeUncommitted: true })
    store.setHead('w', 'feature')
    await store.loadDiff('w', '/repo')
    expect(getDiff).toHaveBeenLastCalledWith({ workspaceId: 'w', rootPath: '/repo', base: 'main', includeUncommitted: true, head: 'feature' })
    expect(useGitStore.getState().byWorkspaceId.w.diff?.files[0].path).toBe('ref-side.ts')
  })

  it('ignores work-tree watcher updates while two refs are compared, or for a base no longer chosen', async () => {
    const store = useGitStore.getState()
    store.setBase('w', 'main')
    store.subscribeToUpdates('w')
    listener?.(diff('main', 'tree-update.ts'))
    expect(useGitStore.getState().byWorkspaceId.w.diff?.files[0].path).toBe('tree-update.ts')
    listener?.(diff('origin/old', 'stale.ts'))
    expect(useGitStore.getState().byWorkspaceId.w.diff?.files[0].path).toBe('tree-update.ts')
    store.setHead('w', 'feature')
    listener?.(diff('main', 'after-head.ts'))
    expect(useGitStore.getState().byWorkspaceId.w.diff?.files[0].path).toBe('tree-update.ts')
  })
})
