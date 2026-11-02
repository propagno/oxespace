// @vitest-environment node
/**
 * The git-dir cache's guard stamp (TECH LEAD go, 02/11): a `.git` folder counts by its identity (device, inode, kind),
 * so the index write of a `git status` no longer costs a rev-parse on the next call; anything that could make git find
 * other dirs still does. Real git in a sandbox git never looks above (GIT_CEILING_DIRECTORIES), with an empty HOME.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync, type BigIntStats } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { __forgetGitDirsForTests, gitDirsOfSync, guardStamp, stamp } from '../../electron/main/utils/git-dir'

let sandbox: string
let env: NodeJS.ProcessEnv
let revParses = 0

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** The cache's rev-parse, run for real and counted. */
const dirsOf = (cwd: string) => gitDirsOfSync(cwd, env, args => {
  revParses++
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  return { code: result.status, stdout: result.stdout }
})

/** How many rev-parses `call` started. */
function revParsesOf<T>(call: () => T): { value: T; ran: number } {
  const before = revParses
  const value = call()
  return { value, ran: revParses - before }
}

/** The first call keeps the answer and the second confirms the files that guard it (git-dir.ts `store`): warm. */
function warm(root: string) {
  dirsOf(root)
  const dirs = dirsOf(root)
  expect(revParsesOf(() => dirsOf(root)).ran, 'warm: the answer is kept').toBe(0)
  return dirs
}

function repo(name: string): string {
  const root = join(sandbox, name)
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'a\n')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'a')
  return root
}

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-gitdir-stamp-')))
  const home = join(sandbox, 'home')
  mkdirSync(home)
  env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(GIT_|OXESPACE_)/i.test(name))), GIT_CEILING_DIRECTORIES: sandbox, HOME: home, USERPROFILE: home }
  delete env.XDG_CONFIG_HOME
  revParses = 0
  __forgetGitDirsForTests()
})

afterEach(() => {
  __forgetGitDirsForTests()
  try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ }
})

describe('the git-dir cache stamps a .git folder by identity', () => {
  test('1. a git status between two calls (the index rewritten inside .git) runs no second rev-parse', () => {
    const root = repo('status')
    const first = warm(root)
    const folderBefore = stamp(join(root, '.git'))
    // What a turn does: a tracked file changes, `git status` refreshes the index (index.lock renamed inside .git).
    writeFileSync(join(root, 'a.txt'), 'changed\n')
    git(root, 'status', '--porcelain')
    writeFileSync(join(root, '.git', 'FETCH_HEAD'), '')
    expect(stamp(join(root, '.git')), 'the folder\'s times did move').not.toBe(folderBefore)
    const after = revParsesOf(() => dirsOf(root))
    expect(after.value).toEqual(first)
    expect(after.ran, 'no rev-parse for the index write').toBe(0)
  })

  test('2. a .git folder swapped for a gitfile is resolved again, to where the gitfile points', () => {
    const root = repo('gitfile')
    expect(warm(root)?.gitDir.toLowerCase()).toBe(join(root, '.git').toLowerCase())
    const moved = join(sandbox, 'store', 'moved.git')
    mkdirSync(join(sandbox, 'store'))
    renameSync(join(root, '.git'), moved)
    writeFileSync(join(root, '.git'), `gitdir: ${moved}\n`)
    const after = revParsesOf(() => dirsOf(root))
    expect(after.ran).toBe(1)
    expect(after.value?.gitDir.toLowerCase()).toBe(moved.toLowerCase())
    warm(root)
    // A gitfile keeps the full stamp: rewriting it to point elsewhere is seen too.
    const other = join(sandbox, 'store', 'other.git')
    renameSync(moved, other)
    writeFileSync(join(root, '.git'), `gitdir: ${other}\n`)
    const again = revParsesOf(() => dirsOf(root))
    expect(again.ran).toBe(1)
    expect(again.value?.gitDir.toLowerCase()).toBe(other.toLowerCase())
  })

  test('3. a .git folder replaced by another one, or made bare, or no longer a repository, is resolved again', () => {
    const root = repo('replaced')
    warm(root)
    // Another folder (the old one kept, so its inode cannot be reused): a new identity.
    renameSync(join(root, '.git'), join(sandbox, 'old.git'))
    git(root, 'init', '-q', '-b', 'main')
    expect(revParsesOf(() => dirsOf(root)).ran).toBe(1)
    warm(root)
    // core.bare moves the work tree away: the config is a guard of its own now.
    git(root, 'config', 'core.bare', 'true')
    const bare = revParsesOf(() => dirsOf(root))
    expect(bare.ran).toBe(1)
    expect(bare.value?.topLevel).toBeNull()
    // The cwd is no longer under the folder git stopped at, so that answer is never kept (guardFiles: null).
    expect(revParsesOf(() => dirsOf(root)).ran).toBe(1)
    git(root, 'config', 'core.bare', 'false')
    const back = revParsesOf(() => dirsOf(root))
    expect(back.ran).toBe(1)
    expect(back.value?.topLevel?.toLowerCase()).toBe(root.toLowerCase())
    warm(root)
    // Without objects git no longer takes the folder for a repository: guarded, so asked again (and not kept).
    rmSync(join(root, '.git', 'objects'), { recursive: true, force: true })
    const gone = revParsesOf(() => dirsOf(root))
    expect(gone.ran).toBe(1)
    expect(gone.value).toBeNull()
  })

  test('4. a folder counts by device, inode and kind, and by its full stamp where the file system has no inode (0)', () => {
    const info = (over: Partial<Record<'ino' | 'dev' | 'size' | 'mtimeNs' | 'ctimeNs', bigint>> & { dir?: boolean }) => (() => ({
      isDirectory: () => over.dir ?? true, ino: over.ino ?? 7n, dev: over.dev ?? 3n, size: over.size ?? 0n, mtimeNs: over.mtimeNs ?? 1n, ctimeNs: over.ctimeNs ?? 1n
    }) as unknown as BigIntStats)
    // With an inode: the times inside do not count, another inode or device does.
    expect(guardStamp('x', info({ mtimeNs: 1n }))).toBe(guardStamp('x', info({ mtimeNs: 99n, ctimeNs: 99n })))
    expect(guardStamp('x', info({}))).not.toBe(guardStamp('x', info({ ino: 8n })))
    expect(guardStamp('x', info({}))).not.toBe(guardStamp('x', info({ dev: 4n })))
    // No inode: the full stamp, so a change inside is still seen.
    expect(guardStamp('x', info({ ino: 0n, mtimeNs: 1n }))).not.toBe(guardStamp('x', info({ ino: 0n, mtimeNs: 2n })))
    // A file (a gitfile) always keeps the full stamp, and never equals a folder's.
    expect(guardStamp('x', info({ dir: false, mtimeNs: 1n }))).not.toBe(guardStamp('x', info({ dir: false, mtimeNs: 2n })))
    expect(guardStamp('x', info({ dir: false, ino: 0n }))).not.toBe(guardStamp('x', info({ ino: 0n })))
    expect(guardStamp(join(sandbox, 'missing'))).toBe('-')
  })
})
