// Frozen acceptance test for 1.5.0 A63 / N9 (OXE program, phase F4): the Worktrees panel lists each worktree's owning
// conversation, branch, merged state (A60's rule: the provider first, git as the fallback), changed files, disk use and
// last activity, merged first then oldest first. Remove refuses uncommitted changes, never forces, and deletes the
// branch only when asked (an unmerged one only when that was confirmed too).
// Written by the planner; the executor must not edit it. Real git in temp dirs; the provider is a fake.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A63 and DESIGN's 1.5.0-f4-design.md U4.7 (Worktrees).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a63-worktrees-panel.native.test.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { GhExec } from '../../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../../electron/main/services/github/repository.service'
import { WorktreesPanel, type WorktreeOwner } from '../../../electron/main/services/github/worktrees-panel'
import { RepoHookTrust } from '../../../electron/main/services/repo-config/trust'
import { messageFromError } from '../../../shared/messages'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })
const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

let sandbox: string
let root: string
let repo: GitHubRepositoryService
let owners: WorktreeOwner[]
/** The fake provider: which branches it says are merged, and by which PR. */
let providerMerged: Map<string, number>
let providerAvailable: boolean
let panel: WorktreesPanel

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f4-wt-')))
  root = join(sandbox, 'main'); mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 't@t.t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, 'a.txt'), 'a'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'init')
  const gh = new GhExec({})
  repo = new GitHubRepositoryService(gh)
  repo.configureWorktreeLifecycle({ trust: new RepoHookTrust(openInMemoryDatabase()) })
  owners = []
  providerMerged = new Map()
  providerAvailable = true
  panel = new WorktreesPanel({
    gh,
    owners: () => owners,
    provider: {
      merged: async ({ branch }) => providerAvailable
        ? (providerMerged.has(branch) ? { by: 'provider' as const, value: true, prNumber: providerMerged.get(branch) } : { by: 'provider' as const, value: false })
        : { by: 'git' as const, value: (await gh.git(['merge-base', '--is-ancestor', branch, 'main'], root)).status === 0 }
    },
    removeWorktree: input => repo.removeWorktree(input)
  })
})
afterEach(() => { try { removeTempDir(sandbox) } catch { /* temp */ } })

const add = async (name: string): Promise<string> => {
  const path = join(sandbox, name)
  await repo.createWorktree({ rootPath: root, branch: name, path, createBranch: true })
  return path
}
const row = async (path: string) => {
  const hit = (await panel.list({ rootPath: root })).find(entry => same(entry.path, path))
  if (!hit) throw new Error(`no row for ${path}`)
  return hit
}
const branches = (): string[] => git(root, 'branch', '--format=%(refname:short)').split('\n').filter(Boolean)

describe('A63 · the Worktrees panel', () => {
  test('A63: each row has the owner, branch, merged state, changed files, disk use and last activity; the main checkout is not a row', async () => {
    const tree = await add('agent-fix')
    owners.push({ conversationId: 't1', title: 'Fix login', worktreePath: tree, branch: 'agent-fix', gone: false })
    writeFileSync(join(tree, 'wip.txt'), 'x'.repeat(5000))
    const list = await panel.list({ rootPath: root })
    expect(list.some(entry => same(entry.path, root))).toBe(false)
    const entry = await row(tree)
    expect(entry).toMatchObject({ branch: 'agent-fix', conversation: { id: 't1', title: 'Fix login', gone: false }, merged: { by: 'provider', value: false }, prNumber: null, changed: 1, branchChanged: false })
    expect(entry.diskBytes).toBeGreaterThanOrEqual(5000)
    expect(typeof entry.lastActivity).toBe('number')
  })

  test('A63: a worktree with no owner shows none; a removed conversation is kept by name, marked gone', async () => {
    const lone = await add('lone')
    const orphan = await add('orphan')
    owners.push({ conversationId: 't9', title: 'Old task', worktreePath: orphan, branch: 'orphan', gone: true })
    expect((await row(lone)).conversation).toBeNull()
    expect((await row(orphan)).conversation).toEqual({ id: 't9', title: 'Old task', gone: true })
  })

  test('A63: merged comes from the provider (a squash merge git cannot see), with its PR number', async () => {
    const tree = await add('squashed')
    writeFileSync(join(tree, 's.txt'), 's'); git(tree, 'add', '.'); git(tree, 'commit', '-qm', 's')
    providerMerged.set('squashed', 77)
    expect(await row(tree)).toMatchObject({ merged: { by: 'provider', value: true }, prNumber: 77 })
  })

  test('A63: without a provider, merged falls back to git and says so', async () => {
    providerAvailable = false
    const merged = await add('done')
    const open = await add('open-work')
    writeFileSync(join(open, 'o.txt'), 'o'); git(open, 'add', '.'); git(open, 'commit', '-qm', 'o')
    expect((await row(merged)).merged).toEqual({ by: 'git', value: true })
    expect((await row(open)).merged).toEqual({ by: 'git', value: false })
  })

  test('A63: the branch changed since the conversation made it is flagged', async () => {
    const tree = await add('agent-fix')
    owners.push({ conversationId: 't1', title: 'Fix login', worktreePath: tree, branch: 'agent-fix', gone: false })
    git(tree, 'switch', '-q', '-c', 'something-else')
    expect(await row(tree)).toMatchObject({ branch: 'something-else', branchChanged: true })
  })

  test('A63: disk use never follows a link out of the worktree', async () => {
    const tree = await add('linked')
    const big = join(sandbox, 'big'); mkdirSync(big); writeFileSync(join(big, 'blob.bin'), Buffer.alloc(3 * 1024 * 1024))
    symlinkSync(big, join(tree, 'node_modules'), 'junction')
    expect((await row(tree)).diskBytes).toBeLessThan(1024 * 1024)
  })

  test('A63: merged rows come first, then the oldest activity first', async () => {
    // Activity is the newest of the folder, HEAD and the reflog (worktree-cleanup.ts lastWorktreeActivity), in seconds.
    await add('old')
    await new Promise(resolve => setTimeout(resolve, 1500))
    const recent = await add('recent')
    writeFileSync(join(recent, 'r.txt'), 'r'); git(recent, 'add', '.'); git(recent, 'commit', '-qm', 'r')
    await add('merged')
    providerMerged.set('merged', 5)
    const order = (await panel.list({ rootPath: root })).map(entry => entry.branch)
    expect(order[0]).toBe('merged')
    expect(order.indexOf('old')).toBeLessThan(order.indexOf('recent'))
  })

  test('A63: Remove refuses uncommitted changes with worktree.remove.dirty, and removes nothing', async () => {
    const tree = await add('dirty')
    writeFileSync(join(tree, 'wip.txt'), 'x')
    const result = await panel.remove({ rootPath: root, path: tree, deleteBranch: false })
    expect(result).toEqual({ ok: false, refusal: { code: 'worktree.remove.dirty', params: { count: 1 } } })
    expect(existsSync(join(tree, 'wip.txt'))).toBe(true)
    expect(branches()).toContain('dirty')
  })

  test('A63: Remove keeps the branch unless asked; a merged branch is deleted when asked', async () => {
    const kept = await add('kept')
    expect(await panel.remove({ rootPath: root, path: kept, deleteBranch: false })).toEqual({ ok: true, branchDeleted: false })
    expect(existsSync(kept)).toBe(false)
    expect(branches()).toContain('kept')
    const merged = await add('merged-one')
    providerMerged.set('merged-one', 9)
    expect(await panel.remove({ rootPath: root, path: merged, deleteBranch: true })).toEqual({ ok: true, branchDeleted: true })
    expect(branches()).not.toContain('merged-one')
  })

  test('A63: an unmerged branch is deleted only when that was confirmed too; otherwise nothing is removed', async () => {
    const tree = await add('unmerged')
    writeFileSync(join(tree, 'u.txt'), 'u'); git(tree, 'add', '.'); git(tree, 'commit', '-qm', 'u')
    expect(await panel.remove({ rootPath: root, path: tree, deleteBranch: true })).toEqual({ ok: false, refusal: { code: 'worktree.remove.unmergedBranch', params: { branch: 'unmerged' } } })
    expect(existsSync(tree)).toBe(true)
    expect(await panel.remove({ rootPath: root, path: tree, deleteBranch: true, confirmUnmerged: true })).toEqual({ ok: true, branchDeleted: true })
    expect(branches()).not.toContain('unmerged')
  })

  test('A63: a path that is not one of this repository\'s worktrees, or the main checkout, is refused', async () => {
    const elsewhere = join(sandbox, 'elsewhere'); mkdirSync(elsewhere)
    for (const path of [elsewhere, root]) {
      const result = await panel.remove({ rootPath: root, path, deleteBranch: false }).catch((cause: unknown) => ({ ok: false as const, refusal: messageFromError(cause) }))
      expect(result).toEqual({ ok: false, refusal: { code: 'worktree.remove.notFound', params: {} } })
    }
    expect(existsSync(elsewhere)).toBe(true)
  })
})
