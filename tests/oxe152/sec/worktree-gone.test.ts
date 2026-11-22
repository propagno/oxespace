// @vitest-environment node
// Frozen acceptance test for OXE-369 A10 (program 152sec, phase F1). Written by the planner; the executor must not edit it.
// A conversation's worktree deleted by hand: ending the conversation clears that one record through the guarded
// remover (no force, the branch stays) and forgets the folder. A worktree that exists and is kept is never touched.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnedThreadWorktree } from '../../../shared/types/thread'
import { endThreadWithWorktree, type ThreadWorktreeEndDeps } from '../../../electron/main/services/conversation/thread-worktree-lifecycle'
import { worktreeFolderOf } from '../../../electron/main/services/conversation/thread-worktree'

let sandbox: string
beforeEach(() => { sandbox = mkdtempSync(join(tmpdir(), 'oxe-gone-')) })
afterEach(() => { try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* temp dir */ } })

function setup(path?: string) {
  const projectRoot = join(sandbox, 'repo')
  mkdirSync(projectRoot)
  const folder = worktreeFolderOf(projectRoot)
  mkdirSync(folder, { recursive: true })
  const owned: OwnedThreadWorktree = { path: path ?? join(folder, 'feature-x-ab12'), branch: 'feature/x', projectRoot, baseSha: 'a'.repeat(40), createdAt: 1 }
  const removeWorktree = vi.fn(async () => ({ ok: true as const, message: 'removed' }))
  const removeContext = vi.fn()
  const deps: ThreadWorktreeEndDeps = {
    read: () => ({ thread: { projectId: 'project', ownedWorktree: owned } }),
    command: vi.fn(async () => undefined),
    remover: { removeWorktree } as ThreadWorktreeEndDeps['remover'],
    removeContext,
    otherThreadsInside: () => 0
  }
  return { owned, deps, removeWorktree, removeContext }
}

describe('OXE-369 · a worktree that was deleted on disk', () => {
  it('a deleted worktree is pruned and forgotten when its conversation ends', async () => {
    const { owned, deps, removeWorktree, removeContext } = setup()
    await endThreadWithWorktree(deps, 't1', 'archive', 'keep')
    expect(removeWorktree).toHaveBeenCalledWith({ rootPath: owned.projectRoot, path: owned.path, force: false, deleteBranch: false })
    expect(removeContext).toHaveBeenCalledWith('project', owned.path)
  })

  it('a deleted worktree is forgotten even when Git has no record of it', async () => {
    const { owned, deps, removeWorktree, removeContext } = setup()
    removeWorktree.mockRejectedValue(new Error('is not a registered worktree of this repository'))
    await expect(endThreadWithWorktree(deps, 't1', 'delete', 'keep')).resolves.toMatchObject({ removed: false })
    expect(removeContext).toHaveBeenCalledWith('project', owned.path)
  })

  it('a kept worktree that exists is left alone', async () => {
    const { owned, deps, removeWorktree, removeContext } = setup()
    mkdirSync(owned.path)
    expect(await endThreadWithWorktree(deps, 't1', 'archive', 'keep')).toEqual({ removed: false, left: 'chosen' })
    expect(removeWorktree).not.toHaveBeenCalled()
    expect(removeContext).not.toHaveBeenCalled()
  })

  it('a missing folder outside the worktree folder is never passed to the remover', async () => {
    const { deps, removeWorktree } = setup(join(sandbox, 'elsewhere', 'tree'))
    await endThreadWithWorktree(deps, 't1', 'archive', 'keep')
    expect(removeWorktree).not.toHaveBeenCalled()
  })
})
