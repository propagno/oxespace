import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { GhExec } from '../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../electron/main/services/github/repository.service'
import { RepoHookTrust } from '../../electron/main/services/repo-config/trust'
import { createThreadWorktree, ThreadWorktreeError, type ThreadWorktreeHost } from '../../electron/main/services/conversation/thread-worktree'
import { endThreadWithWorktree, finishThreadWorktree, inspectThreadWorktree, isOwnedWorktreePath } from '../../electron/main/services/conversation/thread-worktree-lifecycle'
import type { OwnedThreadWorktree } from '../../shared/types/thread'

// Each test spawns many real git processes; a loaded Windows box needs room.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

describe('a conversation\'s own worktree (real git)', () => {
  let sandbox: string, repo: string
  let service: GitHubRepositoryService
  let host: ThreadWorktreeHost
  const closers: (() => void)[] = []

  beforeEach(() => {
    sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-thread-life-')))
    repo = join(sandbox, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'config', 'user.email', 't@t.t')
    git(repo, 'config', 'user.name', 't')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'init')
    const db = openInMemoryDatabase()
    closers.push(() => db.close())
    service = new GitHubRepositoryService(new GhExec({}))
    service.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
    host = {
      createWorktree: input => service.createWorktree(input),
      resolveBaseRef: async () => 'main',
      removeWorktree: input => service.removeWorktree(input)
    }
  })

  afterEach(() => {
    for (const close of closers.splice(0)) close()
    // Windows can keep a just-exited git's directory handle for a moment; a leftover temp folder must not fail a passing test.
    try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ }
  })

  const own = async (branch = 'feature/x'): Promise<OwnedThreadWorktree> => {
    const created = await createThreadWorktree(host, repo, { branch })
    return { path: created.rootPath, branch: created.branch, projectRoot: repo, baseSha: created.baseSha, createdAt: 1 }
  }
  const branches = (): string[] => git(repo, 'branch', '--format=%(refname:short)').split(/\r?\n/).filter(Boolean)

  describe('creating', () => {
    it('records the commit the branch started at', async () => {
      const owned = await own()
      expect(owned.baseSha).toBe(git(repo, 'rev-parse', 'main').trim())
      expect(isOwnedWorktreePath(owned)).toBe(true)
    })

    it('refuses a folder that is not a Git repository, with nothing created', async () => {
      const plain = join(sandbox, 'plain')
      mkdirSync(plain)
      // Some machines keep a repository in the home folder, which would contain every temp folder.
      vi.stubEnv('GIT_CEILING_DIRECTORIES', sandbox)
      const error = await createThreadWorktree(host, plain, {}).catch(cause => cause)
      vi.unstubAllEnvs()
      expect(error).toBeInstanceOf(ThreadWorktreeError)
      expect((error as ThreadWorktreeError).code).toBe('NOT_A_REPO')
      expect(existsSync(join(sandbox, 'plain-worktrees'))).toBe(false)
    })

    it('stops on uncommitted changes in the project until the person goes on', async () => {
      writeFileSync(join(repo, 'a.txt'), 'edited\n')
      const error = await createThreadWorktree(host, repo, { branch: 'dirty-one' }).catch(cause => cause)
      expect((error as ThreadWorktreeError).code).toBe('DIRTY_BASE')
      expect(branches()).not.toContain('dirty-one')
      const created = await createThreadWorktree(host, repo, { branch: 'dirty-one', allowDirtyBase: true })
      // The edit stays in the project; the worktree starts from the commit.
      expect(git(created.rootPath, 'status', '--porcelain').trim()).toBe('')
      expect(git(repo, 'status', '--porcelain')).toContain('a.txt')
    })

    it('reports a branch name that is taken', async () => {
      await own('taken')
      const error = await createThreadWorktree(host, repo, { branch: 'taken' }).catch(cause => cause)
      expect((error as ThreadWorktreeError).code).toBe('BRANCH_EXISTS')
    })
  })

  describe('reading its state', () => {
    it('is empty right after creation', async () => {
      const owned = await own()
      const { state, decision } = await inspectThreadWorktree(owned)
      expect(state).toEqual({ missing: false, uncommitted: 0, untracked: 0, unpushed: 0 })
      expect(decision).toEqual({ kind: 'remove' })
    })

    it('counts edits, new files and commits that exist nowhere else', async () => {
      const owned = await own()
      writeFileSync(join(owned.path, 'a.txt'), 'edited\n')
      writeFileSync(join(owned.path, 'new.txt'), 'new\n')
      expect((await inspectThreadWorktree(owned)).state).toMatchObject({ uncommitted: 1, untracked: 1, unpushed: 0 })
      git(owned.path, 'add', '.')
      git(owned.path, 'commit', '-qm', 'work')
      expect((await inspectThreadWorktree(owned)).state).toEqual({ missing: false, uncommitted: 0, untracked: 0, unpushed: 1 })
    })

    it('does not count commits once they are pushed', async () => {
      const remote = join(sandbox, 'remote.git')
      git(sandbox, 'init', '-q', '--bare', remote)
      git(repo, 'remote', 'add', 'origin', remote)
      const owned = await own()
      writeFileSync(join(owned.path, 'b.txt'), 'b\n')
      git(owned.path, 'add', '.')
      git(owned.path, 'commit', '-qm', 'work')
      expect((await inspectThreadWorktree(owned)).state.unpushed).toBe(1)
      git(owned.path, 'push', '-q', '-u', 'origin', owned.branch)
      const { state, decision } = await inspectThreadWorktree(owned)
      expect(state.unpushed).toBe(0)
      expect(decision).toEqual({ kind: 'remove' })
    })

    it('knows when the folder is gone', async () => {
      const owned = await own()
      git(repo, 'worktree', 'remove', '--force', owned.path)
      expect((await inspectThreadWorktree(owned)).decision).toEqual({ kind: 'gone' })
      expect(await finishThreadWorktree(host as never, owned, 'auto')).toEqual({ removed: false, left: 'missing' })
    })
  })

  describe('finishing', () => {
    it('removes an empty worktree and its branch when the conversation ends', async () => {
      const owned = await own()
      expect(await finishThreadWorktree({ removeWorktree: input => service.removeWorktree(input) }, owned, 'auto')).toEqual({ removed: true })
      expect(existsSync(owned.path)).toBe(false)
      expect(branches()).not.toContain(owned.branch)
      expect(git(repo, 'worktree', 'list')).not.toContain('feature')
    })

    it('leaves a worktree with edits alone, whatever the app would have chosen', async () => {
      const owned = await own()
      writeFileSync(join(owned.path, 'a.txt'), 'edited\n')
      expect(await finishThreadWorktree({ removeWorktree: input => service.removeWorktree(input) }, owned, 'auto')).toEqual({ removed: false, left: 'changes' })
      expect(existsSync(join(owned.path, 'a.txt'))).toBe(true)
    })

    it('keep leaves even an empty worktree', async () => {
      const owned = await own()
      expect(await finishThreadWorktree({ removeWorktree: input => service.removeWorktree(input) }, owned, 'keep')).toEqual({ removed: false, left: 'chosen' })
      expect(existsSync(owned.path)).toBe(true)
    })

    it('discard removes the edits, but the branch keeps its commits', async () => {
      const owned = await own()
      writeFileSync(join(owned.path, 'b.txt'), 'b\n')
      git(owned.path, 'add', '.')
      git(owned.path, 'commit', '-qm', 'work')
      writeFileSync(join(owned.path, 'a.txt'), 'edited\n')
      const result = await finishThreadWorktree({ removeWorktree: input => service.removeWorktree(input) }, owned, 'discard')
      expect(result).toEqual({ removed: true })
      expect(existsSync(owned.path)).toBe(false)
      // Not merged anywhere, so the branch (and the commit) is still there to recover.
      expect(branches()).toContain(owned.branch)
    })

    it('does not remove a worktree another conversation still works in', async () => {
      const owned = await own()
      const remove = vi.fn()
      expect(await finishThreadWorktree({ removeWorktree: remove }, owned, 'auto', () => 1)).toMatchObject({ removed: false, left: 'refused' })
      expect(remove).not.toHaveBeenCalled()
      expect(existsSync(owned.path)).toBe(true)
    })

    it('never touches a folder outside the project\'s worktree folder', async () => {
      const elsewhere = join(sandbox, 'precious')
      mkdirSync(elsewhere)
      writeFileSync(join(elsewhere, 'keep.txt'), 'keep\n')
      const forged: OwnedThreadWorktree = { path: elsewhere, branch: 'x', projectRoot: repo, baseSha: 'a'.repeat(40), createdAt: 1 }
      const remove = vi.fn()
      expect(isOwnedWorktreePath(forged)).toBe(false)
      expect(await finishThreadWorktree({ removeWorktree: remove }, forged, 'discard')).toMatchObject({ removed: false, left: 'refused' })
      expect(remove).not.toHaveBeenCalled()
      expect(existsSync(join(elsewhere, 'keep.txt'))).toBe(true)
      // Not even the parent of the worktree folder, nor the project itself.
      expect(isOwnedWorktreePath({ path: repo, projectRoot: repo })).toBe(false)
      expect(isOwnedWorktreePath({ path: join(sandbox, 'repo-worktrees', '..'), projectRoot: repo })).toBe(false)
    })

    describe('ending the conversation', () => {
      const ending = (owned: OwnedThreadWorktree | undefined, steps: string[], others = 0) => ({
        read: () => ({ thread: { projectId: 'p', ownedWorktree: owned } }),
        command: async (_id: string, text: string) => { steps.push(`command ${text}`) },
        remover: { removeWorktree: async (input: Parameters<ThreadWorktreeHost['removeWorktree'] & {}>[0]) => { steps.push('remove'); return service.removeWorktree(input) } },
        removeContext: (_project: string, path: string) => { steps.push(`context ${path === owned?.path ? 'dropped' : 'other'}`) },
        otherThreadsInside: () => others
      })

      it('archives first, then removes an empty worktree and forgets its folder', async () => {
        const owned = await own()
        const steps: string[] = []
        expect(await endThreadWithWorktree(ending(owned, steps), 't', 'archive', 'auto')).toEqual({ removed: true })
        expect(steps).toEqual(['command /archive confirm', 'remove', 'context dropped'])
        expect(existsSync(owned.path)).toBe(false)
      })

      it('asks nothing of the folder when the person keeps it', async () => {
        const owned = await own()
        writeFileSync(join(owned.path, 'a.txt'), 'edited\n')
        const steps: string[] = []
        expect(await endThreadWithWorktree(ending(owned, steps), 't', 'delete', 'keep')).toEqual({ removed: false, left: 'chosen' })
        expect(steps).toEqual(['command /delete confirm'])
        expect(existsSync(join(owned.path, 'a.txt'))).toBe(true)
      })

      it('keeps the worktree when "auto" meets work written after the question', async () => {
        const owned = await own()
        writeFileSync(join(owned.path, 'late.txt'), 'late\n')
        const steps: string[] = []
        expect(await endThreadWithWorktree(ending(owned, steps), 't', 'archive', 'auto')).toEqual({ removed: false, left: 'changes' })
        expect(steps).toEqual(['command /archive confirm'])
      })

      it('removes nothing when ending the conversation fails', async () => {
        const owned = await own()
        const deps = { ...ending(owned, []), command: async () => { throw new Error('The active turn has not stopped.') } }
        await expect(endThreadWithWorktree(deps, 't', 'archive', 'discard')).rejects.toThrow('has not stopped')
        expect(existsSync(owned.path)).toBe(true)
      })

      it('only ends a conversation that has no worktree', async () => {
        const steps: string[] = []
        expect(await endThreadWithWorktree(ending(undefined, steps), 't', 'archive', 'auto')).toEqual({ removed: false, left: 'missing' })
        expect(steps).toEqual(['command /archive confirm'])
      })
    })

    it('reports the guard\'s refusal instead of throwing', async () => {
      const owned = await own()
      const remover = { removeWorktree: async () => { throw new Error('[worktree-removal:locked] The worktree is locked.') } }
      const result = await finishThreadWorktree(remover, owned, 'auto')
      expect(result).toMatchObject({ removed: false, left: 'refused' })
      expect(result.detail).toContain('locked')
      expect(existsSync(owned.path)).toBe(true)
    })
  })
})
