// Frozen acceptance test for 1.5.0 A63 / N9 (OXE program, phase F4): the Worktrees panel lists each worktree's owning
// conversation, branch, merged state (A60's rule: the provider first, git as the fallback), changed files, disk use and
// last activity, merged first then oldest first. Remove refuses uncommitted changes, never forces, and deletes the
// branch only when asked (an unmerged one only when that was confirmed too). SECURITY (TECH LEAD S3–S5) and HML 704-5..7:
// the main checkout is guarded on its real path; a busy, locked or missing worktree is handled; the default branch, a
// branch checked out anywhere and any remote branch are never deleted; every git call is an argument array with -- before
// positionals and no shell; each Remove and branch delete writes one audit row.
// Written by the planner; the executor must not edit it. Real git in temp dirs; the provider is a fake.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A63 and DESIGN's 1.5.0-f4-design.md U4.7 (Worktrees).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a63-worktrees-panel.native.test.ts
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { GhExec, type SpawnAsyncFn } from '../../../electron/main/services/github/gh-exec'
import { PersonActionAudit } from '../../../electron/main/services/person-action-audit'
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
let db: AppDatabase
/** Why a worktree is busy, per path (a pane inside it, or its conversation mid-turn), as main's activity source says. */
let busy: Map<string, 'pane' | 'turn'>
/** Every process the panel's GhExec ran: command, arguments, and whether a shell was asked for. */
let spawned: Array<{ command: string; args: string[]; shell: boolean }>
/** When set, the next worktree removal fails the way a Windows file lock does. */
let failNextRemove: boolean

/** A real spawner (no shell, an argument array) that records every call. */
const recording: SpawnAsyncFn = (command, args, options) => {
  spawned.push({ command, args, shell: options.shell === true })
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true })
    let stdout = ''; let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => resolve({ stdout, stderr, status: null, error }))
    child.on('close', status => resolve({ stdout, stderr, status }))
    if (options.input !== undefined) child.stdin.end(options.input); else child.stdin.end()
  })
}

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f4-wt-')))
  root = join(sandbox, 'main'); mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.email', 't@t.t'); git(root, 'config', 'user.name', 't'); git(root, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, 'a.txt'), 'a'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'init')
  spawned = []
  busy = new Map()
  failNextRemove = false
  db = openInMemoryDatabase()
  const gh = new GhExec({ spawnCommand: recording })
  repo = new GitHubRepositoryService(gh)
  repo.configureWorktreeLifecycle({ trust: new RepoHookTrust(db) })
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
    removeWorktree: input => {
      if (failNextRemove) { failNextRemove = false; return Promise.reject(new Error("EBUSY: resource busy or locked, rmdir 'node_modules'")) }
      return repo.removeWorktree(input)
    },
    busy: path => [...busy].find(([entry]) => same(entry, path))?.[1] ?? null,
    audit: new PersonActionAudit(db)
  })
})
afterEach(() => { try { db.close() } catch { /* closed */ } try { removeTempDir(sandbox) } catch { /* temp */ } })
const audit = () => db.prepare('SELECT actor, action, target, outcome, code FROM person_action_audit ORDER BY id').all() as Array<{ actor: string; action: string; target: string; outcome: string; code: string | null }>

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
    expect(existsSync(join(root, 'a.txt'))).toBe(true)
    expect(git(root, 'rev-parse', '--is-inside-work-tree').trim()).toBe('true')
  })
})

describe('A63 · SECURITY and HML guards on Remove', () => {
  const refusal = async (input: Parameters<WorktreesPanel['remove']>[0]) => {
    const result = await panel.remove(input).catch((cause: unknown) => ({ ok: false as const, refusal: messageFromError(cause) }))
    return result.ok ? null : result.refusal
  }

  test('HML 704-5: the main checkout is refused on its real path: a trailing separator, another case, a .. walk, and a link or junction to it', async () => {
    const tree = await add('kept-tree')
    const linkToMain = join(sandbox, 'link-to-main'); symlinkSync(root, linkToMain, 'junction')
    const linkToTree = join(sandbox, 'link-to-tree'); symlinkSync(tree, linkToTree, 'junction')
    const forms = [`${root}${process.platform === 'win32' ? '\\' : '/'}`, join(root, 'sub', '..'), linkToMain, linkToTree]
    if (process.platform === 'win32') forms.push(root.toUpperCase(), root.toLowerCase())
    for (const path of forms) {
      expect(await refusal({ rootPath: root, path, deleteBranch: true, confirmUnmerged: true }), path).toEqual({ code: 'worktree.remove.notFound', params: {} })
    }
    expect(existsSync(join(root, 'a.txt'))).toBe(true)
    expect(existsSync(tree)).toBe(true)
    expect(branches()).toEqual(expect.arrayContaining(['main', 'kept-tree']))
  })

  test('HML 704-6: a pane inside the worktree, or its conversation mid-turn, refuses with worktree.remove.busy and removes nothing', async () => {
    const tree = await add('busy-tree')
    busy.set(tree, 'pane')
    expect(await refusal({ rootPath: root, path: tree, deleteBranch: true })).toEqual({ code: 'worktree.remove.busy', params: { reason: 'pane' } })
    busy.set(tree, 'turn')
    expect(await refusal({ rootPath: root, path: tree, deleteBranch: true })).toEqual({ code: 'worktree.remove.busy', params: { reason: 'turn' } })
    expect(existsSync(tree)).toBe(true)
    busy.delete(tree)
    expect(await panel.remove({ rootPath: root, path: tree, deleteBranch: false })).toEqual({ ok: true, branchDeleted: false })
  })

  test('HML 704-6: a git failure mid-remove (a Windows lock) is a refusal, not a throw, and the row stays listed', async () => {
    const tree = await add('locked-by-os')
    failNextRemove = true
    const result = await panel.remove({ rootPath: root, path: tree, deleteBranch: true })
    expect(result).toEqual({ ok: false, refusal: { code: 'worktree.remove.failed', params: {} } })
    expect((await panel.list({ rootPath: root })).some(entry => same(entry.path, tree))).toBe(true)
    expect(branches()).toContain('locked-by-os')
  })

  test('HML 704-7: a locked worktree is refused with its reason; a missing one is listed as missing and Remove prunes it', async () => {
    const locked = await add('locked')
    git(root, 'worktree', 'lock', '--reason', 'on a USB disk', locked)
    expect(await refusal({ rootPath: root, path: locked, deleteBranch: false })).toEqual({ code: 'worktree.remove.locked', params: { reason: 'on a USB disk' } })
    expect(existsSync(locked)).toBe(true)
    const gone = await add('gone')
    rmSync(gone, { recursive: true, force: true })
    expect(await row(gone)).toMatchObject({ missing: true })
    expect(await panel.remove({ rootPath: root, path: gone, deleteBranch: false })).toEqual({ ok: true, branchDeleted: false })
    expect(git(root, 'worktree', 'list', '--porcelain')).not.toContain('gone')
  })

  test('S4: the default branch is never deleted, even confirmed', async () => {
    git(root, 'switch', '-q', '-c', 'elsewhere')
    const onMain = join(sandbox, 'on-main')
    git(root, 'worktree', 'add', '-q', onMain, 'main')
    expect(await refusal({ rootPath: root, path: onMain, deleteBranch: true, confirmUnmerged: true })).toEqual({ code: 'worktree.remove.defaultBranch', params: { branch: 'main' } })
    expect(existsSync(onMain)).toBe(true)
    expect(branches()).toContain('main')
  })

  test('S4 / HML 704-7: a branch checked out in another worktree is never deleted, even confirmed', async () => {
    const first = await add('shared')
    const second = join(sandbox, 'shared-again')
    git(root, 'worktree', 'add', '-q', '-f', second, 'shared')
    expect(await refusal({ rootPath: root, path: first, deleteBranch: true, confirmUnmerged: true })).toEqual({ code: 'worktree.remove.branchInUse', params: { branch: 'shared' } })
    expect(existsSync(first)).toBe(true)
    expect(branches()).toContain('shared')
  })

  test('S4: deleting a pushed branch removes only the local ref: the remote branch and its tracking ref stay', async () => {
    const bare = join(sandbox, 'remote.git')
    git(sandbox, 'init', '-q', '--bare', bare)
    git(root, 'remote', 'add', 'origin', bare)
    const tree = await add('pushed')
    git(tree, 'push', '-q', '-u', 'origin', 'pushed')
    providerMerged.set('pushed', 3)
    expect(await panel.remove({ rootPath: root, path: tree, deleteBranch: true })).toEqual({ ok: true, branchDeleted: true })
    expect(branches()).not.toContain('pushed')
    expect(git(root, 'ls-remote', '--heads', 'origin', 'pushed')).toContain('refs/heads/pushed')
    expect(git(root, 'branch', '-r')).toContain('origin/pushed')
    expect(spawned.some(call => call.args.includes('push') || (call.args.includes('branch') && call.args.includes('-r') && call.args.some(arg => /^-[dD]$/.test(arg))))).toBe(false)
  })

  test('S3: every git call is an argument array without a shell, and the branch delete puts -- before the name', async () => {
    const tree = await add('dashed')
    providerMerged.set('dashed', 8)
    spawned = []
    await panel.list({ rootPath: root })
    expect(await panel.remove({ rootPath: root, path: tree, deleteBranch: true })).toEqual({ ok: true, branchDeleted: true })
    expect(spawned.length).toBeGreaterThan(0)
    expect(spawned.filter(call => call.shell)).toEqual([])
    const deletes = spawned.filter(call => call.args.includes('branch') && call.args.some(arg => /^-[dD]$/.test(arg)))
    expect(deletes).toHaveLength(1)
    const args = deletes[0].args
    expect(args.indexOf('--')).toBeGreaterThan(-1)
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('dashed'))
  })

  test('S5: each Remove and branch delete writes one audit row, refusals included, with no file content', async () => {
    const tree = await add('audited')
    writeFileSync(join(tree, 'secret-notes.txt'), 'CONTENT-MARKER-S5')
    expect(await refusal({ rootPath: root, path: tree, deleteBranch: true })).toEqual({ code: 'worktree.remove.dirty', params: { count: 1 } })
    rmSync(join(tree, 'secret-notes.txt'))
    providerMerged.set('audited', 4)
    expect(await panel.remove({ rootPath: root, path: tree, deleteBranch: true })).toEqual({ ok: true, branchDeleted: true })
    const rows = audit()
    expect(rows.map(entry => [entry.action, entry.outcome, entry.code])).toEqual([
      ['worktree-remove', 'refused', 'worktree.remove.dirty'], ['worktree-remove', 'ok', null], ['branch-delete', 'ok', null]
    ])
    expect(rows.every(entry => entry.actor === 'person')).toBe(true)
    expect(same(rows[1].target, tree)).toBe(true)
    expect(rows[2].target).toBe('audited')
    expect(JSON.stringify(db.prepare('SELECT * FROM person_action_audit').all())).not.toContain('CONTENT-MARKER-S5')
  })
})
