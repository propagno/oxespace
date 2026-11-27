// @vitest-environment node
// Frozen acceptance test for OXE-444 (A2): sharedDirectories git check-ignore guard + safe unlink on removal.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db'
import { GhExec } from '../../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../../electron/main/services/github/repository.service'
import { createSharedLinksDetailed } from '../../../electron/main/services/repo-config/shared-dirs'
import { RepoHookTrust } from '../../../electron/main/services/repo-config/trust'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let sandbox: string
let repo: string
let closeDb: () => void
let service: GitHubRepositoryService

function put(base: string, rel: string, text = rel): void {
  const file = join(base, ...rel.split('/'))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe444-a2-')))
  repo = join(sandbox, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'oxe444@test.invalid')
  git(repo, 'config', 'user.name', 'OXE-444')
  put(repo, '.gitignore', 'node_modules/\n.cache/\n')
  put(repo, 'src/index.ts', 'export const tracked = true\n')
  put(repo, 'oxe.yaml', 'worktree:\n  sharedDirectories:\n    - node_modules\n    - src\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'initial')
  put(repo, 'node_modules/pkg/index.js', 'module.exports = 42\n')

  const db = openInMemoryDatabase()
  closeDb = () => db.close()
  service = new GitHubRepositoryService(new GhExec({}))
  service.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
})

afterEach(() => {
  closeDb()
  try { removeTempDir(sandbox) } catch { /* temp dir */ }
})

describe('OXE-444 A2 · sharedDirectories git check-ignore guard and safe removal', () => {
  it('links only gitignored sharedDirectories, refuses tracked directories with tracked-in-git, and unlinks safely on removal', async () => {
    const wtPath = join(sandbox, 'wt-a2')
    const result = await service.createWorktree({
      rootPath: repo,
      branch: 'feat/a2-shared-dirs',
      path: wtPath,
      createBranch: true,
      baseRef: 'main'
    })

    expect(result.ok).toBe(true)
    expect(existsSync(join(wtPath, 'node_modules'))).toBe(true)
    expect(lstatSync(join(wtPath, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(realpathSync.native(join(wtPath, 'node_modules')).toLowerCase()).toBe(
      realpathSync.native(join(repo, 'node_modules')).toLowerCase()
    )

    // Tracked `src` directory must remain a normal checkout directory, NEVER symlinked to primary repo
    expect(lstatSync(join(wtPath, 'src')).isSymbolicLink()).toBe(false)
    expect(result.report?.linked).toEqual(['node_modules'])
    expect(result.report?.skipped).toEqual(
      expect.arrayContaining([
        { path: 'src', kind: 'shared-dir', reason: 'tracked-in-git' }
      ])
    )
    expect(result.notices).toContainEqual({
      code: 'worktree.sharedDirs.trackedInGit',
      params: { paths: ['src'] }
    })

    // Removing worktree unlinks shared links without touching main checkout files
    await service.removeWorktree({ rootPath: repo, path: wtPath, force: true })
    expect(existsSync(wtPath)).toBe(false)
    expect(readFileSync(join(repo, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 42\n')
    expect(readFileSync(join(repo, 'src', 'index.ts'), 'utf8')).toBe('export const tracked = true\n')
  })

  it('fails closed on empty inputs or when git check-ignore fails', async () => {
    const emptyTree = join(sandbox, 'wt-empty')
    mkdirSync(emptyTree, { recursive: true })
    const empty = await createSharedLinksDetailed(repo, emptyTree, [])
    expect(empty.linked).toEqual([])
    expect(empty.skipped).toEqual([])
    expect(empty.notices).toEqual([])

    const failedCheck = await createSharedLinksDetailed(repo, emptyTree, ['node_modules'], {
      isIgnored: async () => null
    })
    expect(failedCheck.linked).toEqual([])
    expect(failedCheck.skipped).toEqual([{ path: 'node_modules', kind: 'shared-dir', reason: 'ignore-check-failed' }])
    expect(failedCheck.notices).toContainEqual({ code: 'worktree.sharedDirs.ignoreCheckFailed', params: {} })
    expect(existsSync(join(emptyTree, 'node_modules'))).toBe(false)
  })
})
