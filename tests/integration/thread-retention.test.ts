import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { CHECKPOINTS_KEPT_PER_THREAD, pruneThreadData } from '../../electron/main/services/conversation/thread-retention'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })
const DAY = 24 * 60 * 60 * 1000

function setup() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
  const manager = new ThreadManager(db, vi.fn(), vi.fn())
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'claude' }).thread.id
  return { db, manager, id }
}

function checkpoint(db: AppDatabase, threadId: string, id: string, createdAt: number, state = 'ready'): void {
  db.prepare('INSERT INTO conversation_checkpoints (id, thread_id, root_path, state, created_at) VALUES (?, ?, ?, ?, ?)').run(id, threadId, '/project-A', state, createdAt)
  db.prepare('INSERT INTO conversation_checkpoint_files (checkpoint_id, path, pre_exists, pre_content, post_exists, bytes) VALUES (?, ?, 1, ?, 1, 4)').run(id, 'a.txt', Buffer.from('data'))
}

describe('Thread retention', () => {
  it('drops old file checkpoints beyond the newest of each conversation, never open ones or the conversation', async () => {
    const { db, manager, id } = setup()
    const now = Date.now()
    for (let i = 0; i < CHECKPOINTS_KEPT_PER_THREAD + 5; i++) checkpoint(db, id, `old-${i}`, now - 60 * DAY + i)
    checkpoint(db, id, 'open-old', now - 90 * DAY, 'open')
    checkpoint(db, id, 'recent', now - DAY)
    const result = pruneThreadData(db, now)
    const left = (db.prepare('SELECT id FROM conversation_checkpoints').all() as { id: string }[]).map(row => row.id)
    expect(result.checkpoints).toBe(6)
    expect(left).toContain('recent')
    expect(left).toContain('open-old')
    expect(left).toHaveLength(CHECKPOINTS_KEPT_PER_THREAD + 1)
    expect(db.prepare('SELECT count(*) AS n FROM conversation_checkpoint_files').get()).toEqual({ n: CHECKPOINTS_KEPT_PER_THREAD + 1 })
    expect(manager.read(id).thread.id).toBe(id)
    await manager.stop()
  })

  it('drops settled operations after 30 days and keeps the ones that may still need recovery', async () => {
    const { db, manager, id } = setup()
    const now = Date.now(), old = now - 45 * DAY
    const insert = db.prepare('INSERT INTO conversation_operations (id, thread_id, generation, kind, state, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)')
    insert.run('done', id, 'turn', 'completed', old, old)
    insert.run('unknown', id, 'turn', 'unknown', old, old)
    insert.run('fresh', id, 'turn', 'completed', now, now)
    expect(pruneThreadData(db, now).operations).toBe(1)
    expect((db.prepare('SELECT id FROM conversation_operations ORDER BY id').all() as { id: string }[]).map(row => row.id)).toEqual(['fresh', 'unknown'])
    await manager.stop()
  })

  it('reads in full only the conversations a restart left mid-operation', async () => {
    const { db, manager, id } = setup()
    const idle = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'claude' }).thread.id
    const snapshot = manager.read(id); snapshot.thread.status = 'running'
    new ThreadHistory(db).rewriteHistory(snapshot)
    await manager.stop()
    const read = vi.spyOn(ThreadHistory.prototype, 'read')
    const restarted = new ThreadManager(db, vi.fn(), vi.fn())
    expect(read.mock.calls.map(call => call[0])).toEqual([id])
    read.mockRestore()
    expect(restarted.read(id).thread.status).not.toBe('running')
    expect(restarted.read(idle).thread.status).toBe('idle')
    await restarted.stop()
  })
})
