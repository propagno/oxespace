// @vitest-environment node
/**
 * SECURITY (from the #507 review): a `.git` file anyone can write in any folder used to make that folder "the same
 * repository" (sameRepository compared the common git dir one way), so the file system channels accepted it as a
 * worktree root for reading and writing. Checkouts are now verified against the repository's own records, both ways.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worktreeOrWorkspaceRoot } from '../../electron/main/ipc/file-system.ipc'
import { resolveSessionLocation, sameRepository } from '../../electron/main/services/git-common-dir'

let sandbox: string, repo: string, worktree: string, sibling: string
const git = (cwd: string, ...args: string[]): void => { execFileSync('git', args, { cwd, stdio: 'ignore' }) }

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-wt-root-')))
  repo = join(sandbox, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@t.t'); git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'a.txt'), 'a\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'a')
  worktree = join(sandbox, 'wt-real')
  sibling = join(sandbox, 'wt-sibling')
  git(repo, 'worktree', 'add', '-q', '-b', 'real', worktree)
  git(repo, 'worktree', 'add', '-q', '-b', 'sibling', sibling)
})

afterEach(() => { try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ } })

/** A folder outside the repository with a hand-written `.git` file. */
function forged(name: string, pointer: string): string {
  const folder = join(sandbox, name)
  mkdirSync(folder)
  writeFileSync(join(folder, '.git'), `gitdir: ${pointer}\n`)
  writeFileSync(join(folder, 'secret.txt'), 'outside the repository')
  return folder
}

describe('a worktree root is the repository\'s own, checked both ways', () => {
  it('real checkouts: the main checkout, a linked worktree and a sibling worktree, each way round', () => {
    expect(sameRepository(repo, worktree)).toBe(true)
    expect(sameRepository(worktree, repo)).toBe(true)
    expect(sameRepository(worktree, sibling)).toBe(true)
    expect(sameRepository(repo, repo)).toBe(true)
    expect(worktreeOrWorkspaceRoot(repo, worktree)).toBe(worktree)
  })

  it('a folder whose .git file names the repository\'s git dir is not a checkout of it (the reported forgery)', () => {
    const outside = forged('ssh-like', join(repo, '.git'))
    expect(sameRepository(repo, outside)).toBe(false)
    expect(sameRepository(outside, repo)).toBe(false)
    // The file system channels fall back to the workspace root: nothing outside it is reachable through this.
    expect(worktreeOrWorkspaceRoot(repo, outside)).toBe(repo)
  })

  it('a .git file pointing into a real worktree\'s records is refused: those records point back elsewhere', () => {
    const outside = forged('borrowed', join(repo, '.git', 'worktrees', 'wt-real'))
    expect(sameRepository(repo, outside)).toBe(false)
    expect(worktreeOrWorkspaceRoot(repo, outside)).toBe(repo)
  })

  it('a pointer to a UNC share or a device path is refused', () => {
    const outside = forged('unc', '\\\\server\\share\\repo\\.git\\worktrees\\x')
    expect(sameRepository(repo, outside)).toBe(false)
  })

  it('an agent reporting a forged folder as where it works is not in the same repository', () => {
    const outside = forged('agent-cwd', join(repo, '.git'))
    expect(resolveSessionLocation(outside, repo)).toMatchObject({ sameRepository: false })
    expect(resolveSessionLocation(worktree, repo)).toMatchObject({ sameRepository: true })
  })
})
