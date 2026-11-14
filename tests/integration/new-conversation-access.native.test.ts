// The access a conversation the person creates starts with (Settings > Agents). The product owner asked on 2026-11-12
// for conversations to start with Full access; the person can choose another level, and a conversation made on their
// behalf (an MCP tool, a delegation) never takes it.
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { removeTempDir } from '../helpers/removeTempDir'

type Handler = (event: unknown, ...args: unknown[]) => unknown

class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, Handler>()
  handle(channel: string, handler: Handler): void {
    if (this.handlers.has(channel)) throw new Error(`Duplicate handler for '${channel}'`)
    this.handlers.set(channel, handler)
  }
  handleOnce(channel: string, handler: Handler): void {
    this.handle(channel, (event, ...args) => { this.removeHandler(channel); return handler(event, ...args) })
  }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
  async invoke(channel: string, event: unknown, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`No handler registered for '${channel}'`)
    return await handler(event, ...args)
  }
}

const hooks = vi.hoisted(() => ({ ipcMain: null as unknown as FakeIpcMain }))
vi.mock('electron', () => ({
  ipcMain: hooks.ipcMain,
  app: { on: vi.fn(), once: vi.fn(), isPackaged: false, getPath: () => tmpdir(), getVersion: () => '1.5.0', getAppPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))

hooks.ipcMain = new FakeIpcMain()
const ipc = hooks.ipcMain

const { openInMemoryDatabase } = await import('../../electron/main/db/index')
const { installIpcSenderGuard, trustAppWindow, IPC_SENDER_REFUSED } = await import('../../electron/main/ipc/ipc-sender-guard')
const { registerThreadIpc } = await import('../../electron/main/ipc/thread.ipc')
const { IPC_CHANNELS } = await import('../../shared/types/ipc')
const { NEW_CONVERSATION_ACCESS_DEFAULT } = await import('../../shared/threadAccess')

function webContents(type = 'window') {
  return Object.assign(new EventEmitter(), { mainFrame: { name: 'main' }, getType: () => type, isDestroyed: () => false, setWindowOpenHandler: vi.fn() })
}
const appWindow = webContents()
trustAppWindow({ webContents: appWindow as never })
const stranger = webContents('webview')
const fromApp = { sender: appWindow, senderFrame: appWindow.mainFrame }
const fromStranger = { sender: stranger, senderFrame: stranger.mainFrame }

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  try { for (const fn of cleanups.splice(0).reverse()) await fn() } finally { ipc.handlers.clear(); ipc.removeAllListeners() }
})

type Created = { thread: { id: string; access?: string } }

async function app() {
  installIpcSenderGuard(ipc, null)
  const dir = mkdtempSync(join(tmpdir(), 'oxe-new-access-'))
  cleanups.push(() => removeTempDir(dir))
  const db = openInMemoryDatabase()
  cleanups.push(() => db.close())
  const runtime = registerThreadIpc(db, { bridge: join(dir, 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} })
  cleanups.push(() => runtime.stop())
  const project = await ipc.invoke(IPC_CHANNELS.thread.addProject, fromApp, dir) as { projectId: string }
  const create = (provider = 'claude') => ipc.invoke(IPC_CHANNELS.thread.create, fromApp, { projectId: project.projectId, provider }) as Promise<Created>
  return { dir, runtime, project, create }
}

describe('the access a new conversation starts with', () => {
  test('is Full access on a new install, for every provider', async () => {
    const { create } = await app()
    expect(NEW_CONVERSATION_ACCESS_DEFAULT).toBe('full-access')
    await expect(ipc.invoke(IPC_CHANNELS.thread.newConversationAccess, fromApp)).resolves.toBe('full-access')
    for (const provider of ['claude', 'codex', 'antigravity']) {
      expect((await create(provider)).thread.access, provider).toBe('full-access')
    }
  })

  test('follows the person\'s choice from then on, and leaves the conversations that exist as they are', async () => {
    const { create, runtime } = await app()
    const before = await create()
    await expect(ipc.invoke(IPC_CHANNELS.thread.setNewConversationAccess, fromApp, 'read-only')).resolves.toBe('read-only')
    await expect(ipc.invoke(IPC_CHANNELS.thread.newConversationAccess, fromApp)).resolves.toBe('read-only')
    expect((await create()).thread.access).toBe('read-only')
    await ipc.invoke(IPC_CHANNELS.thread.setNewConversationAccess, fromApp, 'workspace-write')
    expect((await create('codex')).thread.access).toBe('workspace-write')
    // The one created before the change keeps the access it had.
    expect((await runtime.manager).read(before.thread.id).thread.access).toBe('full-access')
  })

  test('refuses a level that does not exist, and keeps the one chosen', async () => {
    await app()
    await ipc.invoke(IPC_CHANNELS.thread.setNewConversationAccess, fromApp, 'workspace-write')
    for (const bad of ['everything', '', null, undefined, 3, { access: 'full-access' }]) {
      await expect(ipc.invoke(IPC_CHANNELS.thread.setNewConversationAccess, fromApp, bad), String(bad)).rejects.toThrow('Choose Read only, Can edit or Full access')
    }
    await expect(ipc.invoke(IPC_CHANNELS.thread.newConversationAccess, fromApp)).resolves.toBe('workspace-write')
  })

  test('is the person\'s to change: only the app window reaches it', async () => {
    await app()
    await expect(ipc.invoke(IPC_CHANNELS.thread.setNewConversationAccess, fromStranger, 'full-access')).rejects.toMatchObject({ code: IPC_SENDER_REFUSED })
    await expect(ipc.invoke(IPC_CHANNELS.thread.newConversationAccess, fromStranger)).rejects.toMatchObject({ code: IPC_SENDER_REFUSED })
  })

  test('a conversation made on the person\'s behalf does not take it: it starts with what its maker asks for', async () => {
    const { dir, runtime, project } = await app()
    // What an MCP tool or a delegation does: the service, with no access of its own, as before this setting existed.
    const made = (await runtime.manager).create({ workspaceId: `thread:${project.projectId}`, projectId: project.projectId, rootPath: dir, provider: 'claude' })
    expect(made.thread.access).toBeUndefined()
  })
})
