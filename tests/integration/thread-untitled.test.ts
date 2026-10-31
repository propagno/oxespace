import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { threadsInWorktree } from '../../electron/main/services/conversation/thread-worktree'
import type { AgentConversationAdapter } from '../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
  const factory = vi.fn(async () => ({ capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
    start: vi.fn(async () => {}), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }) as AgentConversationAdapter)
  const manager = new ThreadManager(db, factory, vi.fn())
  vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
  const create = () => manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'claude' }).thread.id
  /** Writes a title straight into the row, the way a conversation saved before 1.4 holds it. */
  const storeTitle = (id: string, title: string) => db.prepare("UPDATE conversation_threads SET data_json = json_set(data_json, '$.title', ?) WHERE id = ?").run(title, id)
  const storedTitle = (id: string) => (db.prepare("SELECT json_extract(data_json, '$.title') AS title FROM conversation_threads WHERE id = ?").get(id) as { title: string }).title
  return { db, manager, create, storeTitle, storedTitle }
}

describe('unnamed conversations', () => {
  it('stores an empty title for a new conversation, never an English placeholder', async () => {
    const f = fixture(), id = f.create()
    expect(f.storedTitle(id)).toBe('')
    expect(f.manager.read(id).thread.title).toBe('')
    await f.manager.stop()
  })

  it('reads a legacy "New thread" row as empty, everywhere a title leaves the service', async () => {
    const f = fixture(), id = f.create()
    f.storeTitle(id, 'New thread')
    expect(f.manager.read(id).thread.title).toBe('')
    expect(f.manager.list().find(thread => thread.id === id)?.title).toBe('')
    expect(threadsInWorktree(f.db, '/project-A')).toEqual([{ id, title: '' }])
    await f.manager.stop()
  })

  it('keeps a real title that merely contains the old placeholder', async () => {
    const f = fixture(), id = f.create()
    f.storeTitle(id, 'New thread pool')
    expect(f.manager.read(id).thread.title).toBe('New thread pool')
    expect(f.manager.list().find(thread => thread.id === id)?.title).toBe('New thread pool')
    await f.manager.send(id, 'Size the pool for eight workers')
    expect(f.manager.read(id).thread.title).toBe('New thread pool')
    await f.manager.stop()
  })

  it('names both a new and a legacy unnamed conversation from their first message', async () => {
    const f = fixture(), fresh = f.create(), legacy = f.create()
    f.storeTitle(legacy, 'New thread')
    await f.manager.send(fresh, 'Fix the login redirect. Then add a test.')
    await f.manager.send(legacy, 'Rename the build job')
    expect(f.manager.read(fresh).thread.title).toBe('Fix the login redirect.')
    expect(f.manager.read(legacy).thread.title).toBe('Rename the build job')
    expect(f.storedTitle(legacy)).toBe('Rename the build job')
    await f.manager.stop()
  })
})
