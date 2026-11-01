// @vitest-environment node
/**
 * B12 · One sender guard for every IPC channel. Three layers:
 * - contract: the whole channel surface (IPC_CHANNELS, through the E2E mock that claims every channel) is registered
 *   through the guard, and every channel refuses a guest and a subframe of the main window with the C3 code;
 * - behaviour: the real terminal, file-system and MCP modules, the Design Mode exception, `on` / `once` / `handleOnce`;
 * - source: the guard is installed before anything registers, and nothing registers or checks senders on its own.
 */
import { EventEmitter } from 'node:events'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, Handler>()
  handle(channel: string, handler: Handler): void {
    if (this.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
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

const hooks = vi.hoisted(() => ({ ipcMain: null as unknown as FakeIpcMain, appEvents: new Map<string, (...args: unknown[]) => void>(), record: vi.fn() }))
// The factory runs at the first import of electron, below, once hooks.ipcMain exists: every module sees that one fake.
vi.mock('electron', () => {
  return {
    ipcMain: hooks.ipcMain,
    app: { on: (name: string, listener: (...args: unknown[]) => void) => hooks.appEvents.set(name, listener), once: vi.fn(), isPackaged: true, getPath: () => '', getVersion: () => '1.4.0', getAppPath: () => '' },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
    WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
    session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
  }
})
vi.mock('../../electron/main/services/diagnostics/incident-sink', async importOriginal => ({ ...await importOriginal<object>(), recordIncident: hooks.record }))

hooks.ipcMain = new FakeIpcMain()
const { installIpcSenderGuard, trustAppWindow, trustPreviewGuest, IPC_GUARDED, IPC_SENDER_REFUSED, GUEST_CHANNELS } = await import('../../electron/main/ipc/ipc-sender-guard')
const { IPC_CHANNELS } = await import('../../shared/types/ipc')
const { DESIGN_MODE_CHANNELS } = await import('../../shared/types/design-mode')

function webContents(type = 'window') {
  return Object.assign(new EventEmitter(), { mainFrame: { name: 'main' }, getType: () => type, isDestroyed: () => false, setWindowOpenHandler: vi.fn() })
}
const appWindow = webContents()
trustAppWindow({ webContents: appWindow as never })
const previewGuest = webContents('browserView')
trustPreviewGuest(previewGuest as never)
const strangerGuest = webContents('webview') // e.g. a <webview> guest: never trusted
const strayWindow = webContents('window') // a BrowserWindow created anywhere but createMainWindow: never trusted either

const fromApp = { sender: appWindow, senderFrame: appWindow.mainFrame }
const fromAppSubframe = { sender: appWindow, senderFrame: { name: 'iframe' } }
const fromPreview = { sender: previewGuest, senderFrame: previewGuest.mainFrame }
const fromPreviewSubframe = { sender: previewGuest, senderFrame: { name: 'iframe' } }
const fromStranger = { sender: strangerGuest, senderFrame: strangerGuest.mainFrame }
const fromStrayWindow = { sender: strayWindow, senderFrame: strayWindow.mainFrame }
const fromDestroyedFrame = { sender: appWindow, senderFrame: null }

const flatten = (value: unknown): string[] => typeof value === 'string' ? [value] : Object.values(value as Record<string, unknown>).flatMap(flatten)
const ALL_CHANNELS = [...new Set(flatten(IPC_CHANNELS))]
const group = (name: string): string[] => flatten((IPC_CHANNELS as unknown as Record<string, unknown>)[name] ?? {})
/**
 * Channels the coordinator named: what a compromised guest would want most. `approvals.*` (B10) and `remote.*` (the
 * phone gateway's admin, `answerPairing` included) are read from IPC_CHANNELS, so channels added there later are
 * covered as soon as they exist.
 */
const MUST_BE_GUARDED = [IPC_CHANNELS.terminal.write, IPC_CHANNELS.fs.writeFile, IPC_CHANNELS.mcp.create, ...group('approvals'), ...group('remote')]

const refusedWithCode = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ code: IPC_SENDER_REFUSED, message: IPC_SENDER_REFUSED })

const ipc = hooks.ipcMain

describe('the IPC sender guard over the whole channel surface', () => {
  beforeEach(() => { hooks.record.mockClear() })

  it('registers every IPC_CHANNELS channel through the guard', async () => {
    installIpcSenderGuard(ipc, null)
    const { registerE2eMockIpcHandlers } = await import('../../electron/main/e2e/mock-ipc')
    registerE2eMockIpcHandlers() // claims every channel of IPC_CHANNELS, explicitly or with its catch-all
    for (const channel of ALL_CHANNELS) {
      const registered = [ipc.handlers.get(channel), ...ipc.listeners(channel)].filter(Boolean)
      expect(registered.length, channel).toBeGreaterThan(0)
      for (const listener of registered) expect((listener as unknown as Record<symbol, unknown>)[IPC_GUARDED], channel).toBe(true)
    }
    expect(group('approvals')).toEqual(expect.arrayContaining(['approvals:respond', 'approvals:ack', 'approvals:unavailable', 'approvals:list', 'approvals:history']))
    expect(group('remote')).toContain(IPC_CHANNELS.remote.answerPairing)
    for (const channel of MUST_BE_GUARDED) expect(ipc.handlers.has(channel), channel).toBe(true)
  })

  it('refuses every channel from a guest and from a subframe of the main window, with the C3 code and an incident', async () => {
    for (const channel of ipc.handlers.keys()) {
      for (const event of [fromStranger, fromStrayWindow, fromPreview, fromAppSubframe, fromDestroyedFrame]) {
        if (event === fromPreview && GUEST_CHANNELS.has(channel)) continue
        await refusedWithCode(ipc.invoke(channel, event))
      }
      expect(hooks.record).toHaveBeenCalledWith('incident.ipc.senderRefused', channel)
    }
    // The incident names the channel and nothing else: no URL, path or payload.
    for (const call of hooks.record.mock.calls) expect(call).toHaveLength(2)
  })

  it('lets the main window through on the channels a guest wants most', async () => {
    for (const channel of MUST_BE_GUARDED) {
      const outcome = await ipc.invoke(channel, fromApp).then(() => null, (error: { code?: unknown }) => error)
      expect(outcome?.code, channel).not.toBe(IPC_SENDER_REFUSED)
    }
    expect(hooks.record).not.toHaveBeenCalled()
  })
})

describe('the IPC sender guard on the real modules and the Design Mode exception', () => {
  const terminal = { start: vi.fn(), attach: vi.fn(), detach: vi.fn(), write: vi.fn(), resize: vi.fn(), stop: vi.fn(), restart: vi.fn(), status: vi.fn() }
  const files = { listTree: vi.fn(), readFile: vi.fn(), readBinary: vi.fn(), writeFile: vi.fn(), watchFile: vi.fn(), unwatchFile: vi.fn() }
  const mcp = { create: vi.fn() }
  const grabbed = vi.fn()
  const cancelled = vi.fn()

  beforeEach(() => { hooks.record.mockClear(); vi.clearAllMocks() })

  it('registers terminal, file-system and MCP handlers through the guard', async () => {
    ipc.handlers.clear() // the E2E surface above is let go; the real modules register on the same, guarded fake
    ipc.removeAllListeners()
    installIpcSenderGuard(ipc, null) // idempotent: still one wrapper, not two
    const { registerTerminalIpc } = await import('../../electron/main/ipc/terminal.ipc')
    const { registerFileSystemIpc } = await import('../../electron/main/ipc/file-system.ipc')
    const { registerMcpIpc } = await import('../../electron/main/ipc/mcp.ipc')
    registerTerminalIpc(terminal as never)
    registerFileSystemIpc({} as never, files as never)
    registerMcpIpc(mcp as never)
    ipc.on(DESIGN_MODE_CHANNELS.grab, grabbed)
    ipc.on(DESIGN_MODE_CHANNELS.cancel, cancelled)
    for (const channel of [IPC_CHANNELS.terminal.write, IPC_CHANNELS.fs.writeFile, IPC_CHANNELS.mcp.create]) {
      expect((ipc.handlers.get(channel) as unknown as Record<symbol, unknown>)[IPC_GUARDED]).toBe(true)
    }
  })

  it('refuses terminal.write, fs.writeFile and mcp.create from a guest or a subframe before the handler runs', async () => {
    const write = { paneId: 'pane-1', data: 'rm -rf /\r' }
    const file = { workspaceId: 'ws', rootPath: '/repo', relativePath: 'a.txt', content: 'x' }
    for (const event of [fromStranger, fromStrayWindow, fromPreview, fromPreviewSubframe, fromAppSubframe]) {
      await refusedWithCode(ipc.invoke(IPC_CHANNELS.terminal.write, event, write))
      await refusedWithCode(ipc.invoke(IPC_CHANNELS.fs.writeFile, event, file))
      await refusedWithCode(ipc.invoke(IPC_CHANNELS.mcp.create, event, { name: 'evil' }))
    }
    expect(terminal.write).not.toHaveBeenCalled()
    expect(files.writeFile).not.toHaveBeenCalled()
    expect(mcp.create).not.toHaveBeenCalled()
    expect(hooks.record).toHaveBeenCalledWith('incident.ipc.senderRefused', IPC_CHANNELS.terminal.write)
    expect(hooks.record).toHaveBeenCalledWith('incident.ipc.senderRefused', IPC_CHANNELS.fs.writeFile)
    expect(hooks.record).toHaveBeenCalledWith('incident.ipc.senderRefused', IPC_CHANNELS.mcp.create)
  })

  it('answers the main window main frame unchanged', async () => {
    await ipc.invoke(IPC_CHANNELS.terminal.write, fromApp, { paneId: 'pane-1', data: 'ls\r' })
    await ipc.invoke(IPC_CHANNELS.fs.writeFile, fromApp, { workspaceId: 'ws', rootPath: '/repo', relativePath: 'a.txt', content: 'x' })
    expect(terminal.write).toHaveBeenCalledWith({ paneId: 'pane-1', data: 'ls\r' })
    expect(files.writeFile).toHaveBeenCalledWith({ workspaceId: 'ws', rootPath: '/repo', relativePath: 'a.txt', content: 'x' })
    expect(hooks.record).not.toHaveBeenCalled()
  })

  it('keeps the Design Mode grab and cancel working from the preview guest, and only from its main frame', () => {
    const payload = { selector: '#a' }
    ipc.emit(DESIGN_MODE_CHANNELS.grab, fromPreview, payload)
    ipc.emit(DESIGN_MODE_CHANNELS.cancel, fromPreview)
    expect(grabbed).toHaveBeenCalledWith(fromPreview, payload)
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(hooks.record).not.toHaveBeenCalled()
    // A send has no caller to reject: a refused one is dropped (never thrown into the emitter) and recorded.
    expect(() => ipc.emit(DESIGN_MODE_CHANNELS.grab, fromStranger, payload)).not.toThrow()
    expect(() => ipc.emit(DESIGN_MODE_CHANNELS.grab, fromPreviewSubframe, payload)).not.toThrow()
    expect(grabbed).toHaveBeenCalledTimes(1)
    expect(hooks.record).toHaveBeenCalledWith('incident.ipc.senderRefused', DESIGN_MODE_CHANNELS.grab)
  })

  it('guards once, handleOnce, prependListener and still lets removeListener find the original', async () => {
    const once = vi.fn()
    ipc.once('demo:once', once)
    ipc.emit('demo:once', fromStranger)
    expect(once).not.toHaveBeenCalled()
    const prepended = vi.fn()
    ipc.prependListener('demo:prepend', prepended)
    ipc.emit('demo:prepend', fromAppSubframe)
    expect(prepended).not.toHaveBeenCalled()
    ipc.emit('demo:prepend', fromApp)
    expect(prepended).toHaveBeenCalledTimes(1)
    ipc.removeListener('demo:prepend', prepended)
    expect(ipc.listenerCount('demo:prepend')).toBe(0)
    ipc.handleOnce('demo:handle-once', () => 'ok')
    await refusedWithCode(ipc.invoke('demo:handle-once', fromStranger))
    await expect(ipc.invoke('demo:handle-once', fromApp)).resolves.toBe('ok')
  })

  it('accepts nothing but the listed Design Mode channels from a preview guest', () => {
    expect([...GUEST_CHANNELS].sort()).toEqual([DESIGN_MODE_CHANNELS.cancel, DESIGN_MODE_CHANNELS.grab].sort())
  })

  it('keeps guests from opening windows, nesting webviews or leaving http(s)', async () => {
    const application = { on: (name: string, listener: (...args: unknown[]) => void) => hooks.appEvents.set(name, listener) }
    installIpcSenderGuard(new FakeIpcMain(), application as never)
    const nextTick = () => new Promise(resolve => setImmediate(resolve))
    // A real WebContentsView guest reports getType() === 'window' (seen in e2e/ipc-sender-guard.spec.ts): the type
    // decides nothing, the trusted set does.
    const guest = webContents('window')
    hooks.appEvents.get('web-contents-created')!({}, guest)
    await nextTick()
    expect(guest.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    expect((guest.setWindowOpenHandler.mock.calls[0][0] as () => unknown)()).toEqual({ action: 'deny' })
    const attach = { preventDefault: vi.fn() }
    guest.emit('will-attach-webview', attach)
    expect(attach.preventDefault).toHaveBeenCalled()
    const toFile = { preventDefault: vi.fn() }, toPage = { preventDefault: vi.fn() }
    guest.emit('will-navigate', toFile, 'file:///etc/passwd')
    guest.emit('will-navigate', toPage, 'http://localhost:5173/next')
    expect(toFile.preventDefault).toHaveBeenCalled()
    expect(toPage.preventDefault).not.toHaveBeenCalled()
    const window = webContents('window')
    hooks.appEvents.get('web-contents-created')!({}, window)
    trustAppWindow({ webContents: window as never }) // as index.ts does, right after the constructor
    await nextTick()
    expect(window.setWindowOpenHandler).not.toHaveBeenCalled() // the main window keeps its own rules
  })
})

describe('the guard in the source', () => {
  const root = resolve(__dirname, '../..')
  const mainSources = readdirSync(join(root, 'electron', 'main'), { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !/(^|[\\/])vendor[\\/]/.test(file))
    .map(file => ({ file, text: readFileSync(join(root, 'electron', 'main', file), 'utf8') }))

  it('is installed at the top of the main entry, before any channel is registered', () => {
    const index = readFileSync(join(root, 'electron', 'main', 'index.ts'), 'utf8')
    const install = index.search(/^installIpcSenderGuard\(\)/m)
    expect(install).toBeGreaterThan(0)
    for (const first of ['markAppReady()', 'await measureStartup(\'ipc-handlers\', registerIpcHandlers)', 'function registerIpcHandlers']) {
      expect(index.indexOf(first), first).toBeGreaterThan(install)
    }
    expect(index).toMatch(/const mainWindow = trustAppWindow\(new BrowserWindow\(/)
    expect(index.match(/new BrowserWindow\(/g)).toHaveLength(1) // a second window would need its own, explicit trust
    // No <webview> guest can exist: the tag is off, and nothing in the renderer renders one.
    expect(index).toMatch(/^\s*webviewTag: false,/m)
    expect(index).not.toMatch(/webviewTag: true/)
  })

  it('has no module that registers a channel when imported, or that checks the sender itself', () => {
    for (const { file, text } of mainSources) {
      expect(text, file).not.toMatch(/^ipcMain\.(handle|handleOnce|on|once|addListener|prependListener|prependOnceListener)\(/m)
      expect(text, file).not.toMatch(/ipcMain as \w+/)
      expect(text, file).not.toMatch(/requireAppFrame/)
      if (!file.endsWith('ipc-sender-guard.ts')) expect(text, file).not.toMatch(/senderFrame\s*!==/)
      if (!/ipc-sender-guard\.ts$|diagnostics\.ipc\.ts$/.test(file)) expect(text, file).not.toMatch(/\.handle\s*=\s*\(/)
    }
  })

  it('has the guest preload send only the excepted channels', () => {
    const source = readFileSync(join(root, 'electron', 'preload', 'design-guest.ts'), 'utf8')
    // The E2E-only probe (tests/unit/guest-probe-gate.test.ts) sends whatever the spec asks: that is its point. It is
    // the gated block at the end of the file; everything before it is what a shipped guest runs.
    const gate = source.indexOf('if (process.argv.includes(GUEST_PROBE_ARGUMENT)) {')
    expect(gate).toBeGreaterThan(0)
    expect(source.slice(gate).trimEnd().endsWith('}')).toBe(true)
    expect(source.slice(gate).match(/^\S/gm)).toEqual(['i', '}']) // nothing else at top level after the gate
    const preload = source.slice(0, gate)
    const calls = [...preload.matchAll(/ipcRenderer\.(send|invoke|sendSync|postMessage)\(([^,)]+)/g)].map(match => match[2].trim())
    expect(calls.length).toBeGreaterThan(0)
    for (const channel of calls) {
      const key = /^DESIGN_MODE_CHANNELS\.(\w+)$/.exec(channel)?.[1]
      expect(key && GUEST_CHANNELS.has((DESIGN_MODE_CHANNELS as Record<string, string>)[key]), channel).toBe(true)
    }
  })
})
