import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { GhExec } from '../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../electron/main/services/github/repository.service'
import { RepoHookTrust } from '../../electron/main/services/repo-config/trust'
import { parseWorktreeRemovalError } from '../../shared/types/github'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

describe('safe worktree removal (real git)', () => {
  let sandbox: string
  let root: string
  let service: GitHubRepositoryService
  let trust: RepoHookTrust
  let stopped: string[]

  beforeEach(() => {
    sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'oxe-wt-')))
    root = join(sandbox, 'main')
    mkdirSync(root)
    git(root, 'init', '-b', 'main')
    git(root, 'config', 'user.email', 't@t.t')
    git(root, 'config', 'user.name', 't')
    writeFileSync(join(root, 'a.txt'), 'a')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'init')

    const db = openInMemoryDatabase()
    trust = new RepoHookTrust(db)
    service = new GitHubRepositoryService(new GhExec({}))
    stopped = []
    service.configureWorktreeLifecycle({
      trust,
      stopTerminalsWithin: (dir) => {
        stopped.push(dir)
        return []
      }
    })
  })

  afterEach(() => {
    // Windows can keep a just-exited git's directory handle for a moment; a
    // leftover temp folder must not fail an otherwise-passing test.
    try {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      /* temp dir, reclaimed by the OS */
    }
  })

  async function addWorktree(name: string): Promise<string> {
    const path = join(sandbox, name)
    await service.createWorktree({ rootPath: root, branch: name, path, createBranch: true })
    return path
  }

  async function refusal(promise: Promise<unknown>): Promise<ReturnType<typeof parseWorktreeRemovalError>> {
    try {
      await promise
    } catch (error) {
      return parseWorktreeRemovalError((error as Error).message)
    }
    throw new Error('expected removal to be refused')
  }

  test('removes a clean worktree and tells terminals inside it to stop', async () => {
    const wt = await addWorktree('clean')
    const result = await service.removeWorktree({ rootPath: root, path: wt })
    expect(result.ok).toBe(true)
    expect(existsSync(wt)).toBe(false)
    expect(stopped).toHaveLength(1)
  })

  test('refuses the main checkout', async () => {
    expect((await refusal(service.removeWorktree({ rootPath: root, path: root, force: true }))).code).toBe('protected')
  })

  test('refuses an unregistered path', async () => {
    const stray = join(sandbox, 'stray')
    mkdirSync(stray)
    expect((await refusal(service.removeWorktree({ rootPath: root, path: stray, force: true }))).code).toBe('protected')
    expect(existsSync(stray)).toBe(true)
  })

  test('blocks on uncommitted work and removes it only when forced', async () => {
    const wt = await addWorktree('dirty')
    writeFileSync(join(wt, 'scratch.txt'), 'wip')
    expect((await refusal(service.removeWorktree({ rootPath: root, path: wt }))).code).toBe('dirty')
    expect(existsSync(wt)).toBe(true)

    await service.removeWorktree({ rootPath: root, path: wt, force: true })
    expect(existsSync(wt)).toBe(false)
  })

  test('a lock is never overridden by force', async () => {
    const wt = await addWorktree('locked')
    git(root, 'worktree', 'lock', wt)
    expect((await refusal(service.removeWorktree({ rootPath: root, path: wt, force: true }))).code).toBe('locked')
    expect(existsSync(wt)).toBe(true)
  })

  test('keeps an unmerged branch but deletes a merged one', async () => {
    const merged = await addWorktree('merged')
    await service.removeWorktree({ rootPath: root, path: merged, deleteBranch: true })
    expect(git(root, 'branch', '--list', 'merged').trim()).toBe('')

    const unmerged = await addWorktree('unmerged')
    writeFileSync(join(unmerged, 'b.txt'), 'b')
    git(unmerged, 'add', '.')
    git(unmerged, 'commit', '-m', 'work')
    const result = await service.removeWorktree({ rootPath: root, path: unmerged, deleteBranch: true })
    expect(result.message).toContain('mantido')
    expect(git(root, 'branch', '--list', 'unmerged').trim()).not.toBe('')
  })

  describe('oxe.yaml', () => {
    function writeConfig(yaml: string): void {
      writeFileSync(join(root, 'oxe.yaml'), yaml)
      git(root, 'add', 'oxe.yaml')
      git(root, 'commit', '-m', 'config')
    }

    test('links shared directories, and removal ignores and unlinks them', async () => {
      mkdirSync(join(root, 'node_modules'))
      writeFileSync(join(root, 'node_modules', 'dep.js'), 'x')
      writeFileSync(join(root, '.gitignore'), 'node_modules\n')
      writeConfig('worktree:\n  sharedDirectories: [node_modules]\n')

      const wt = await addWorktree('shared')
      expect(existsSync(join(wt, 'node_modules', 'dep.js'))).toBe(true)

      // Non-forced removal must not treat the link as user work.
      await service.removeWorktree({ rootPath: root, path: wt })
      expect(existsSync(wt)).toBe(false)
      // The primary's directory survives the link being removed.
      expect(existsSync(join(root, 'node_modules', 'dep.js'))).toBe(true)
    })

    test('setup runs only after approval', async () => {
      const marker = process.platform === 'win32' ? 'echo ran> setup-ran.txt' : 'echo ran > setup-ran.txt'
      writeConfig(`scripts:\n  setup: ${JSON.stringify(marker)}\n`)

      const skipped = await addWorktree('untrusted')
      expect(existsSync(join(skipped, 'setup-ran.txt'))).toBe(false)

      trust.approve(root, 'setup', marker)
      const ran = await addWorktree('trusted')
      expect(existsSync(join(ran, 'setup-ran.txt'))).toBe(true)
    })

    test('a failing archive hook blocks removal unless waived', async () => {
      writeConfig('scripts:\n  archive: "exit 7"\n')
      trust.approve(root, 'archive', 'exit 7')
      const wt = await addWorktree('archive')

      const blocked = await refusal(service.removeWorktree({ rootPath: root, path: wt, force: true }))
      expect(blocked.code).toBe('archive-failed')
      expect(existsSync(wt)).toBe(true)

      await service.removeWorktree({ rootPath: root, path: wt, force: true, allowFailedArchiveHook: true })
      expect(existsSync(wt)).toBe(false)
    })

    test('an unapproved archive hook is skipped, not run', async () => {
      writeConfig('scripts:\n  archive: "exit 7"\n')
      const wt = await addWorktree('unapproved')
      const result = await service.removeWorktree({ rootPath: root, path: wt })
      expect(result.message).toContain('não foi aprovado')
      expect(existsSync(wt)).toBe(false)
    })
  })

  test('symlink helper sanity: a real directory named like a link is user data', async () => {
    const wt = await addWorktree('realdir')
    mkdirSync(join(wt, 'node_modules'))
    writeFileSync(join(wt, 'node_modules', 'mine.js'), 'x')
    // Not a link, and not in config: it is an untracked file and must block.
    expect((await refusal(service.removeWorktree({ rootPath: root, path: wt }))).code).toBe('dirty')
  })
})
