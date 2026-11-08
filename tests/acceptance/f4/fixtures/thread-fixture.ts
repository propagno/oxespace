// Shared fixture for the F4 frozen acceptance tests: a ThreadManager over an in-memory database and a fake
// provider adapter, plus temp git repositories. No live provider, no user home, no user data: every path is a temp dir.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../../electron/main/db'
import { ThreadHistory } from '../../../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent, ThreadFileChange } from '../../../../shared/types/thread'
import { removeTempDir } from '../../../helpers/removeTempDir'

export const cleanup: (() => void | Promise<void>)[] = []
export async function runCleanup(): Promise<void> { for (const step of cleanup.splice(0).reverse()) { try { await step() } catch { /* temp */ } } }

export const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

/** A fresh temp folder (real path, so Windows short names never differ from what main reports). */
export function sandbox(prefix = 'oxe-f4-'): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  cleanup.push(() => removeTempDir(dir))
  return dir
}

/** A repository with one commit of a.txt (and b.txt) on main. */
export function repository(parent: string, name = 'repo', options: { unborn?: boolean } = {}): string {
  const repo = join(parent, name)
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'e@x'); git(repo, 'config', 'user.name', 'E'); git(repo, 'config', 'commit.gpgsign', 'false')
  if (!options.unborn) {
    writeFileSync(join(repo, 'a.txt'), 'a\n'); writeFileSync(join(repo, 'b.txt'), 'b\n')
    git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init')
  }
  return repo
}

export function write(path: string, text: string): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }

export interface PaneSource { paneId: string; title: string; workspaceId: string; launchDir: string; agentCwd?: string | null; shellCwd?: string | null; agent?: boolean }

export function threadFixture(root: string) {
  const db: AppDatabase = openInMemoryDatabase()
  cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const factory = vi.fn(async () => ({
    capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
    start: vi.fn(async (_context, emit) => { callbacks.push(emit); emit({ type: 'session', nativeSessionId: `native-${callbacks.length}` }) }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
    respondRequest: vi.fn(async () => {})
  }) as AgentConversationAdapter)
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
  cleanup.push(() => manager.stop())
  const panes: PaneSource[] = []
  manager.configurePanes(() => panes)
  // A conversation's title comes from its first message (thread-title.ts), so tests name them by what they send.
  const create = (rootPath = root): string => manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath, provider: 'claude' }).thread.id
  const id = create()
  let tool = 0
  /** The provider emits for the n-th started adapter (0 = the first conversation). */
  const emit = (event: ThreadEvent, adapter = 0): void => callbacks[adapter](event)
  /** A completed tool event that wrote these absolute paths (tool evidence, §2.2 point 3). */
  const wrote = (paths: string[], options: { adapter?: number; kind?: ThreadFileChange['kind']; name?: string } = {}): void => emit({
    type: 'tool', id: `tool-${++tool}`, name: options.name ?? 'Write', state: 'completed', detail: paths.join(' '),
    files: paths.map(path => ({ path, kind: options.kind ?? 'add', source: 'tool-input', state: 'completed' }))
  }, options.adapter)
  /** Text only: a path named in the agent's message, which is never evidence of a write. */
  const said = (text: string, adapter = 0): void => emit({ type: 'message', id: `m-${++tool}`, role: 'assistant', text }, adapter)
  const read = (threadId = id) => new ThreadHistory(db).read(threadId)
  return { db, manager, id, create, emit, wrote, said, read, panes, callbacks }
}

/** Settles the asynchronous turn bookkeeping (checkpoint, base, finalization) between steps. */
export const settle = (ms = 400): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Polls until the condition holds, failing loudly after 10 s instead of carrying on in the wrong state. */
export async function until(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const end = Date.now() + 10_000
  while (!(await condition())) {
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

/** Starts a turn on the conversation and waits for its adapter, so evidence lands inside a running turn. */
export async function turn(f: ReturnType<typeof threadFixture>, text = 'Work', threadId = f.id, adapter = 0): Promise<void> {
  await f.manager.send(threadId, text)
  await until(() => f.callbacks.length > adapter, 'the adapter to start')
  await settle(150)
}
export async function complete(f: ReturnType<typeof threadFixture>, adapter = 0): Promise<void> {
  f.emit({ type: 'completed', status: 'completed' }, adapter)
  await settle()
}

export const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
