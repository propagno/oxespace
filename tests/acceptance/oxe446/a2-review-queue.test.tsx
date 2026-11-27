// @vitest-environment jsdom
// Frozen acceptance test for OXE-446 (A2): Review Queue lifecycle (needs_review -> diff, badge count, Create PR,
// Open conversation, and Discard calling removeSharedLinks + deleting worktree and local branch without touching main checkout).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../src/i18n'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { GhExec } from '../../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../../electron/main/services/github/repository.service'
import { RepoHookTrust } from '../../../electron/main/services/repo-config/trust'
import { ScheduleStore } from '../../../electron/main/services/schedules/schedule-store'
import { Scheduler } from '../../../electron/main/services/schedules/scheduler'
import { scheduleThreadRunner } from '../../../electron/main/services/schedules/thread-runner'
import { SchedulesDialog } from '../../../src/components/Schedules/SchedulesDialog'
import { useThreadStore } from '../../../src/store/thread.store'
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
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe446-a2-')))
  repo = join(sandbox, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'oxe446@test.invalid')
  git(repo, 'config', 'user.name', 'OXE-446')
  put(repo, '.gitignore', 'node_modules/\n')
  put(repo, 'src/feature.ts', 'export const feature = "original"\n')
  put(repo, 'oxe.yaml', 'worktree:\n  sharedDirectories:\n    - node_modules\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'initial')
  put(repo, 'node_modules/shared-lib/index.js', 'module.exports = "keep-intact"\n')

  db = openInMemoryDatabase()
  repoService = new GitHubRepositoryService(new GhExec({}))
  repoService.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
  useThreadStore.setState({
    projects: [{ projectId: 'p1', displayName: 'shop-api', identityLabel: 'shop-api', hidden: false, contexts: [{ rootPath: repo, label: 'repo' }] }],
    loadProjects: async () => undefined
  } as never)
})

afterEach(() => {
  cleanup()
  delete (window as { oxe?: unknown }).oxe
  db.close()
  try { removeTempDir(sandbox) } catch { /* temp dir */ }
})

describe('OXE-446 A2 · Review Queue backend actions and UI', () => {
  it('lists needs_review runs with diff, creates PRs, and discards worktrees safely without touching main checkout or shared links', async () => {
    let threadCounter = 0
    const createdRoots = new Map<string, string>()
    const service = {
      create: vi.fn((ctx: { rootPath: string }) => {
        const id = `thread-rq-${++threadCounter}`
        createdRoots.set(id, ctx.rootPath)
        return { thread: { id, configurationRevision: 0 } }
      }),
      command: vi.fn(async () => ({ kind: 'applied' })),
      configure: vi.fn(async () => ({})),
      send: vi.fn(async (id: string) => {
        const root = createdRoots.get(id)!
        put(root, 'src/feature.ts', `export const feature = "updated-by-${id}"\nexport const extra = true\n`)
      }),
      read: vi.fn((id: string) => ({ thread: { id, configurationRevision: 1, status: 'idle' } })),
      interrupt: vi.fn(async () => undefined)
    }

    const pushBranch = vi.fn(async () => undefined)
    const createPullRequest = vi.fn(async () => ({ url: 'https://github.com/propagno/oxespace/pull/999' }))
    const removeWorktreeSpy = vi.spyOn(repoService, 'removeWorktree')

    const worktrees = {
      createWorktree: (input: Parameters<GitHubRepositoryService['createWorktree']>[0]) => repoService.createWorktree(input),
      resolveBaseRef: async (rootPath: string) => (await repoService.resolveWorktreeBase({ workspaceId: 'p1', rootPath })).baseRef,
      removeWorktree: (input: Parameters<GitHubRepositoryService['removeWorktree']>[0]) => repoService.removeWorktree(input),
      pushBranch,
      createPullRequest
    }

    const scheduler = new Scheduler({
      store: new ScheduleStore(db),
      ...scheduleThreadRunner({ service: async () => service as never, context: (projectId, rootPath) => ({ projectId, rootPath }), worktrees })
    })

    const saved = scheduler.save({
      name: 'Refactor Feature',
      projectId: 'p1',
      rootPath: repo,
      provider: 'claude',
      access: 'workspace-write',
      confirmedWrite: true,
      prompt: 'Update feature implementation.',
      rule: { kind: 'cron', expression: '0 3 * * *' }
    })

    const run1 = await scheduler.runNow(saved.id)
    await scheduler.completeRun(run1.id, { status: 'completed', summaryMd: 'Refactored feature (run 1).' })

    const run2 = await scheduler.runNow(saved.id)
    await scheduler.completeRun(run2.id, { status: 'completed', summaryMd: 'Refactored feature (run 2).' })

    const queue = scheduler.reviewQueue()
    expect(queue.count).toBe(2)
    expect(queue.items.map(item => item.run.id)).toEqual(expect.arrayContaining([run1.id, run2.id]))

    const diff1 = await scheduler.reviewDiff(run1.id)
    expect(diff1.filesChanged).toBe(1)
    expect(diff1.additions).toBe(2)
    expect(diff1.deletions).toBe(1)
    expect(diff1.unifiedDiff).toContain('updated-by-thread-rq-1')

    // Create PR from run2
    const prResult = await scheduler.createPrFromRun(run2.id)
    expect(pushBranch).toHaveBeenCalledTimes(1)
    expect(createPullRequest).toHaveBeenCalledTimes(1)
    expect(prResult.prUrl).toBe('https://github.com/propagno/oxespace/pull/999')
    expect(prResult.run.outcome).toBe('approved')
    expect(prResult.run.prUrl).toBe('https://github.com/propagno/oxespace/pull/999')
    expect(scheduler.reviewQueue().count).toBe(1)

    // Discard run1: must call removeWorktree (which calls removeSharedLinks), delete worktree folder + local automation branch,
    // and preserve original main checkout files & shared node_modules contents!
    const discardResult = await scheduler.discardRun(run1.id)
    expect(removeWorktreeSpy).toHaveBeenCalledTimes(1)
    expect(discardResult.run.outcome).toBe('discarded')
    expect(discardResult.run.reviewStatus).toBe('discarded')
    expect(existsSync(run1.worktreePath!)).toBe(false)
    const branches = git(repo, 'branch', '--list', run1.branchName!).trim()
    expect(branches).toBe('')
    expect(readFileSync(join(repo, 'node_modules', 'shared-lib', 'index.js'), 'utf8')).toBe('module.exports = "keep-intact"\n')
    expect(readFileSync(join(repo, 'src', 'feature.ts'), 'utf8')).toBe('export const feature = "original"\n')
    expect(scheduler.reviewQueue().count).toBe(0)

    // Cleanup remaining run2 worktree
    await repoService.removeWorktree({ rootPath: repo, path: run2.worktreePath!, force: true })
  })

  it('renders Review Queue tab with accurate badge count, readable diff, and working Create PR / Open conversation / Discard UI actions', async () => {
    const onOpenThread = vi.fn()
    const onClose = vi.fn()

    let items = [{
      run: {
        id: 'run-ui-1',
        scheduleId: 's1',
        dueAt: 1_700_000_000_000,
        at: 1_700_000_001_000,
        finishedAt: 1_700_000_060_000,
        outcome: 'needs_review' as const,
        reviewStatus: 'pending' as const,
        threadId: 'thread-ui-1',
        detail: null,
        worktreePath: '/tmp/wt-ui-1',
        branchName: 'automation/fix-ci-abc123',
        summaryMd: 'Fixed failing unit test in checkout service.',
        filesChanged: 1,
        additions: 4,
        deletions: 2,
        prUrl: null
      },
      scheduleName: 'Fix CI',
      projectId: 'p1',
      rootPath: repo,
      provider: 'claude' as const,
      access: 'workspace-write' as const
    }]

    const createPrFromRun = vi.fn(async () => ({
      ok: true as const,
      value: { run: { ...items[0].run, outcome: 'approved' as const, reviewStatus: 'approved' as const, prUrl: 'https://github.com/org/repo/pull/42' }, prUrl: 'https://github.com/org/repo/pull/42' }
    }))
    const discardRun = vi.fn(async () => {
      const target = items[0].run
      items = []
      return { ok: true as const, value: { run: { ...target, outcome: 'discarded' as const, reviewStatus: 'discarded' as const } } }
    })

    Object.assign(window, {
      oxe: {
        schedules: {
          state: vi.fn(async () => ({ paused: false, maxConcurrent: 2, reviewPendingCount: items.length, schedules: [] })),
          runs: vi.fn(async () => []),
          save: vi.fn(),
          remove: vi.fn(),
          setEnabled: vi.fn(),
          setPaused: vi.fn(),
          setMaxConcurrent: vi.fn(async (n: number) => ({ ok: true as const, value: n })),
          runNow: vi.fn(),
          reviewQueue: vi.fn(async () => ({ count: items.length, items })),
          reviewDiff: vi.fn(async () => ({
            ok: true as const,
            value: {
              runId: 'run-ui-1',
              scheduleId: 's1',
              scheduleName: 'Fix CI',
              branchName: 'automation/fix-ci-abc123',
              worktreePath: '/tmp/wt-ui-1',
              summaryMd: 'Fixed failing unit test in checkout service.',
              filesChanged: 1,
              additions: 4,
              deletions: 2,
              files: [{ path: 'src/checkout.ts', additions: 4, deletions: 2 }],
              unifiedDiff: '--- a/src/checkout.ts\n+++ b/src/checkout.ts\n@@ -1,2 +1,4 @@\n-return false\n+return true',
              prUrl: null
            }
          })),
          createPrFromRun,
          applyRunToCheckout: vi.fn(async () => ({ ok: true as const, value: { run: { ...items[0].run, outcome: 'merged' as const, reviewStatus: 'merged' as const } } })),
          discardRun,
          onChanged: vi.fn(() => () => undefined)
        }
      }
    })

    render(<SchedulesDialog initialTab="review" onClose={onClose} onOpenThread={onOpenThread} />)

    expect(await screen.findByTestId('review-queue-count')).toHaveTextContent('1')
    expect(await screen.findByText('Fixed failing unit test in checkout service.')).toBeInTheDocument()
    expect(await screen.findByText(/\+return true/)).toBeInTheDocument()

    // Open conversation
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(onOpenThread).toHaveBeenCalledWith('thread-ui-1')
    expect(onClose).toHaveBeenCalled()

    // Create PR
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    await waitFor(() => expect(createPrFromRun).toHaveBeenCalledWith('run-ui-1'))

    // Discard with confirmation
    fireEvent.click(screen.getByRole('button', { name: 'Discard worktree' }))
    const confirmDialog = await screen.findByTestId('review-confirm-discard')
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(discardRun).toHaveBeenCalledWith('run-ui-1'))
  })
})
