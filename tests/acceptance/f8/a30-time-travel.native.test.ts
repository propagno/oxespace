// Frozen acceptance test for 1.5.0 A30 / T83 (OXE program, phase F8), light SECURITY: a conversation's history is its
// checkpoints with their files, plus what can't be undone (database writes, pushes, containers) from the audits and the
// conversation's own tool events. Branch creates a worktree from the checkpoint's commit with its pre-images, registers
// it as the new conversation's own worktree and workspace, and forks the provider session; an unsupported provider is
// refused with nothing created. The original conversation is never changed.
// Written by the planner; the executor must not edit it. A temp git repository, a fake adapter, an injected fork.
// CCR: docs/roadmap-1.5/ccr-f8-agora-history.md §A30; DESIGN 1.5.0-f8-design.md U8.2.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f8/a30-time-travel.native.test.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { ThreadHistory } from '../../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../../electron/main/services/conversation/thread-manager'
import { messageFromError } from '../../../shared/messages'
import type { AgentConversationAdapter, ThreadEvent } from '../../../shared/types/thread'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) { try { await step() } catch { /* temp */ } } })
const settle = (ms = 300) => new Promise(resolve => setTimeout(resolve, ms))
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

function fixture(provider: 'claude' | 'codex' = 'claude', { branching = true }: { branching?: boolean } = {}) {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f8-tt-')))
  cleanup.push(() => removeTempDir(parent))
  const root = join(parent, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', root])
  git(root, 'config', 'user.email', 'e@x'); git(root, 'config', 'user.name', 'E')
  writeFileSync(join(root, 'a.txt'), 'original\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'init')
  const db: AppDatabase = openInMemoryDatabase()
  cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'shop', ?, '1x1', 'builtin-claude')").run(root)
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const factory = vi.fn(async () => ({
    capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
    start: vi.fn(async (_context, emit) => { callbacks.push(emit); emit({ type: 'session', nativeSessionId: '11111111-1111-4111-8111-111111111111' }) }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}), respondRequest: vi.fn(async () => {})
  }) as AgentConversationAdapter)
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
  cleanup.push(() => manager.stop())
  const forks: unknown[] = []
  if (branching) manager.configureBranching({
    fork: async input => { forks.push(input); return input.provider === 'claude' ? { ok: true as const, sessionId: '22222222-2222-4222-8222-222222222222' } : { ok: false as const, code: 'thread.branch.unsupported' as const } }
  })
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: root, provider }).thread.id
  const read = (threadId = id) => new ThreadHistory(db).read(threadId)
  /** One turn that rewrites a.txt to `text` (uncommitted), reported as a tool write. */
  async function editTurn(text: string, prompt: string) {
    await manager.send(id, prompt)
    const end = Date.now() + 5000
    while (callbacks.length === 0 && Date.now() < end) await settle(50)
    await settle(200)
    writeFileSync(join(root, 'a.txt'), `${text}\n`)
    callbacks[0]({ type: 'tool', id: `t-${prompt}`, name: 'Write', state: 'completed', detail: 'a.txt', files: [{ path: join(root, 'a.txt'), kind: 'update', source: 'tool-input', state: 'completed' }] })
    callbacks[0]({ type: 'completed', status: 'completed' })
    await settle(600)
  }
  return { db, manager, id, root, parent, forks, read, editTurn, callbacks }
}

describe('A30 · the history', () => {
  test('A30: one checkpoint per turn, numbered, with its time, label and files, in the turn\'s checkout', async () => {
    const f = fixture('claude', { branching: false })
    await f.editTurn('v1', 'First change')
    await f.editTurn('v2', 'Second change')
    const history = await f.manager.timeline(f.id)
    expect(history.checkpoints.map(checkpoint => [checkpoint.n, checkpoint.files])).toEqual([[1, ['a.txt']], [2, ['a.txt']]])
    for (const checkpoint of history.checkpoints) {
      expect(typeof checkpoint.at).toBe('number')
      expect(checkpoint.checkout.replace(/\\/g, '/').toLowerCase()).toBe(f.root.replace(/\\/g, '/').toLowerCase())
      expect(checkpoint.failed).toBeFalsy()
    }
    expect(history.checkpoints[0].label).toContain('First change')
  })

  test('A30: a checkpoint whose files were not saved is marked failed (transcript only)', async () => {
    const f = fixture('claude', { branching: false })
    await f.editTurn('v1', 'First change')
    f.db.prepare("UPDATE conversation_checkpoints SET state = 'failed' WHERE thread_id = ?").run(f.id)
    expect((await f.manager.timeline(f.id)).checkpoints[0]).toMatchObject({ failed: true })
  })

  test('A30: "can\'t go back" counts database writes and container actions from the audits, and pushes from the conversation\'s own commands', async () => {
    const f = fixture('claude', { branching: false })
    await f.editTurn('v1', 'First change')
    const actor = `thread:${f.id}`
    f.db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (1, ?, 'c', 'shop', 'postgres', 'dev', 'oxespace_db_execute', 'UPDATE x', 'approved', 'ok')").run(actor)
    f.db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (2, ?, 'c', 'shop', 'postgres', 'dev', 'oxespace_db_query', 'SELECT 1', 'auto', 'ok')").run(actor)
    f.db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (3, ?, 'c', 'api', 'docker', 'dev', 'oxespace_container_action', 'restart api', 'approved', 'ok')").run(actor)
    f.db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (4, 'thread:someone-else', 'c', 'shop', 'postgres', 'dev', 'oxespace_db_execute', 'UPDATE y', 'approved', 'ok')").run()
    await f.manager.send(f.id, 'Push it')
    await settle(300)
    f.callbacks[0]({ type: 'tool', id: 'push-1', name: 'Bash', state: 'completed', detail: 'git push origin main', exitCode: 0 })
    f.callbacks[0]({ type: 'tool', id: 'push-2', name: 'Bash', state: 'failed', detail: 'git push origin main', exitCode: 1 })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await settle(600)
    expect((await f.manager.timeline(f.id)).cantGoBack).toEqual({ dbWrites: 1, pushes: 1, containers: 1 })
  })
})

describe('A30 · Branch into a new worktree', () => {
  test('A30: Branch from checkpoint 2 makes a worktree at the checkpoint\'s commit with the files as they were before that turn, a workspace and a forked conversation', async () => {
    const f = fixture()
    await f.editTurn('v1', 'First change')
    await f.editTurn('v2', 'Second change')
    const [, second] = (await f.manager.timeline(f.id)).checkpoints
    const result = await f.manager.branchFromCheckpoint(f.id, second.id, { branch: 'oxe/fix-from-1403' })
    expect(result).toMatchObject({ ok: true, threadId: expect.any(String), workspaceId: expect.any(String), worktreePath: expect.any(String) })
    if (!result.ok) return
    expect(readFileSync(join(result.worktreePath, 'a.txt'), 'utf8')).toBe('v1\n')
    expect(git(result.worktreePath, 'branch', '--show-current').trim()).toBe('oxe/fix-from-1403')
    const created = f.read(result.threadId).thread
    expect(created.ownedWorktree).toMatchObject({ path: result.worktreePath, branch: 'oxe/fix-from-1403' })
    expect(f.db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(result.workspaceId)).toEqual({ root_path: result.worktreePath })
    expect(f.forks).toEqual([expect.objectContaining({ provider: 'claude', sessionId: '11111111-1111-4111-8111-111111111111', checkpoint: 2 })])
    expect(created.nativeSessionId).toBe('22222222-2222-4222-8222-222222222222')
    // The original conversation and checkout are untouched.
    expect(readFileSync(join(f.root, 'a.txt'), 'utf8')).toBe('v2\n')
    expect(git(f.root, 'branch', '--show-current').trim()).toBe('main')
  })

  test('A30: Branch from checkpoint 1 starts from the original files', async () => {
    const f = fixture()
    await f.editTurn('v1', 'First change')
    const [first] = (await f.manager.timeline(f.id)).checkpoints
    const result = await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/from-start' })
    if (!result.ok) throw new Error(JSON.stringify(result))
    expect(readFileSync(join(result.worktreePath, 'a.txt'), 'utf8')).toBe('original\n')
  })

  test('A30: a provider without fork support is refused, and nothing is created: no worktree, no branch, no workspace', async () => {
    const f = fixture('codex')
    await f.editTurn('v1', 'First change')
    const [first] = (await f.manager.timeline(f.id)).checkpoints
    const workspaces = (f.db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n
    const result = await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/codex-try' })
    expect(result).toEqual({ ok: false, refusal: { code: 'thread.branch.unsupported', params: {} } })
    expect(git(f.root, 'branch', '--list', 'oxe/codex-try').trim()).toBe('')
    expect((f.db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n).toBe(workspaces)
    expect(existsSync(join(f.parent, 'repo-oxe-codex-try'))).toBe(false)
  })

  test('A30 (SECURITY): an unsafe or existing branch name, a failed checkpoint and an unknown checkpoint are refused without creating anything', async () => {
    const f = fixture()
    await f.editTurn('v1', 'First change')
    const [first] = (await f.manager.timeline(f.id)).checkpoints
    for (const branch of ['--force', 'a..b', 'x y', 'main']) {
      const result = await f.manager.branchFromCheckpoint(f.id, first.id, { branch }).catch((cause: unknown) => ({ ok: false as const, refusal: messageFromError(cause) }))
      expect(result.ok, branch).toBe(false)
    }
    expect(await f.manager.branchFromCheckpoint(f.id, 'no-such', { branch: 'oxe/x' })).toEqual({ ok: false, refusal: { code: 'thread.branch.checkpointGone', params: {} } })
    f.db.prepare("UPDATE conversation_checkpoints SET state = 'failed' WHERE thread_id = ?").run(f.id)
    expect(await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/y' })).toEqual({ ok: false, refusal: { code: 'thread.branch.checkpointFailed', params: {} } })
    expect(f.forks).toEqual([])
    expect(git(f.root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
  })
})
