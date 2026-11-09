// Frozen acceptance test for 1.5.0 A30 / T83 (OXE program, phase F8), light SECURITY: a conversation's history is its
// checkpoints with their files, plus what can't be undone (database writes, pushes, irreversible containers and
// commands, external writes) from the audits and the conversation's own tool events, once each. Restore (today's
// rewind) takes a safety checkpoint, changes only the conversation's files and refuses the person's own edits unless
// confirmed (TECH LEAD S1). Branch is checked before any git write, creates a worktree from the checkpoint's commit
// with its pre-images, registers it as the new conversation's own worktree and workspace with no grants, forks the
// provider session last, and rolls back every step on a failure (TECH LEAD S2, HML 717-5/6). The original conversation
// is never changed.
// Written by the planner; the executor must not edit it. A temp git repository, a fake adapter, an injected fork.
// CCR: docs/roadmap-1.5/ccr-f8-agora-history.md §A30; DESIGN 1.5.0-f8-design.md U8.2.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f8/a30-time-travel.native.test.ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
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
  /** Switches for the injected provider side: a fork that crashes, a Claude session file that is gone. */
  const controls = { forkFails: false, sessionAvailable: true }
  if (branching) manager.configureBranching({
    fork: async input => {
      forks.push(input)
      if (controls.forkFails) throw new Error('fork crashed')
      return input.provider === 'claude' ? { ok: true as const, sessionId: '22222222-2222-4222-8222-222222222222' } : { ok: false as const, code: 'thread.branch.unsupported' as const }
    },
    sessionAvailable: async () => controls.sessionAvailable
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
  /** A finished turn that ran one tool call: a Bash command (`command`) or another tool with its JSON input. */
  async function toolTurn(prompt: string, calls: Array<{ name?: string; input: Record<string, unknown>; state?: 'completed' | 'failed'; exitCode?: number }>) {
    await manager.send(id, prompt)
    const end = Date.now() + 5000
    while (callbacks.length === 0 && Date.now() < end) await settle(50)
    await settle(200)
    calls.forEach((call, index) => callbacks[0]({ type: 'tool', id: `${prompt}-${index}`, name: call.name ?? 'Bash', state: call.state ?? 'completed', detail: JSON.stringify(call.input, null, 2), ...(call.exitCode === undefined ? {} : { exitCode: call.exitCode }) }))
    callbacks[0]({ type: 'completed', status: 'completed' })
    await settle(600)
  }
  const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n
  /** Nothing of a branch exists: no git branch, no sibling folder, no extra worktree or workspace. */
  function nothingCreated(branch: string, workspaces: number) {
    expect(git(root, 'branch', '--list', branch).trim(), branch).toBe('')
    expect(existsSync(join(parent, `repo-${branch.replace(/\//g, '-')}`)), branch).toBe(false)
    expect(git(root, 'worktree', 'list').trim().split('\n'), branch).toHaveLength(1)
    expect(count('SELECT COUNT(*) AS n FROM workspaces'), branch).toBe(workspaces)
  }
  return { db, manager, id, root, parent, forks, controls, read, editTurn, toolTurn, callbacks, count, nothingCreated }
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
    // Restore at a tick calls rewind with the turn the checkpoint opened.
    expect(history.checkpoints.map(checkpoint => checkpoint.turnId)).toEqual(f.read().turns!.map(turn => turn.id))
  })

  test('A30: a checkpoint whose files were not saved is marked failed (transcript only)', async () => {
    const f = fixture('claude', { branching: false })
    await f.editTurn('v1', 'First change')
    f.db.prepare("UPDATE conversation_checkpoints SET state = 'failed' WHERE thread_id = ?").run(f.id)
    expect((await f.manager.timeline(f.id)).checkpoints[0]).toMatchObject({ failed: true })
  })

  test('A30: "can\'t go back" counts, once each, the database writes from the audits, pushes, irreversible container and shell commands from F7\'s classifier, and external writes from the HTTP audit', async () => {
    const f = fixture('claude', { branching: false })
    await f.editTurn('v1', 'First change')
    const actor = `thread:${f.id}`
    const audit = f.db.prepare('INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (?, ?, \'c\', \'shop\', \'postgres\', \'dev\', ?, ?, \'approved\', \'ok\')')
    audit.run(1, actor, 'oxespace_db_execute', 'UPDATE x SET y = 1')
    audit.run(2, actor, 'oxespace_db_query', 'SELECT 1')
    audit.run(3, actor, 'oxespace_container_action', 'restart container api')
    audit.run(4, 'thread:someone-else', 'oxespace_db_execute', 'UPDATE y SET z = 1')
    const http = f.db.prepare("INSERT INTO agent_http_audit (ts, actor, workspace_id, agent, source, tool_use_id, call_index, tool, method, scheme, host, port, path_template, query_keys_json, header_names_json, has_body, insecure, plain_http_external, status, command_redacted, output_truncated) VALUES (?, ?, 'A', 'claude-code', 'hook', ?, 0, 'curl', ?, 'https', ?, 443, '/v1', '[]', '[]', 1, 0, 0, 200, 'curl', 0)")
    http.run(5, actor, 'h1', 'POST', 'api.stripe.com')
    http.run(6, actor, 'h2', 'GET', 'api.stripe.com')
    http.run(7, actor, 'h3', 'POST', '127.0.0.1')
    http.run(8, 'thread:someone-else', 'h4', 'DELETE', 'api.stripe.com')
    await f.toolTurn('Ship it', [
      { input: { command: 'git push origin main' }, exitCode: 0 },
      // A rejected multi-ref push may still have pushed some refs.
      { input: { command: 'git push --tags origin' }, state: 'failed', exitCode: 1 },
      { input: { command: 'gh pr create --fill' }, exitCode: 0 },
      { name: 'mcp__oxespace__oxespace_git_change', input: { action: 'push' } },
      { name: 'mcp__oxespace__oxespace_github_change', input: { action: 'create_pull_request', title: 'Fix' } },
      { name: 'mcp__oxespace__oxespace_git_change', input: { action: 'commit', message: 'local only' } },
      { input: { command: 'psql -c "UPDATE orders SET paid = true"' }, exitCode: 0 },
      { input: { command: 'psql -c "SELECT 1"' }, exitCode: 0 },
      { input: { command: 'docker compose down -v' }, exitCode: 0 },
      { input: { command: 'docker restart api' }, exitCode: 0 },
      { input: { command: 'echo x > ~/.bashrc' }, exitCode: 0 },
      { input: { command: 'ls -la' }, exitCode: 0 },
      { input: { command: 'git status' }, exitCode: 0 }
    ])
    expect((await f.manager.timeline(f.id)).cantGoBack).toEqual({ dbWrites: 1, pushes: 5, containers: 1, commands: 2, httpWrites: 1, scope: 'conversation' })
  })
})

describe('A30 · Restore (SECURITY)', () => {
  test('A30 Restore (SECURITY): it takes a safety checkpoint first, changes only the conversation\'s files, never git\'s state or the person\'s other files, and Redo brings the files back', async () => {
    const f = fixture('claude', { branching: false })
    writeFileSync(join(f.root, 'b.txt'), 'base\n'); git(f.root, 'add', 'b.txt'); git(f.root, 'commit', '-qm', 'b')
    await f.editTurn('v1', 'First change')
    await f.editTurn('v2', 'Second change')
    // The person's own work, which the conversation never touched: an edit to a tracked file and a new untracked file.
    writeFileSync(join(f.root, 'b.txt'), 'mine\n')
    writeFileSync(join(f.root, 'notes.txt'), 'todo\n')
    const head = git(f.root, 'rev-parse', 'HEAD').trim()
    const refs = git(f.root, 'for-each-ref')
    const second = (await f.manager.timeline(f.id)).checkpoints[1].turnId
    await f.manager.rewind(f.id, second, { restoreFiles: true })
    expect(readFileSync(join(f.root, 'a.txt'), 'utf8')).toBe('v1\n')
    expect(readFileSync(join(f.root, 'b.txt'), 'utf8')).toBe('mine\n')
    expect(readFileSync(join(f.root, 'notes.txt'), 'utf8')).toBe('todo\n')
    expect(git(f.root, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(git(f.root, 'for-each-ref')).toBe(refs)
    expect(git(f.root, 'status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual([' M a.txt', ' M b.txt', '?? notes.txt'])
    // The restore itself can be undone: Redo puts back the files the safety checkpoint saved.
    await f.manager.redoRewind(f.id)
    expect(readFileSync(join(f.root, 'a.txt'), 'utf8')).toBe('v2\n')
  })

  test('A30 Restore (SECURITY): a file the person changed after the conversation is refused with a code, and restored only when confirmed', async () => {
    const f = fixture('claude', { branching: false })
    await f.editTurn('v1', 'First change')
    await f.editTurn('v2', 'Second change')
    writeFileSync(join(f.root, 'a.txt'), 'mine\n')
    const second = (await f.manager.timeline(f.id)).checkpoints[1].turnId
    // The success path on this fixture is proved below with confirmed; first, the refusal changes nothing.
    const refused = await f.manager.rewind(f.id, second, { restoreFiles: true }).then(() => undefined, (cause: unknown) => cause)
    expect(refused).toMatchObject({ code: 'foreign-changes' })
    expect(messageFromError(refused)).toMatchObject({ code: 'thread.restore.foreignChanges' })
    expect(readFileSync(join(f.root, 'a.txt'), 'utf8')).toBe('mine\n')
    expect(f.read().thread.rewind).toBeUndefined()
    await f.manager.rewind(f.id, second, { restoreFiles: true, confirmed: true })
    expect(readFileSync(join(f.root, 'a.txt'), 'utf8')).toBe('v1\n')
    // The person's edit was in the safety checkpoint, so Redo gives it back.
    await f.manager.redoRewind(f.id)
    expect(readFileSync(join(f.root, 'a.txt'), 'utf8')).toBe('mine\n')
  })
})

describe('A30 · Branch into a new worktree', () => {
  test('A30: Branch from checkpoint 2 makes a worktree at the checkpoint\'s commit with the files as they were before that turn, a workspace and a forked conversation', async () => {
    const f = fixture()
    await f.editTurn('v1', 'First change')
    await f.editTurn('v2', 'Second change')
    const timeline = await f.manager.timeline(f.id)
    expect(timeline.canBranch).toBe(true)
    expect(timeline.branchRefusal).toBeUndefined()
    const [, second] = timeline.checkpoints
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
    const timeline = await f.manager.timeline(f.id)
    // The window shows "Not available in Codex" before any click, from main's answer, never from the provider name.
    expect(timeline).toMatchObject({ canBranch: false, branchRefusal: { code: 'thread.branch.unsupported', params: {} } })
    const [first] = timeline.checkpoints
    const workspaces = (f.db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n
    const result = await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/codex-try' })
    expect(result).toEqual({ ok: false, refusal: { code: 'thread.branch.unsupported', params: {} } })
    expect(git(f.root, 'branch', '--list', 'oxe/codex-try').trim()).toBe('')
    expect((f.db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n).toBe(workspaces)
    expect(existsSync(join(f.parent, 'repo-oxe-codex-try'))).toBe(false)
    expect(f.forks).toEqual([])
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

  test('A30 Branch (SECURITY): a sibling folder already there, a name taken in another case, a missing session, a base commit that is gone and a folder that is no longer git are refused before any git write', async () => {
    const f = fixture()
    await f.editTurn('v1', 'First change')
    const [first] = (await f.manager.timeline(f.id)).checkpoints
    const workspaces = f.count('SELECT COUNT(*) AS n FROM workspaces')
    const refusal = async (branch: string) => {
      const result = await f.manager.branchFromCheckpoint(f.id, first.id, { branch })
      return result.ok ? 'created' : result.refusal.code
    }
    // The folder Branch would use is never overwritten.
    mkdirSync(join(f.parent, 'repo-oxe-taken'))
    writeFileSync(join(f.parent, 'repo-oxe-taken', 'keep.txt'), 'keep\n')
    expect(await refusal('oxe/taken')).toBe('thread.branch.pathExists')
    expect(readFileSync(join(f.parent, 'repo-oxe-taken', 'keep.txt'), 'utf8')).toBe('keep\n')
    expect(git(f.root, 'branch', '--list', 'oxe/taken').trim()).toBe('')
    // Case-insensitive file systems would make these one ref.
    git(f.root, 'branch', 'oxe/Upper')
    expect(await refusal('oxe/upper')).toBe('thread.branch.exists')
    git(f.root, 'branch', '-D', 'oxe/Upper')
    f.controls.sessionAvailable = false
    expect(await refusal('oxe/no-session')).toBe('thread.branch.sessionGone')
    f.nothingCreated('oxe/no-session', workspaces)
    f.controls.sessionAvailable = true
    // The checkpoint's base commit is rewritten away and collected.
    git(f.root, 'commit', '--amend', '-qm', 'rewritten', '--allow-empty')
    git(f.root, 'reflog', 'expire', '--expire=now', '--all')
    git(f.root, 'gc', '-q', '--prune=now')
    expect(await refusal('oxe/base-gone')).toBe('thread.branch.baseGone')
    f.nothingCreated('oxe/base-gone', workspaces)
    renameSync(join(f.root, '.git'), join(f.root, '.git-away'))
    cleanup.push(() => renameSync(join(f.root, '.git-away'), join(f.root, '.git')))
    expect(await refusal('oxe/not-git')).toBe('thread.branch.notGit')
    expect(existsSync(join(f.parent, 'repo-oxe-not-git'))).toBe(false)
    expect(f.forks).toEqual([])
  })

  test('A30 Branch: a failure after the worktree is made (restoring the pre-images, the fork) removes the worktree, the branch and the workspace, and refuses with the step', async () => {
    const f = fixture()
    await f.editTurn('v1', 'First change')
    const [first] = (await f.manager.timeline(f.id)).checkpoints
    const workspaces = f.count('SELECT COUNT(*) AS n FROM workspaces')
    // The path is live: the same checkpoint branches when nothing fails.
    const ok = await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/works' })
    expect(ok.ok).toBe(true)
    const after = f.count('SELECT COUNT(*) AS n FROM workspaces')
    expect(after).toBe(workspaces + 1)
    f.controls.forkFails = true
    expect(await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/fork-fails' })).toEqual({ ok: false, refusal: { code: 'thread.branch.failed', params: { step: 'fork' } } })
    expect(git(f.root, 'branch', '--list', 'oxe/fork-fails').trim()).toBe('')
    expect(existsSync(join(f.parent, 'repo-oxe-fork-fails'))).toBe(false)
    expect(f.count('SELECT COUNT(*) AS n FROM workspaces')).toBe(after)
    f.controls.forkFails = false
    // A pre-image that no longer matches its hash fails the restore step (as a locked file on Windows would).
    f.db.prepare('UPDATE conversation_checkpoint_files SET pre_content = ? WHERE checkpoint_id = ?').run(Buffer.from('tampered\n'), first.id)
    expect(await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/restore-fails' })).toEqual({ ok: false, refusal: { code: 'thread.branch.failed', params: { step: 'restore' } } })
    expect(git(f.root, 'branch', '--list', 'oxe/restore-fails').trim()).toBe('')
    expect(existsSync(join(f.parent, 'repo-oxe-restore-fails'))).toBe(false)
    expect(f.count('SELECT COUNT(*) AS n FROM workspaces')).toBe(after)
    expect(git(f.root, 'worktree', 'list').trim().split('\n')).toHaveLength(2)
  })

  test('A30 Branch (SECURITY): the new conversation inherits no grants, and one person action row without content is written', async () => {
    const f = fixture()
    // The original's grants: an untracked Always-allow file and a project permission rule.
    mkdirSync(join(f.root, '.claude'))
    writeFileSync(join(f.root, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] } }))
    f.manager.addPermissionRule(f.id, { kind: 'command', pattern: 'npm test', decision: 'allow', scope: 'project' })
    expect(f.manager.permissionRules(f.id).filter(rule => rule.projectRoot !== null)).toHaveLength(1)
    await f.editTurn('v1', 'First change')
    const [first] = (await f.manager.timeline(f.id)).checkpoints
    const result = await f.manager.branchFromCheckpoint(f.id, first.id, { branch: 'oxe/clean' })
    if (!result.ok) throw new Error(JSON.stringify(result))
    expect(existsSync(join(result.worktreePath, '.claude', 'settings.local.json'))).toBe(false)
    expect(f.manager.permissionRules(result.threadId).filter(rule => rule.projectRoot !== null)).toEqual([])
    const rows = f.db.prepare("SELECT actor, action, target, outcome FROM person_action_audit WHERE action = 'thread-branch'").all()
    expect(rows).toEqual([{ actor: 'person', action: 'thread-branch', target: result.threadId, outcome: 'ok' }])
    const all = JSON.stringify(f.db.prepare('SELECT * FROM person_action_audit').all())
    for (const content of ['First change', 'v1', 'original']) expect(all, content).not.toContain(content)
  })
})
