import { afterEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const mainFrame = {}
const setCoordinator = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
  BrowserWindow: { fromWebContents: (sender: { window?: boolean }) => (sender.window ? {} : null), getAllWindows: () => [] },
  dialog: {}, shell: {}, app: { getPath: () => '' }
}))
vi.mock('../../electron/main/ipc/oxepost.ipc', () => ({ registerOxePostIpc: () => {} }))
vi.mock('../../electron/main/services/conversation/native-account.service', () => ({ NativeAccountService: class { stop() {} }, authScopeId: () => '' }))
vi.mock('../../electron/main/services/conversation/thread-runtime', () => ({ createThreadManager: async () => ({ setCoordinator, stop: async () => {} }) }))

import { openInMemoryDatabase } from '../../electron/main/db'
import { registerThreadIpc } from '../../electron/main/ipc/thread.ipc'
import { IPC_CHANNELS } from '../../shared/types/ipc'

const databases: ReturnType<typeof openInMemoryDatabase>[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close(); handlers.clear(); setCoordinator.mockReset() })

describe('thread:set-coordinator IPC (B1.4)', () => {
  it('takes a thread id and a boolean from the window\'s main frame only', async () => {
    const db = openInMemoryDatabase(); databases.push(db)
    registerThreadIpc(db, {} as never)
    const handler = handlers.get(IPC_CHANNELS.thread.setCoordinator)!
    expect(handler).toBeTypeOf('function')
    const app = { sender: { window: true, mainFrame }, senderFrame: mainFrame }
    await handler(app, 'thread-A', true)
    await handler(app, 'thread-A', false)
    expect(setCoordinator.mock.calls).toEqual([['thread-A', true], ['thread-A', false]])
    for (const invalid of [undefined, 'true', 1, null, {}]) expect(() => handler(app, 'thread-A', invalid)).toThrow('Invalid coordinator input')
    for (const invalid of [undefined, '', 42, { id: 'thread-A' }, 'x\0y', 'x'.repeat(70000)]) expect(() => handler(app, invalid, true)).toThrow('Invalid thread input')
    expect(() => handler({ sender: { window: true, mainFrame }, senderFrame: {} }, 'thread-A', true)).toThrow('application main frame')
    expect(() => handler({ sender: { window: false, mainFrame }, senderFrame: mainFrame }, 'thread-A', true)).toThrow('application main frame')
    expect(setCoordinator).toHaveBeenCalledTimes(2)
  })
})
