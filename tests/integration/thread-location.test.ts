/**
 * A conversation follows the checkout its provider reports working in: a worktree of the same repository
 * becomes the thread's observed location (and a project context the panels may read), the thread's own
 * root clears it, and an unrelated directory is recorded as outside the repository.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent } from '../../shared/types/thread'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step() })

function repository(): { repo: string; tree: string } {
  const repo = mkdtempSync(join(tmpdir(), 'oxe-thread-loc-'))
  const tree = `${repo}-tree`
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'e@x'); git('config', 'user.name', 'E')
  writeFileSync(join(repo, 'a.txt'), 'a\n'); git('add', '.'); git('commit', '-qm', 'a')
  git('worktree', 'add', '-q', '-b', 'agent-fix', tree)
  cleanup.push(() => { rmSync(tree, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }) })
  return { repo, tree }
}

function fixture(root: string, options: { realWorkingState?: boolean } = {}) {
  const db: AppDatabase = openInMemoryDatabase()
  cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const factory = vi.fn(async () => ({
    capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
    start: vi.fn(async (_context, emit) => { callbacks.push(emit); emit({ type: 'session', nativeSessionId: 'native-1' }) }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
    respondRequest: vi.fn(async () => {})
  }) as AgentConversationAdapter)
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
  if (!options.realWorkingState) vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: root, provider: 'claude' }).thread.id
  cleanup.push(() => manager.stop())
  return { db, manager, callbacks, id, read: () => new ThreadHistory(db).read(id) }
}

// Real git runs several times per case; on a loaded Windows runner that exceeds the 5 s default.
describe('Thread working location', { timeout: 30_000 }, () => {
  // Settles the asynchronous turn bookkeeping (checkpoint, baseline, finalization) between steps.
  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 400))
  const verifiedPaths = (f: ReturnType<typeof fixture>): string[] => f.read().events.flatMap(event => event.type === 'turn-diff' && event.id.startsWith('verified-diff:') ? event.files.map(file => file.path) : [])
  // Finalizing reads git in every checkout the turn used, which takes a moment on Windows.
  // Finalizing reads git in every checkout the turn used, which takes a moment on Windows: wait for the
  // verified diff and for every checkpoint of the turn to be finalized.
  const finalized = async (f: ReturnType<typeof fixture>): Promise<void> => {
    const checkpoints = (f.manager as unknown as { checkpoints: { list(id: string): Array<{ turnId?: string; state: string }> } }).checkpoints
    const end = Date.now() + 8_000
    const done = (): boolean => {
      const turnId = f.read().turns?.at(-1)?.id
      return verifiedPaths(f).length > 0 && checkpoints.list(f.id).filter(checkpoint => checkpoint.turnId === turnId).every(checkpoint => checkpoint.state !== 'open')
    }
    while (Date.now() < end && !done()) await new Promise(resolve => setTimeout(resolve, 100))
  }


  it('a turn after a move into a worktree is checkpointed and diffed there, and can be undone there', async () => {
    const { repo, tree } = repository()
    const f = fixture(repo, { realWorkingState: true })
    await f.manager.send(f.id, 'Move')
    f.callbacks[0]({ type: 'location', cwd: tree })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await settle()

    await f.manager.send(f.id, 'Edit in the worktree')
    await settle()
    writeFileSync(join(tree, 'a.txt'), 'changed in the worktree\n')
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await finalized(f)

    expect(verifiedPaths(f)).toContain('a.txt')
    const turnId = f.read().turns!.at(-1)!.id
    expect((await f.manager.turnFiles(f.id, turnId)).map(file => file.path)).toContain('a.txt')
    await f.manager.undoTurnFile(f.id, turnId, 'a.txt')
    expect(readFileSync(join(tree, 'a.txt'), 'utf8')).toBe('a\n')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a\n')
  })

  it('retrying a failed turn can undo its file changes first, and refuses the undo without a checkpoint', async () => {
    const { repo } = repository()
    const f = fixture(repo, { realWorkingState: true })
    const sends = (f.manager as unknown as { adapters: Map<string, AgentConversationAdapter> })
    await f.manager.send(f.id, 'Change a.txt')
    await settle()
    writeFileSync(join(repo, 'a.txt'), 'half-done edit\n')
    f.callbacks[0]({ type: 'completed', status: 'failed', error: 'connection dropped' })
    await finalized(f).catch(() => undefined)
    await settle()
    const turnId = f.read().turns!.at(-1)!.id
    const adapter = sends.adapters.get(f.id)!
    const before = (adapter.send as ReturnType<typeof vi.fn>).mock.calls.length

    const result = await f.manager.retryTurn(f.id, turnId, { restoreFiles: true })
    expect(result.restoredFiles).toBe(1)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a\n')
    const live = sends.adapters.get(f.id)!
    expect((live.send as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(live === adapter ? before : 0)
    expect((live.send as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBe('Change a.txt')
    f.callbacks.at(-1)!({ type: 'completed', status: 'completed' })
    await settle()

    // A turn whose checkpoint is gone is not retried onto files nobody can restore.
    f.db.prepare('DELETE FROM conversation_checkpoints WHERE thread_id = ?').run(f.id)
    const lastTurn = f.read().turns!.at(-1)!.id
    await expect(f.manager.retryTurn(f.id, lastTurn, { restoreFiles: true })).rejects.toThrow(/no checkpoint/)
  })

  it('a rewind that restored files gives them back on Redo', async () => {
    const { repo } = repository()
    const f = fixture(repo, { realWorkingState: true })
    await f.manager.send(f.id, 'First')
    f.callbacks[0]({ type: 'session', nativeSessionId: 'native-1' })
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await settle()
    await f.manager.send(f.id, 'Edit a.txt')
    await settle()
    writeFileSync(join(repo, 'a.txt'), 'edited by the turn\n')
    f.callbacks.at(-1)!({ type: 'completed', status: 'completed' })
    await finalized(f)
    const editTurn = f.read().turns!.at(-1)!.id

    const result = await f.manager.rewind(f.id, editTurn, { restoreFiles: true })
    expect(result.restoredFiles).toBe(1)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a\n')
    await f.manager.redoRewind(f.id)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('edited by the turn\n')
    expect(f.read().thread.rewind).toBeUndefined()
  })

  it('a move into a worktree during a turn adds a checkpoint and baseline there', async () => {
    const { repo, tree } = repository()
    const f = fixture(repo, { realWorkingState: true })
    await f.manager.send(f.id, 'Work in a worktree')
    await settle()
    f.callbacks[0]({ type: 'location', cwd: tree })
    await settle()
    writeFileSync(join(tree, 'new-in-tree.txt'), 'created after the move\n')
    f.callbacks[0]({ type: 'completed', status: 'completed' })
    await finalized(f)

    expect(verifiedPaths(f)).toContain('new-in-tree.txt')
    const turnId = f.read().turns!.at(-1)!.id
    expect((await f.manager.turnFiles(f.id, turnId)).map(file => file.path)).toContain('new-in-tree.txt')
    await f.manager.undoTurnFile(f.id, turnId, 'new-in-tree.txt')
    expect(existsSync(join(tree, 'new-in-tree.txt'))).toBe(false)
  })

  it('follows a worktree of the same repository, registers it for the panels, and clears at the root', async () => {
    const { repo, tree } = repository()
    const f = fixture(repo)
    await f.manager.send(f.id, 'Fix it in a worktree')
    const emit = f.callbacks[0]

    emit({ type: 'location', cwd: repo })
    expect(f.read().thread.observedLocation).toBeUndefined()

    emit({ type: 'location', cwd: tree })
    expect(f.read().thread.observedLocation).toMatchObject({ checkoutRoot: tree, sameRepository: true })
    expect(f.read().thread.rootPath).toBe(repo)
    const contexts = f.db.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ?').all('project-A') as { root_path: string }[]
    expect(contexts.map(row => row.root_path)).toContain(tree)
    // Location is metadata: nothing is added to the conversation's timeline.
    expect(f.read().events.some(event => (event as { type: string }).type === 'location')).toBe(false)

    emit({ type: 'location', cwd: repo })
    expect(f.read().thread.observedLocation).toBeUndefined()
  })

  it('says the folder is gone when the provider cannot start because its worktree was removed', async () => {
    const gone = join(tmpdir(), `oxe-removed-${Date.now()}`)
    const db: AppDatabase = openInMemoryDatabase()
    cleanup.push(() => db.close())
    const factory = vi.fn(async () => ({
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async () => { throw Object.assign(new Error(`spawn claude ENOENT`), { code: 'ENOENT' }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {})
    }) as AgentConversationAdapter)
    const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
    const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
    cleanup.push(() => manager.stop())
    const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: gone, provider: 'claude' }).thread.id
    await expect(manager.send(id, 'Continue')).rejects.toThrow(/folder no longer exists/)
  })

  it('records a directory outside the repository without treating it as the project, and ignores bad reports', async () => {
    const { repo } = repository()
    const f = fixture(repo)
    await f.manager.send(f.id, 'Look elsewhere')
    const emit = f.callbacks[0]
    emit({ type: 'location', cwd: 'relative/dir' })
    emit({ type: 'location', cwd: join(repo, 'does-not-exist') })
    expect(f.read().thread.observedLocation).toBeUndefined()
    emit({ type: 'location', cwd: tmpdir() })
    expect(f.read().thread.observedLocation).toMatchObject({ cwd: tmpdir(), sameRepository: false })
    const contexts = f.db.prepare('SELECT root_path FROM thread_project_contexts WHERE project_id = ?').all('project-A') as { root_path: string }[]
    expect(contexts.map(row => row.root_path)).not.toContain(tmpdir())
  })
})
