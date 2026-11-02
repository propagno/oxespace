// @vitest-environment node
/**
 * HML on #477: on Windows a temp path can come in 8.3 form (C:\Users\RUNNER~1\…); createWorktree returned it as given,
 * and removing by that path was refused as "not a registered worktree", since git reports the long name. Paths are now
 * compared by their real, long name, and removal speaks C3 like creation (#451).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { GhExec } from '../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../electron/main/services/github/repository.service'
import { RepoHookTrust } from '../../electron/main/services/repo-config/trust'

vi.setConfig({ testTimeout: 60_000 })

let sandbox: string, root: string, service: GitHubRepositoryService, close: () => void
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-long-path-')))
  root = join(sandbox, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 't@t.t'); git(root, 'config', 'user.name', 't')
  writeFileSync(join(root, 'a.txt'), 'a\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'a')
  const db = openInMemoryDatabase()
  close = () => db.close()
  service = new GitHubRepositoryService(new GhExec({}))
  service.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
})

afterEach(() => {
  close()
  try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ }
})

/** Another spelling of `folder`: a junction (Windows) or a symlink. An 8.3 short name is one more such spelling. */
function alias(folder: string, at: string): boolean {
  try { symlinkSync(folder, at, process.platform === 'win32' ? 'junction' : 'dir'); return true } catch { return false }
}

/** The 8.3 short form of `path` on Windows, when the volume keeps short names; null otherwise. */
function shortName(path: string): string | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${path.replace(/'/g, "''")}').ShortPath`], { encoding: 'utf8' }).trim()
    return out && out.toLowerCase() !== path.toLowerCase() ? out : null
  } catch { return null }
}

describe('a worktree path given in another spelling', () => {
  it('is created and reported by its long name, and removed by the spelling it was given', async () => {
    const parent = join(sandbox, 'worktrees-with-a-long-name')
    mkdirSync(parent)
    const spelling = join(sandbox, 'wt-alias')
    if (!alias(parent, spelling)) return
    const given = join(spelling, 'wt-1')
    const created = await service.createWorktree({ rootPath: root, branch: 'wt-1', path: given, createBranch: true, baseRef: 'main' })
    // Reported by its real place, as git lists it.
    expect(created.notices?.[0]).toMatchObject({ code: 'worktree.createdFrom', params: { path: realpathSync.native(given) } })
    const removed = await service.removeWorktree({ rootPath: root, path: given, force: true })
    expect(removed.ok).toBe(true)
    expect(existsSync(join(parent, 'wt-1'))).toBe(false)
    expect(git(root, 'worktree', 'list', '--porcelain')).not.toContain('wt-1')
  })

  it('on Windows, an 8.3 short path removes the worktree it names', async () => {
    const parent = join(sandbox, 'a-folder-name-longer-than-eight')
    mkdirSync(parent)
    const short = shortName(parent)
    if (!short) return
    const given = join(short, 'wt-2')
    await service.createWorktree({ rootPath: root, branch: 'wt-2', path: given, createBranch: true, baseRef: 'main' })
    expect((await service.removeWorktree({ rootPath: root, path: given, force: true })).ok).toBe(true)
    expect(existsSync(join(parent, 'wt-2'))).toBe(false)
  })
})

describe('removing speaks C3 (HML on #477, like creation in #451)', () => {
  it('the removal and the branch outcome are codes the window words; the message is English', async () => {
    const path = join(sandbox, 'wt-c3')
    await service.createWorktree({ rootPath: root, branch: 'wt-c3', path, createBranch: true, baseRef: 'main' })
    const removed = await service.removeWorktree({ rootPath: root, path, force: true, deleteBranch: true })
    expect(removed.notices).toEqual([
      { code: 'worktree.removed', params: { path: expect.stringMatching(/wt-c3$/) } },
      { code: 'worktree.branch.deleted', params: { branch: 'wt-c3' } }
    ])
    expect(removed.message).toMatch(/^Worktree removed from .*wt-c3\. Branch wt-c3 deleted\.$/)
    expect(removed.message).not.toMatch(/removido/)
  })
})
