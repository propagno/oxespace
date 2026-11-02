// @vitest-environment node
/**
 * SECURITY (from the #507 review): a `.git` file anyone can write in any folder used to make that folder "the same
 * repository" (sameRepository compared the common git dir one way), so the file system channels accepted it as a
 * worktree root for reading and writing. Checkouts are now verified against the repository's own records, both ways.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { worktreeOrWorkspaceRoot } from '../../electron/main/ipc/file-system.ipc'
import { findCheckoutRoot, gitCommonDir, resolveSessionLocation, sameRepository, staysLocal } from '../../electron/main/services/git-common-dir'

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

  it('a .git that is a link to the real one borrows nothing: a junction to the repository\'s, a symlink to a worktree\'s', () => {
    const viaJunction = join(sandbox, 'junction-git')
    mkdirSync(viaJunction)
    writeFileSync(join(viaJunction, 'secret.txt'), 'outside')
    let linked = false
    try { symlinkSync(join(repo, '.git'), join(viaJunction, '.git'), process.platform === 'win32' ? 'junction' : 'dir'); linked = true } catch { /* no links here */ }
    if (linked) {
      expect(sameRepository(repo, viaJunction)).toBe(false)
      expect(worktreeOrWorkspaceRoot(repo, viaJunction)).toBe(repo)
    }
    const viaFileLink = join(sandbox, 'file-link-git')
    mkdirSync(viaFileLink)
    let fileLinked = false
    try { symlinkSync(join(worktree, '.git'), join(viaFileLink, '.git'), 'file'); fileLinked = true } catch { /* symlinks need a privilege on Windows */ }
    if (fileLinked) expect(sameRepository(repo, viaFileLink)).toBe(false)
  })

  it('a root or an agent folder on a network share is refused before anything touches it', () => {
    const started = Date.now()
    expect(worktreeOrWorkspaceRoot(repo, '\\\\server\\share\\repo')).toBe(repo)
    expect(worktreeOrWorkspaceRoot(repo, '//server/share/repo')).toBe(repo)
    expect(resolveSessionLocation('\\\\server\\share\\repo', repo)).toBeNull()
    expect(sameRepository(repo, '\\\\?\\UNC\\server\\share\\repo')).toBe(false)
    // No network lookup happened: a real one takes seconds to fail.
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('an agent reporting a forged folder as where it works is not in the same repository', () => {
    const outside = forged('agent-cwd', join(repo, '.git'))
    expect(resolveSessionLocation(outside, repo)).toMatchObject({ sameRepository: false })
    expect(resolveSessionLocation(worktree, repo)).toMatchObject({ sameRepository: true })
  })
})

describe('a link to a network share is never followed (SECURITY, #518 review)', () => {
  const SHARE = '//oxe-probe.invalid/share'
  /** A link at `at` naming `target`; false where this machine grants no symlink privilege. */
  const link = (target: string, at: string, type: 'file' | 'dir'): boolean => {
    try { symlinkSync(target, at, type); return true } catch { return false }
  }
  /** Each case must answer at once: a real lookup of the share takes seconds to fail. */
  const fast = (check: () => void): void => {
    const started = Date.now()
    check()
    expect(Date.now() - started).toBeLessThan(1000)
  }

  it('a .git that is a file link to a share', () => {
    const folder = join(sandbox, 'git-to-share')
    mkdirSync(folder)
    if (!link(`${SHARE}/repo/.git`, join(folder, '.git'), 'file')) return
    fast(() => {
      expect(gitCommonDir(folder)).toBeNull()
      expect(findCheckoutRoot(join(folder, 'sub'))).toBe(folder)
      expect(sameRepository(repo, folder)).toBe(false)
      expect(worktreeOrWorkspaceRoot(repo, folder)).toBe(repo)
    })
  })

  it('a gitdir pointer that passes through a folder link to a share, directly or through a local link', () => {
    if (!link(SHARE, join(sandbox, 'evil'), 'dir')) return
    link(join(sandbox, 'evil'), join(sandbox, 'hop'), 'dir')
    for (const [name, pointer] of [['via-evil', 'evil/repo/.git/worktrees/x'], ['via-hop', 'hop/repo/.git/worktrees/x']]) {
      const folder = join(sandbox, name)
      mkdirSync(folder)
      writeFileSync(join(folder, '.git'), `gitdir: ../${pointer}\n`)
      fast(() => {
        expect(gitCommonDir(folder)).toBeNull()
        expect(sameRepository(repo, folder)).toBe(false)
        expect(resolveSessionLocation(folder, repo)).toMatchObject({ sameRepository: false })
      })
    }
    fast(() => expect(resolveSessionLocation(join(sandbox, 'hop', 'repo'), repo)).toBeNull())
  })

  it('a commondir that is a link to a share', () => {
    const admin = join(repo, '.git', 'worktrees', 'wt-real')
    rmSync(join(admin, 'commondir'))
    if (!link(`${SHARE}/common`, join(admin, 'commondir'), 'file')) return
    fast(() => {
      expect(gitCommonDir(worktree)).toBeNull()
      expect(sameRepository(repo, worktree)).toBe(false)
    })
  })

  it('local links still resolve, and a link cycle ends', () => {
    expect(staysLocal(worktree)).toBe(true)
    const viaJunction = join(sandbox, 'wt-junction')
    if (link(worktree, viaJunction, process.platform === 'win32' ? 'junction' as 'dir' : 'dir')) {
      expect(staysLocal(viaJunction)).toBe(true)
      expect(gitCommonDir(viaJunction)).toBe(gitCommonDir(worktree))
    }
    if (link(join(sandbox, 'loop-b'), join(sandbox, 'loop-a'), 'dir') && link(join(sandbox, 'loop-a'), join(sandbox, 'loop-b'), 'dir')) {
      fast(() => expect(staysLocal(join(sandbox, 'loop-a', 'x'))).toBe(false))
    }
  })
})
