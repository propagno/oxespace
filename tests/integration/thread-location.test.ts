/**
 * A conversation follows the checkout its provider reports working in: a worktree of the same repository
 * becomes the thread's observed location (and a project context the panels may read), the thread's own
 * root clears it, and an unrelated directory is recorded as outside the repository.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function fixture(root: string) {
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
  vi.spyOn(manager as unknown as { workingState: () => Promise<undefined> }, 'workingState').mockResolvedValue(undefined)
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: root, provider: 'claude' }).thread.id
  cleanup.push(() => manager.stop())
  return { db, manager, callbacks, id, read: () => new ThreadHistory(db).read(id) }
}

describe('Thread working location', () => {
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
