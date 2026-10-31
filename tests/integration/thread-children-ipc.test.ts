import { afterEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const mainFrame = {}
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
  BrowserWindow: { fromWebContents: (sender: { window?: boolean }) => (sender.window ? {} : null), getAllWindows: () => [] },
  dialog: {}, shell: {}, app: { getPath: () => '' }
}))
vi.mock('../../electron/main/ipc/oxepost.ipc', () => ({ registerOxePostIpc: () => {} }))
vi.mock('../../electron/main/services/conversation/native-account.service', () => ({ NativeAccountService: class { stop() {} }, authScopeId: () => '' }))
vi.mock('../../electron/main/services/conversation/thread-runtime', () => ({ createThreadManager: async () => ({ stop: async () => {} }) }))

import { openInMemoryDatabase } from '../../electron/main/db'
import { registerThreadIpc } from '../../electron/main/ipc/thread.ipc'
import { IPC_CHANNELS } from '../../shared/types/ipc'

const databases: ReturnType<typeof openInMemoryDatabase>[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close(); handlers.clear() })

describe('thread:children IPC (B1.3)', () => {
  it('validates its input and the calling frame, and reads the direct children', async () => {
    const db = openInMemoryDatabase(); databases.push(db)
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', '/repo', '1x1', 'builtin-claude')").run()
    const insert = (id: string, status: string, parent?: string) => db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json, parent_thread_id, parent_via) VALUES (?, ?, 'p', ?, ?, ?, ?)")
      .run(id, 'ws', JSON.stringify({ id, title: id, status, updatedAt: 1 }), '[]', parent ?? null, parent ? 'work' : null)
    db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('p', '/repo', '/repo', 'Repo', 1, 1)").run()
    insert('parent', 'idle'); insert('child', 'running', 'parent')
    registerThreadIpc(db, {} as never)
    const children = handlers.get(IPC_CHANNELS.thread.children)!
    expect(children).toBeTypeOf('function')
    const app = { sender: { window: true, mainFrame }, senderFrame: mainFrame }
    await expect(children(app, 'parent')).resolves.toEqual({ threadId: 'parent', aggregate: { running: 1, approval: 0, failed: 0, done: 0 },
      children: [{ id: 'child', title: 'child', status: 'running', via: 'work', archived: false, updatedAt: 1 }] })
    for (const invalid of [undefined, '', 42, { id: 'parent' }, 'x\0y', 'x'.repeat(70000)]) expect(() => children(app, invalid)).toThrow('Invalid thread input')
    await expect(children(app, 'missing')).rejects.toThrow('Thread not found')
    expect(() => children({ sender: { window: true, mainFrame }, senderFrame: {} }, 'parent')).toThrow('application main frame')
    expect(() => children({ sender: { window: false, mainFrame }, senderFrame: mainFrame }, 'parent')).toThrow('application main frame')
  })
})
