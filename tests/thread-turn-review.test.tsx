import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relativeTurnPath } from '../shared/threadFilePath'
import type { ThreadEvent, ThreadSnapshot, ThreadTurnFileStatus } from '../shared/types/thread'
import { ThreadTurnChanges } from '../src/components/Threads/ThreadFileActivity'
import { ThreadTurnReview } from '../src/components/Threads/ThreadTurnReview'
import { useThreadWorkbenchStore } from '../src/store/thread-workbench.store'

afterEach(cleanup)

describe('relativeTurnPath', () => {
  it('names a path relative to the conversation root', () => {
    expect(relativeTurnPath('/home/me/repo/app/db/documents.py', ['/home/me/repo'])).toEqual({ label: 'app/db/documents.py', full: '/home/me/repo/app/db/documents.py' })
    expect(relativeTurnPath(String.raw`C:\Users\me\Repo\src\a.ts`, ['c:/users/me/repo'])).toMatchObject({ label: 'src/a.ts' })
    expect(relativeTurnPath('src/a.ts', ['/repo'])).toMatchObject({ label: 'src/a.ts' })
  })

  it('names the worktree a file was changed in, preferring the deepest root', () => {
    expect(relativeTurnPath('/w/repo-feat-137525/app/db/documents.py', ['/w/repo', '/w/repo-feat-137525'])).toEqual({ label: 'app/db/documents.py', checkout: 'repo-feat-137525', full: '/w/repo-feat-137525/app/db/documents.py' })
    expect(relativeTurnPath('/w/repo/.worktrees/fix/src/a.ts', ['/w/repo', '/w/repo/.worktrees/fix'])).toMatchObject({ label: 'src/a.ts', checkout: 'fix' })
    // POSIX paths keep their case: another folder is not the root.
    expect(relativeTurnPath('/W/repo/a.ts', ['/w/repo']).checkout).toBeUndefined()
  })

  it('keeps the end of a path no known checkout contains', () => {
    expect(relativeTurnPath('/home/eduardo/workspace/x/app/db/repositories/documents.py', ['/elsewhere'])).toMatchObject({ label: '…/db/repositories/documents.py' })
    expect(relativeTurnPath('/tmp/a.ts', [])).toMatchObject({ label: '/tmp/a.ts' })
  })
})

const patch = '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n'
const file = (path: string) => ({ path, kind: 'update' as const, state: 'completed' as const, source: 'native-patch' as const, patch, additions: 1, deletions: 1 })

describe('turn files edited in a worktree', () => {
  it('shows paths relative to the worktree and still offers Undo for them', async () => {
    const events: ThreadEvent[] = [
      { type: 'message', id: 'turn-1', role: 'user', text: 'Edit' },
      { type: 'tool', id: 'a', name: 'fileChange', state: 'completed', detail: 'a', files: [file('/w/repo-feat/app/db/documents.py')] },
      { type: 'completed', status: 'completed' }
    ]
    const loadFileStates = vi.fn(async (): Promise<ThreadTurnFileStatus[]> => [{ path: 'app/db/documents.py', root: '/w/repo-feat', state: 'pending', preExists: true, postExists: true }])
    render(<ThreadTurnChanges events={events} root="/w/repo" onOpen={vi.fn()} loadFileStates={loadFileStates} onUndoFile={vi.fn(async () => {})} />)
    expect(await screen.findByRole('button', { name: 'Undo app/db/documents.py' })).toBeTruthy()
    expect(screen.getByText('repo-feat')).toBeTruthy()
    expect(screen.queryByText(/^\/w\/repo-feat\/app/)).toBeNull()
  })
})

const snapshot = (events: ThreadEvent[] = []): ThreadSnapshot => ({
  thread: { id: 't', workspaceId: 'w', projectId: 'p', rootPath: '/w/repo', provider: 'claude', nativeSessionId: null, title: 'T', pinned: false, status: 'idle', createdAt: 0, updatedAt: 0 },
  events, turns: [{ id: 'turn-2', sequence: 2, status: 'completed', configuration: {} as never }]
} as unknown as ThreadSnapshot)

describe('View changes for one turn', () => {
  beforeEach(() => useThreadWorkbenchStore.setState({ views: {} }))

  it('lists exactly the turn files, in their checkout, with the first one open', async () => {
    const turnFiles = vi.fn(async () => [
      { path: 'app/a.py', root: '/w/repo-feat', state: 'pending' as const, preExists: true, postExists: true },
      { path: 'app/b.py', root: '/w/repo-feat', state: 'modified' as const, preExists: true, postExists: true },
      { path: 'app/c.py', root: '/w/repo-feat', state: 'pending' as const, preExists: false, postExists: true }
    ])
    const turnFileHunks = vi.fn(async () => [{ id: 'h', oldStart: 0, newStart: 0, oldLines: ['old'], newLines: ['new'] }])
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { turnFiles, turnFileHunks } } })
    const onShowAll = vi.fn()
    render(<ThreadTurnReview snapshot={snapshot()} turnId="turn-2" onShowAll={onShowAll} onComment={vi.fn()} />)
    const list = await screen.findByRole('list', { name: 'Files changed in this turn' })
    expect([...list.querySelectorAll('li')].map(item => item.textContent)).toEqual(['app/a.py', 'app/b.pyEdited later', 'app/c.pyAdded'])
    expect(screen.getByText(/3 files · in repo-feat/)).toBeTruthy()
    expect(screen.getByText('Turn 2')).toBeTruthy()
    await waitFor(() => expect(turnFileHunks).toHaveBeenCalledWith('t', 'turn-2', 'app/a.py'))
    fireEvent.click(screen.getByRole('button', { name: /app\/b\.py/ }))
    expect(screen.getByText(/edited after the turn/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /All changes/ }))
    expect(onShowAll).toHaveBeenCalled()
  })

  it('falls back to the files the turn reported when it has no checkpoint', async () => {
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { turnFiles: vi.fn(async () => []) } } })
    const events: ThreadEvent[] = [{ type: 'tool', id: 'a', name: 'fileChange', state: 'completed', detail: 'a', turnId: 'turn-2', files: [file('/w/repo/src/a.ts')] }]
    render(<ThreadTurnReview snapshot={snapshot(events)} turnId="turn-2" onShowAll={vi.fn()} onComment={vi.fn()} />)
    expect(await screen.findByText(/not recorded for review/)).toBeTruthy()
    expect(screen.getByText('src/a.ts')).toBeTruthy()
  })

  it('leaves the turn view when a panel is chosen without one', () => {
    const store = useThreadWorkbenchStore.getState()
    store.setView('t', { panel: 'changes', turnId: 'turn-2' })
    expect(useThreadWorkbenchStore.getState().views.t).toMatchObject({ panel: 'changes', turnId: 'turn-2' })
    store.setView('t', { panel: 'changes' })
    expect(useThreadWorkbenchStore.getState().views.t.turnId).toBeUndefined()
  })
})
