import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { removeTempDir } from '../helpers/removeTempDir'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

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
const { registerE2eMockIpcHandlers } = await import('../../electron/main/e2e/mock-ipc')
const { AgentActivity } = await import('../../electron/main/services/agent-activity/read-model')
const { IPC_CHANNELS } = await import('../../shared/types/ipc')

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

describe('T21 · thread:agent-summary over IPC and E2E mock', () => {
  test('validates input, guards sender, returns null for unknown thread, and aggregates thread + agent panes', async () => {
    installIpcSenderGuard(ipc, null)
    const dir = mkdtempSync(join(tmpdir(), 'oxe-t21-summary-'))
    cleanups.push(() => removeTempDir(dir))
    writeFileSync(join(dir, 'index.ts'), 'export const x = 1\n', 'utf8')

    const db = openInMemoryDatabase()
    cleanups.push(() => db.close())
    const activity = new AgentActivity(db, {
      isProductionHost: (_ws, host) => host === 'api.prod.example',
      pendingFor: () => false,
      now: () => 10_000
    })

    const runtime = registerThreadIpc(
      db,
      { bridge: join(dir, 'bridge.cjs'), prepare: async () => ({ OXESPACE_EXECUTION_ID: 'e1', OXESPACE_EXECUTION_TOKEN: 't1' }), end: () => {} },
      undefined,
      () => activity
    )
    cleanups.push(() => runtime.stop())

    await expect(ipc.invoke(IPC_CHANNELS.thread.agentSummary, fromStranger, 't-any')).rejects.toMatchObject({ code: IPC_SENDER_REFUSED })
    for (const bad of ['', null, undefined, 42, 'a\0b']) {
      await expect(ipc.invoke(IPC_CHANNELS.thread.agentSummary, fromApp, bad)).rejects.toMatchObject({ message: 'thread.invalidInput' })
    }
    await expect(ipc.invoke(IPC_CHANNELS.thread.agentSummary, fromApp, 'missing-thread')).resolves.toBeNull()

    const manager = await runtime.manager
    const created = manager.create({ workspaceId: 'thread:p1', projectId: 'p1', rootPath: dir, provider: 'claude' })
    const threadId = created.thread.id

    // Configure one agent pane and one user shell pane inside the thread's root place
    manager.configurePanes(() => [
      { paneId: 'p-agent', title: 'Claude', workspaceId: 'ws-1', launchDir: dir, agent: true },
      { paneId: 'p-yours', title: 'Shell', workspaceId: 'ws-1', launchDir: dir, agent: false }
    ])

    // Seed place write + resolved approval event on the thread
    db.prepare("INSERT INTO thread_places (thread_id, id, kind, path, first_seen_at, writes) VALUES (?, 'pl-root', 'root', ?, 1, 2)").run(threadId, dir)
    db.prepare("INSERT INTO thread_place_writes (thread_id, place_id, path, kind, at) VALUES (?, 'pl-root', 'index.ts', 'update', 2), (?, 'pl-root', 'extra.ts', 'add', 3)").run(threadId, threadId)
    const snapshot = manager.read(threadId)
    snapshot.events.push(
      { type: 'request-resolved', id: 'r1', state: 'resolved', resolution: 'approved', resolvedAt: 5 },
      { type: 'request-resolved', id: 'r2', state: 'resolved', resolution: 'declined', resolvedAt: 6 }
    )

    // Seed audit rows for thread, agent pane, user pane, and another thread
    db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (10, ?, 'c1', 'db', 'postgres', 'dev', 'oxespace_db_query', 'SELECT 1', 'auto', 'ok')").run(`thread:${threadId}`)
    db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (10, 'pane:p-agent', 'c1', 'db', 'postgres', 'dev', 'oxespace_container_action', 'restart web', 'approved', 'ok')").run()
    db.prepare("INSERT INTO oxequery_audit (ts, actor, connection_id, connection_name, engine, environment, tool, text, decision, outcome) VALUES (10, 'pane:p-yours', 'c1', 'db', 'postgres', 'dev', 'oxespace_db_query', 'SELECT 1', 'auto', 'ok')").run()
    db.prepare("INSERT INTO agent_http_audit (ts, actor, workspace_id, agent, source, tool_use_id, call_index, tool, method, scheme, host, port, path_template, query_keys_json, header_names_json, has_body, insecure, plain_http_external, status, command_redacted, output_truncated) VALUES (10, 'pane:p-agent', 'ws-1', 'claude-code', 'hook', 'tu_1', 0, 'curl', 'POST', 'https', 'api.prod.example', 443, '/v1', '[]', '[]', 1, 0, 0, 200, 'curl', 0)").run()

    const summary = await ipc.invoke(IPC_CHANNELS.thread.agentSummary, fromApp, threadId)
    expect(summary).toEqual({
      files: 2,
      databases: 1,
      http: 1,
      httpProduction: 1,
      containers: 1,
      approvals: 1,
      failedSources: []
    })
  })

  test('E2E mock handler returns a complete zeroed ThreadAgentSummary shape', async () => {
    installIpcSenderGuard(ipc, null)
    registerE2eMockIpcHandlers()
    const summary = await ipc.invoke(IPC_CHANNELS.thread.agentSummary, fromApp, 't1')
    expect(summary).toEqual({
      files: 0,
      databases: 0,
      http: 0,
      httpProduction: 0,
      containers: 0,
      approvals: 0,
      failedSources: []
    })
  })
})
