// @vitest-environment node
// Frozen acceptance test for OXE-446 (A1): mandatory isolated worktree provisioning (inheriting OXE-444 templates),
// zero main checkout mutations, real diff stats recording, and additive migration 110 preservation.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { GhExec } from '../../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../../electron/main/services/github/repository.service'
import { RepoHookTrust } from '../../../electron/main/services/repo-config/trust'
import { ScheduleStore } from '../../../electron/main/services/schedules/schedule-store'
import { Scheduler } from '../../../electron/main/services/schedules/scheduler'
import { scheduleThreadRunner } from '../../../electron/main/services/schedules/thread-runner'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let sandbox: string
let repo: string
let db: AppDatabase
let repoService: GitHubRepositoryService

function put(base: string, rel: string, text: string): void {
  const file = join(base, ...rel.split('/'))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text, 'utf8')
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe446-a1-')))
  repo = join(sandbox, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'oxe446@test.invalid')
  git(repo, 'config', 'user.name', 'OXE-446')
  put(repo, '.gitignore', 'node_modules/\nconfig/local.json\n')
  put(repo, 'src/app.ts', 'export const version = 1\nexport const stable = true\n')
  put(repo, 'oxe.yaml', 'worktree:\n  sharedDirectories:\n    - node_modules\n')
  put(repo, '.worktreeinclude', 'config/local.json\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'initial')
  put(repo, 'node_modules/pkg/index.js', 'module.exports = "shared-ok"\n')
  put(repo, 'config/local.json', '{"mode":"dev"}\n')
  // Dirty user edits in main checkout must survive untouched.
  put(repo, 'src/dirty-user-work.ts', 'export const userDraft = true\n')

  db = openInMemoryDatabase()
  repoService = new GitHubRepositoryService(new GhExec({}))
  repoService.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
})

afterEach(() => {
  db.close()
  try { removeTempDir(sandbox) } catch { /* temp dir */ }
})

describe('OXE-446 A1 · workspace-write automation executes in mandatory isolated worktree without mutating main checkout', () => {
  it('provisions an automation/<slug>-<shortRunId> worktree with OXE-444 templates, isolates writes, and records real diff stats', async () => {
    expect(LATEST_DB_VERSION).toBeGreaterThanOrEqual(110)

    let createdThreadRoot = ''
    const service = {
      create: vi.fn((ctx: { workspaceId: string; projectId: string; rootPath: string; provider: string }) => {
        createdThreadRoot = ctx.rootPath
        return { thread: { id: 'thread-a1', configurationRevision: 0 } }
      }),
      command: vi.fn(async () => ({ kind: 'applied' })),
      configure: vi.fn(async () => ({})),
      send: vi.fn(async () => {
        // Simulate agent editing tracked file and creating a new file inside its assigned thread rootPath.
        put(createdThreadRoot, 'src/app.ts', 'export const version = 2\nexport const stable = true\nexport const automated = true\n')
        put(createdThreadRoot, 'src/generated.ts', 'export const a = 1\nexport const b = 2\nexport const c = 3\n')
      }),
      read: vi.fn((id: string) => ({ thread: { id, configurationRevision: 1, status: 'idle' } })),
      interrupt: vi.fn(async () => undefined)
    }

    const worktrees = {
      createWorktree: (input: Parameters<GitHubRepositoryService['createWorktree']>[0]) => repoService.createWorktree(input),
      resolveBaseRef: async (rootPath: string) => (await repoService.resolveWorktreeBase({ workspaceId: 'p1', rootPath })).baseRef,
      removeWorktree: (input: Parameters<GitHubRepositoryService['removeWorktree']>[0]) => repoService.removeWorktree(input)
    }

    const notifications: Array<{ kind: string; runId: string }> = []
    const runner = scheduleThreadRunner({
      service: async () => service as never,
      context: (projectId, rootPath) => ({ projectId, rootPath }),
      worktrees
    })

    const store = new ScheduleStore(db)
    const scheduler = new Scheduler({
      store,
      ...runner,
      notify: (payload) => { notifications.push({ kind: payload.kind, runId: payload.runId }); return true }
    })

    const saved = scheduler.save({
      name: 'Nightly Lint Fix',
      projectId: 'p1',
      rootPath: repo,
      provider: 'claude',
      access: 'workspace-write',
      confirmedWrite: true,
      prompt: 'Fix lint issues and add generated helper.',
      rule: { kind: 'cron', expression: '0 2 * * *' }
    })

    const started = await scheduler.runNow(saved.id)
    expect(started.worktreePath).toBeTruthy()
    expect(started.branchName).toMatch(/^automation\/nightly-lint-fix-[a-z0-9]+$/)
    expect(realpathSync.native(createdThreadRoot).toLowerCase()).toBe(realpathSync.native(started.worktreePath!).toLowerCase())
    expect(realpathSync.native(createdThreadRoot).toLowerCase()).not.toBe(realpathSync.native(repo).toLowerCase())

    // Inherited OXE-444 template provisioning: sharedDirectory symlink + .worktreeinclude copyFile.
    expect(lstatSync(join(started.worktreePath!, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(started.worktreePath!, 'config', 'local.json'), 'utf8')).toBe('{"mode":"dev"}\n')

    // Main checkout MUST NOT be modified at all.
    expect(readFileSync(join(repo, 'src', 'app.ts'), 'utf8')).toBe('export const version = 1\nexport const stable = true\n')
    expect(readFileSync(join(repo, 'src', 'dirty-user-work.ts'), 'utf8')).toBe('export const userDraft = true\n')
    expect(existsSync(join(repo, 'src', 'generated.ts'))).toBe(false)

    // Complete run and verify diff stats + needs_review persistence + notification.
    const finished = await scheduler.completeRun(started.id, {
      status: 'completed',
      summaryMd: 'Updated version and created generated helper.'
    })

    expect(finished.outcome).toBe('needs_review')
    expect(finished.reviewStatus).toBe('pending')
    expect(finished.finishedAt).toBeTypeOf('number')
    expect(finished.summaryMd).toBe('Updated version and created generated helper.')
    expect(finished.filesChanged).toBe(2)
    expect(finished.additions).toBe(5)
    expect(finished.deletions).toBe(1)
    const rawRow = db.prepare('SELECT files_changed, additions, deletions, review_status FROM schedule_runs WHERE id = ?').get(started.id) as { files_changed: number; additions: number; deletions: number; review_status: string }
    expect(rawRow).toEqual({ files_changed: 2, additions: 5, deletions: 1, review_status: 'pending' })
    expect(notifications).toContainEqual({ kind: 'needs_review', runId: started.id })
  })
})
