import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Each test spawns many real git processes; a loaded Windows box needs room.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { GhExec } from '../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../electron/main/services/github/repository.service'
import { WorktreeCleanup } from '../../electron/main/services/github/worktree-cleanup'
import { RepoHookTrust } from '../../electron/main/services/repo-config/trust'
import { WORKTREE_IDLE_CLEANUP_MS } from '../../shared/types/worktree-cleanup'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

describe('worktree cleanup (real git)', () => {
  let sandbox: string
  let root: string
  let repo: GitHubRepositoryService
  let cleanup: WorktreeCleanup

  beforeEach(() => {
    sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-clean-')))
    root = join(sandbox, 'main')
    mkdirSync(root)
    git(root, 'init', '-b', 'main')
    git(root, 'config', 'user.email', 't@t.t')
    git(root, 'config', 'user.name', 't')
    writeFileSync(join(root, 'a.txt'), 'a')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'init')

    const gh = new GhExec({})
    repo = new GitHubRepositoryService(gh)
    repo.configureWorktreeLifecycle({ trust: new RepoHookTrust(openInMemoryDatabase()) })
    cleanup = new WorktreeCleanup({ gh, removeWorktree: (input) => repo.removeWorktree(input) })
  })

  afterEach(() => {
    try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp */ }
  })

  const add = async (name: string): Promise<string> => {
    const path = join(sandbox, name)
    await repo.createWorktree({ rootPath: root, branch: name, path, createBranch: true })
    return path
  }
  const find = async <T extends { path: string }>(list: T[], path: string): Promise<T> => {
    const hit = list.find((c) => c.path.replace(/\\/g, '/').toLowerCase() === path.replace(/\\/g, '/').toLowerCase())
    if (!hit) throw new Error(`candidate not found: ${path}`)
    return hit
  }

  test('classifies clean, dirty, ahead and locked worktrees', async () => {
    const clean = await add('clean')
    const dirty = await add('dirty')
    writeFileSync(join(dirty, 'wip.txt'), 'x')
    const ahead = await add('ahead')
    writeFileSync(join(ahead, 'b.txt'), 'b')
    git(ahead, 'add', '.')
    git(ahead, 'commit', '-m', 'work')
    const locked = await add('locked')
    git(root, 'worktree', 'lock', locked)

    const found = await cleanup.scan({ rootPath: root })
    expect(found).toHaveLength(4)

    const c = await find(found, clean)
    expect(c.blockers).toEqual([])
    expect(c.reasons).toContain('merged')
    expect(c.selectedByDefault).toBe(true)

    const d = await find(found, dirty)
    expect(d.blockers).toContain('dirty-files')
    expect(d.selectedByDefault).toBe(false)

    const a = await find(found, ahead)
    expect(a.blockers).toContain('unpushed-commits')
    expect(a.reasons).not.toContain('merged')

    expect((await find(found, locked)).blockers).toContain('locked')
  })

  test('marks long-idle worktrees and folds in renderer context', async () => {
    const idle = await add('idle')
    const running = await add('running')
    const found = await cleanup.scan({
      rootPath: root,
      now: Date.now() + WORKTREE_IDLE_CLEANUP_MS + 60_000,
      context: { activePaths: [], runningTerminalPaths: [join(running, 'src')], liveAgentPaths: [] }
    })
    expect((await find(found, idle)).reasons).toContain('idle-clean')
    const r = await find(found, running)
    expect(r.blockers).toContain('running-terminal')
    expect(r.selectedByDefault).toBe(false)
  })

  test('removal re-scans: hard blockers refuse, consent needs force', async () => {
    const clean = await add('clean')
    const dirty = await add('dirty')
    writeFileSync(join(dirty, 'wip.txt'), 'x')
    const busy = await add('busy')

    const results = await cleanup.remove({
      rootPath: root,
      context: { activePaths: [busy], runningTerminalPaths: [], liveAgentPaths: [] },
      targets: [
        { path: clean, force: false },
        { path: dirty, force: false },
        { path: busy, force: true }
      ]
    })
    const by = (p: string): { ok: boolean; message: string } => results.find((r) => r.path === p)!
    expect(by(clean), JSON.stringify(results)).toMatchObject({ ok: true })
    expect(existsSync(clean)).toBe(false)
    expect(by(dirty).ok).toBe(false)
    expect(by(dirty).message).toContain('confirmação')
    expect(existsSync(dirty)).toBe(true)
    expect(by(busy).ok).toBe(false)
    expect(existsSync(busy)).toBe(true)

    const forced = await cleanup.remove({ rootPath: root, targets: [{ path: dirty, force: true }] })
    expect(forced[0].ok).toBe(true)
    expect(existsSync(dirty)).toBe(false)
  })

  test('refuses a path that is not a registered worktree', async () => {
    const results = await cleanup.remove({ rootPath: root, targets: [{ path: root, force: true }, { path: join(sandbox, 'nope'), force: true }] })
    expect(results.every((r) => !r.ok)).toBe(true)
    expect(existsSync(root)).toBe(true)
  })
})
