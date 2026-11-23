// Frozen acceptance test for OXE-361 A9, A10, A11 (program 152p1a, phase F1). Written by the planner; the executor must not edit it.
// Contract (A9): git:diff-update carries the rootPath it was computed for (GitDiff.rootPath); a workspace takes only
// updates of the root it last loaded, and only the newest loadDiff answer is shown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitDiff } from '../../../shared/types/git'
import { useEditorStore } from '../../../src/store/editor.store'
import { useGitStore } from '../../../src/store/git.store'
import { useSkillStore } from '../../../src/store/skill.store'

const original = window.oxe
const diff = (path: string, rootPath?: string): GitDiff =>
  ({ files: [{ path, additions: 1, deletions: 0, hunks: [], mtime: null }], base: 'origin/main', includeUncommitted: true, compiledAt: 1, ...(rootPath ? { rootPath } : {}) }) as GitDiff
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  useGitStore.setState({ byWorkspaceId: {} })
  useEditorStore.setState({ files: {}, tabs: {}, activePath: {}, reveal: {} })
  useSkillStore.setState({ skills: [], loaded: false, loading: false, error: null })
})
afterEach(() => { window.oxe = original })

describe('OXE-361 · the Git store', () => {
  it('a diff update only reaches the workspace of its root', async () => {
    const listeners: Array<(value: GitDiff) => void> = []
    window.oxe = { git: {
      getDiff: async (input: { rootPath: string }) => diff(input.rootPath === '/repo-a' ? 'a.ts' : 'b.ts'),
      onDiffUpdate: (listener: (value: GitDiff) => void) => { listeners.push(listener); return () => undefined }
    } } as unknown as typeof window.oxe
    const store = useGitStore.getState()
    await store.loadDiff('wa', '/repo-a')
    await store.loadDiff('wb', '/repo-b')
    store.subscribeToUpdates('wa')
    store.subscribeToUpdates('wb')
    for (const listener of listeners) listener(diff('b-new.ts', '/repo-b'))
    expect(useGitStore.getState().byWorkspaceId.wa.diff?.files[0].path).toBe('a.ts')
    expect(useGitStore.getState().byWorkspaceId.wb.diff?.files[0].path).toBe('b-new.ts')
  })

  it('an older diff answer never replaces a newer one', async () => {
    const slow = deferred<GitDiff>()
    let calls = 0
    window.oxe = { git: { getDiff: () => ++calls === 1 ? slow.promise : Promise.resolve(diff('new.ts')) } } as unknown as typeof window.oxe
    const first = useGitStore.getState().loadDiff('w', '/old-root')
    await useGitStore.getState().loadDiff('w', '/new-root')
    slow.resolve(diff('old.ts'))
    await first
    expect(useGitStore.getState().byWorkspaceId.w.diff?.files[0].path).toBe('new.ts')
  })
})

describe('OXE-361 · the editor store', () => {
  const target = { workspaceId: 'ws', rootPath: '/repo', relativePath: 'src/a.ts' }

  it('closing a file while it opens releases its watcher', async () => {
    const watching = deferred<{ watchId: string }>()
    const unwatchFile = vi.fn(async () => undefined)
    window.oxe = { fs: {
      readFile: async () => ({ relativePath: target.relativePath, content: 'a', size: 1, mtimeMs: 1 }),
      watchFile: () => watching.promise,
      unwatchFile
    } } as unknown as typeof window.oxe
    const opening = useEditorStore.getState().openFile(target)
    await settle()
    // The tab closed meanwhile: the store no longer has the file.
    useEditorStore.setState({ files: { ws: {} }, tabs: { ws: [] }, activePath: {} })
    watching.resolve({ watchId: 'orphan' })
    await opening
    await settle()
    expect(unwatchFile).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(unwatchFile.mock.calls[0])).toContain('orphan')
  })

  it('opening a file twice at once reads and watches it once', async () => {
    const readFile = vi.fn(async () => { await settle(); return { relativePath: target.relativePath, content: 'a', size: 1, mtimeMs: 1 } })
    const watchFile = vi.fn(async () => ({ watchId: 'w1' }))
    window.oxe = { fs: { readFile, watchFile, unwatchFile: async () => undefined } } as unknown as typeof window.oxe
    await Promise.all([useEditorStore.getState().openFile(target), useEditorStore.getState().openFile(target)])
    expect(readFile).toHaveBeenCalledTimes(1)
    expect(watchFile).toHaveBeenCalledTimes(1)
  })
})

describe('OXE-361 · the skill store', () => {
  it('a skill change keeps the skills of the workspace', async () => {
    let changed: (() => void) | null = null
    const list = vi.fn(async (_input: { workspaceRootPath?: string }) => [])
    window.oxe = { skill: { list, onChange: (listener: () => void) => { changed = listener; return () => undefined } } } as unknown as typeof window.oxe
    await useSkillStore.getState().refresh('C:/repo')
    useSkillStore.getState().subscribe()
    ;(changed as unknown as () => void)()
    await settle()
    expect(list).toHaveBeenLastCalledWith({ workspaceRootPath: 'C:/repo' })
  })
})
