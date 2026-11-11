// @vitest-environment node
/**
 * CR-F4-7 (TECH LEAD 09/11, from FRONTEND's review of #749): ThreadOrchestrator implements the place calls (places,
 * placeDiff, readPlaceFile, resolvePath, answerPlaceDrift, placeUndo/Restore/Discard, panes, collisions), but no
 * channel, main handler or preload method exposed them. Contract: ccr-f4-places-pr.md §Contract and §A14 Undo.
 *
 * - The channel map: stable names, each in exactly one MCP capability (person-only writes and the read outside the
 *   workspace are `forbidden`, the UI read models `excluded`).
 * - Main: electron/main/ipc/thread-places.ipc.ts registers every call through the real sender guard, validates its
 *   arguments before the manager runs (C3 `thread.invalidInput`), and returns the manager's answer unchanged.
 * - The preload: window.oxe.thread's methods invoke their channel with the arguments as given; onPlacesChanged
 *   subscribes and unsubscribes.
 * - Types: tsc over cr-f4-7-bridge-types.ts (the renderer's bridge types read the real bridge).
 */
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const hooks = vi.hoisted(() => ({ ipcMain: null as unknown as FakeIpcMain, record: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: hooks.ipcMain,
  app: { on: vi.fn(), once: vi.fn(), isPackaged: true, getPath: () => '', getVersion: () => '1.5.0', getAppPath: () => '' },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
  WebContentsView: class {}, clipboard: {}, ClipboardItem: class {}, dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false },
  session: { fromPartition: () => ({}) }, net: { isOnline: () => true }
}))
vi.mock('../../../electron/main/services/diagnostics/incident-sink', async importOriginal => ({ ...await importOriginal<object>(), recordIncident: hooks.record }))

hooks.ipcMain = new FakeIpcMain()
const ipc = hooks.ipcMain
const { installIpcSenderGuard, trustAppWindow, IPC_GUARDED, IPC_SENDER_REFUSED } = await import('../../../electron/main/ipc/ipc-sender-guard')
const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
const { MCP_COVERAGE } = await import('../../../shared/mcp-coverage')
const { THREAD_PLACE_DRIFT_ANSWERS } = await import('../../../shared/types/thread-places')
const { createOxeApi } = await import('../../../electron/preload/api')

const ROOT = resolve(__dirname, '../../..')
const thread = IPC_CHANNELS.thread as unknown as Record<string, string | undefined>

/** The frozen names: IPC_CHANNELS.thread key → channel (FRONTEND's CR-F4-8 tests read the same keys). */
const CHANNELS = {
  places: 'thread:places',
  placeDiff: 'thread:place-diff',
  placeRead: 'thread:place-read',
  resolvePath: 'thread:resolve-path',
  placeDriftAnswer: 'thread:place-drift-answer',
  placeUndo: 'thread:place-undo',
  placeRestore: 'thread:place-restore',
  placeDiscard: 'thread:place-discard',
  panes: 'thread:panes',
  collisions: 'thread:collisions',
  agentSummary: 'thread:agent-summary',
  placesChanged: 'thread:places-changed'
} as const
/** Person-only (A14 Undo condition 5, A15) and the read outside the workspace roots (A17): never an MCP tool. */
const FORBIDDEN = ['placeRead', 'placeDriftAnswer', 'placeUndo', 'placeRestore', 'placeDiscard']
const EXCLUDED = ['places', 'placeDiff', 'resolvePath', 'panes', 'collisions', 'agentSummary', 'placesChanged']

/** The window's main frame, the only trusted sender, and a stranger guest. */
function webContents(type = 'window') {
  return Object.assign(new EventEmitter(), { mainFrame: { name: 'main' }, getType: () => type, isDestroyed: () => false, setWindowOpenHandler: vi.fn() })
}
const appWindow = webContents()
trustAppWindow({ webContents: appWindow as never })
const stranger = webContents('webview')
const fromApp = { sender: appWindow, senderFrame: appWindow.mainFrame }
const fromStranger = { sender: stranger, senderFrame: stranger.mainFrame }

/** What ThreadManager answers; each call resolves a distinct value, so the test sees it come back unchanged. */
function fakeManager() {
  return {
    places: vi.fn(async (id: string) => ({ marker: 'places', id })),
    placeDiff: vi.fn(async (id: string, placeId: string) => ({ marker: 'placeDiff', id, placeId })),
    readPlaceFile: vi.fn(async (id: string, placeId: string, relativePath: string) => ({ marker: 'placeRead', id, placeId, relativePath, readOnly: true })),
    resolvePath: vi.fn(async (id: string, raw: string) => ({ kind: 'missing', looked: [], id, raw })),
    answerPlaceDrift: vi.fn(async () => ({ ok: true, place: { id: 'place-1' } })),
    placeUndo: vi.fn(async () => ({ ok: true, restoreToken: 'token-1' })),
    placeRestore: vi.fn(async () => ({ ok: true })),
    placeDiscard: vi.fn(async () => ({ ok: false, refusal: { code: 'thread.place.confirm', params: {} } })),
    panes: vi.fn(async () => [{ paneId: 'pane-1' }]),
    collisions: vi.fn(async () => [{ file: 'src/a.ts', checkoutId: 'c1', others: [] }])
  }
}
type FakeManager = ReturnType<typeof fakeManager>

let manager: FakeManager
async function register(): Promise<void> {
  ipc.handlers.clear()
  ipc.removeAllListeners()
  installIpcSenderGuard(ipc, null)
  manager = fakeManager()
  const { registerThreadPlacesIpc } = await import('../../../electron/main/ipc/thread-places.ipc')
  registerThreadPlacesIpc({ manager: Promise.resolve(manager as never) })
}
const call = (key: keyof typeof CHANNELS, ...args: unknown[]) => ipc.invoke(CHANNELS[key], fromApp, ...args)
const invalid = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ message: 'thread.invalidInput' })
const managerCalls = () => Object.values(manager).reduce((count, fn) => count + fn.mock.calls.length, 0)

describe('CR-F4-7: the place calls in the channel map and MCP coverage', () => {
  test('CR-F4-7: IPC_CHANNELS.thread has every place channel, with its stable name', () => {
    for (const [key, channel] of Object.entries(CHANNELS)) expect(thread[key], key).toBe(channel)
  })

  test('CR-F4-7: each place channel is in one MCP capability: person-only writes and the place read forbidden, read models excluded', () => {
    for (const key of [...FORBIDDEN, ...EXCLUDED]) {
      const found = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(`thread.${key}`))
      expect(found, key).toHaveLength(1)
      expect(found[0], key).toHaveProperty(FORBIDDEN.includes(key) ? 'forbidden' : 'excluded')
      expect(found[0], key).not.toHaveProperty('tools')
    }
  })
})

describe('CR-F4-7: main handles each place call through the sender guard, with its arguments validated', () => {
  beforeEach(async () => { hooks.record.mockClear(); await register() })

  test('CR-F4-7: every place call is registered through the guard and refused from a guest before the manager runs', async () => {
    const handled = Object.entries(CHANNELS).filter(([key]) => key !== 'agentSummary' && key !== 'placesChanged')
    for (const [key, channel] of handled) {
      const handler = ipc.handlers.get(channel)
      expect(handler, key).toBeDefined()
      expect((handler as unknown as Record<symbol, unknown>)[IPC_GUARDED], key).toBe(true)
      await expect(ipc.invoke(channel, fromStranger, 'thread-A', 'place-1', 'x')).rejects.toMatchObject({ code: IPC_SENDER_REFUSED })
      expect(hooks.record).toHaveBeenCalledWith('incident.ipc.senderRefused', channel)
    }
    expect(managerCalls()).toBe(0)
  })

  test('CR-F4-7: the reads reach the manager with the arguments as given and return its answer unchanged', async () => {
    await expect(call('places', 'thread-A')).resolves.toEqual({ marker: 'places', id: 'thread-A' })
    await expect(call('placeDiff', 'thread-A', 'place-1')).resolves.toEqual({ marker: 'placeDiff', id: 'thread-A', placeId: 'place-1' })
    await expect(call('placeRead', 'thread-A', 'place-1', 'notes/a.md')).resolves.toEqual({ marker: 'placeRead', id: 'thread-A', placeId: 'place-1', relativePath: 'notes/a.md', readOnly: true })
    await expect(call('resolvePath', 'thread-A', 'src/a.ts', { turnId: 'turn-1' })).resolves.toEqual({ kind: 'missing', looked: [], id: 'thread-A', raw: 'src/a.ts' })
    await expect(call('panes', 'thread-A')).resolves.toEqual([{ paneId: 'pane-1' }])
    await expect(call('collisions', 'thread-A')).resolves.toEqual([{ file: 'src/a.ts', checkoutId: 'c1', others: [] }])
    expect(manager.places).toHaveBeenCalledWith('thread-A')
    expect(manager.placeDiff).toHaveBeenCalledWith('thread-A', 'place-1')
    expect(manager.readPlaceFile).toHaveBeenCalledWith('thread-A', 'place-1', 'notes/a.md')
    expect(manager.resolvePath.mock.calls[0].slice(0, 2)).toEqual(['thread-A', 'src/a.ts'])
    expect(manager.resolvePath.mock.calls[0][2]).toEqual({ turnId: 'turn-1' })
    expect(manager.panes).toHaveBeenCalledWith('thread-A')
    expect(manager.collisions).toHaveBeenCalledWith('thread-A')
  })

  test('CR-F4-7: the person-only writes reach the manager with the arguments as given and return its answer unchanged', async () => {
    for (const answer of THREAD_PLACE_DRIFT_ANSWERS) {
      await expect(call('placeDriftAnswer', 'thread-A', 'place-1', answer)).resolves.toEqual({ ok: true, place: { id: 'place-1' } })
      expect(manager.answerPlaceDrift).toHaveBeenLastCalledWith('thread-A', 'place-1', answer)
    }
    await expect(call('placeUndo', 'thread-A', 'place-1', { path: 'src/a.ts', seenMtime: 12 })).resolves.toEqual({ ok: true, restoreToken: 'token-1' })
    expect(manager.placeUndo).toHaveBeenLastCalledWith('thread-A', 'place-1', { path: 'src/a.ts', seenMtime: 12 })
    await call('placeUndo', 'thread-A', 'place-1', { path: 'src/a.ts', hunk: '@@ -1,2 +1,3 @@', seenMtime: null })
    expect(manager.placeUndo).toHaveBeenLastCalledWith('thread-A', 'place-1', { path: 'src/a.ts', hunk: '@@ -1,2 +1,3 @@', seenMtime: null })
    await expect(call('placeRestore', 'thread-A', 'token-1')).resolves.toEqual({ ok: true })
    expect(manager.placeRestore).toHaveBeenCalledWith('thread-A', 'token-1')
    // Main gives the confirm refusal (A14 condition 6): the channel passes the unconfirmed input through, never confirms it.
    await expect(call('placeDiscard', 'thread-A', 'place-1', {})).resolves.toEqual({ ok: false, refusal: { code: 'thread.place.confirm', params: {} } })
    expect(manager.placeDiscard).toHaveBeenLastCalledWith('thread-A', 'place-1', {})
    await call('placeDiscard', 'thread-A', 'place-1', { confirmed: true })
    expect(manager.placeDiscard).toHaveBeenLastCalledWith('thread-A', 'place-1', { confirmed: true })
  })

  test('CR-F4-7: an id, place, path or token that is not a non-empty string without NUL is refused with thread.invalidInput', async () => {
    for (const bad of [undefined, null, 42, '', 'a\0b', { id: 'thread-A' }, 'x'.repeat(65537)]) {
      await invalid(call('places', bad))
      await invalid(call('placeDiff', 'thread-A', bad))
      await invalid(call('placeRead', 'thread-A', 'place-1', bad))
      await invalid(call('resolvePath', 'thread-A', bad, {}))
      await invalid(call('placeRestore', 'thread-A', bad))
      await invalid(call('panes', bad))
      await invalid(call('collisions', bad))
      await invalid(call('placeDriftAnswer', bad, 'place-1', 'dismissed'))
      await invalid(call('placeUndo', 'thread-A', bad, { path: 'src/a.ts', seenMtime: 1 }))
      await invalid(call('placeDiscard', bad, 'place-1', { confirmed: true }))
    }
    expect(managerCalls()).toBe(0)
  })

  test('CR-F4-7: a drift answer outside the closed list, or a malformed undo, discard or resolve input, is refused before the manager runs', async () => {
    for (const answer of ['switch', 'SWITCHED-BACK', '', 1, null, undefined]) await invalid(call('placeDriftAnswer', 'thread-A', 'place-1', answer))
    for (const input of [undefined, null, 'src/a.ts', [], {}, { path: '', seenMtime: 1 }, { path: 'src/a.ts' }, { path: 'src/a.ts', seenMtime: '1' },
      { path: 'src/a.ts', seenMtime: Number.NaN }, { path: 'src/a.ts', seenMtime: 1, hunk: 7 }, { path: 'a\0b', seenMtime: 1 }, { path: 'src/a.ts', seenMtime: 1, force: true }]) {
      await invalid(call('placeUndo', 'thread-A', 'place-1', input))
    }
    for (const input of [null, 'yes', [], { confirmed: 'yes' }, { confirmed: 1 }, { confirmed: true, force: true }]) await invalid(call('placeDiscard', 'thread-A', 'place-1', input))
    for (const at of [null, 'turn-1', { turnId: 5 }, { turnId: '' }, { turnId: 'turn-1', cwd: '/etc' }]) await invalid(call('resolvePath', 'thread-A', 'src/a.ts', at))
    expect(managerCalls()).toBe(0)
  })

  test('CR-F4-7: the app registers the place calls with the conversation channels (marked source check: registerThreadIpc needs the database)', () => {
    // Source text on purpose: registerThreadIpc opens services over the app database, which this test does not build.
    const source = readFileSync(join(ROOT, 'electron', 'main', 'ipc', 'thread.ipc.ts'), 'utf8')
    expect(source).toMatch(/import \{ registerThreadPlacesIpc \} from '\.\/thread-places\.ipc'/)
    expect(source).toMatch(/registerThreadPlacesIpc\(\{ manager[,\s}]/)
  })
})

describe('CR-F4-7: the preload exposes each place call on window.oxe.thread', () => {
  const fakeIpc = () => ({ invoke: vi.fn().mockResolvedValue('answer'), on: vi.fn(), removeListener: vi.fn() })

  test('CR-F4-7: each method invokes its channel with the arguments as given and returns the answer', async () => {
    const preload = fakeIpc()
    const api = createOxeApi(preload).thread as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
    const cases: Array<[keyof typeof CHANNELS, unknown[]]> = [
      ['places', ['thread-A']],
      ['placeDiff', ['thread-A', 'place-1']],
      ['placeRead', ['thread-A', 'place-1', 'notes/a.md']],
      ['resolvePath', ['thread-A', 'src/a.ts', { turnId: 'turn-1' }]],
      ['placeDriftAnswer', ['thread-A', 'place-1', 'followed']],
      ['placeUndo', ['thread-A', 'place-1', { path: 'src/a.ts', hunk: '@@ -1 +1 @@', seenMtime: 3 }]],
      ['placeRestore', ['thread-A', 'token-1']],
      ['placeDiscard', ['thread-A', 'place-1', { confirmed: true }]],
      ['panes', ['thread-A']],
      ['collisions', ['thread-A']],
      ['agentSummary', ['thread-A']]
    ]
    for (const [key, args] of cases) {
      expect(typeof api[key], key).toBe('function')
      await expect(api[key](...args), key).resolves.toBe('answer')
      expect(preload.invoke, key).toHaveBeenLastCalledWith(CHANNELS[key], ...args)
    }
    expect(preload.invoke).toHaveBeenCalledTimes(cases.length)
  })

  test('CR-F4-7: onPlacesChanged subscribes to thread:places-changed, passes the payload and unsubscribes the same handler', () => {
    const preload = fakeIpc()
    const api = createOxeApi(preload).thread as unknown as { onPlacesChanged: (listener: (event: { threadId: string }) => void) => () => void }
    const listener = vi.fn()
    const off = api.onPlacesChanged(listener)
    expect(preload.on).toHaveBeenCalledWith(CHANNELS.placesChanged, expect.any(Function))
    const handler = preload.on.mock.calls[0][1] as (event: unknown, payload: unknown) => void
    handler({}, { threadId: 'thread-A' })
    expect(listener).toHaveBeenCalledWith({ threadId: 'thread-A' })
    off()
    expect(preload.removeListener).toHaveBeenCalledWith(CHANNELS.placesChanged, handler)
  })
})

describe('CR-F4-7: the renderer types read the bridge', () => {
  test('CR-F4-7: tsc accepts cr-f4-7-bridge-types.ts: every call declared, main types unchanged, the renderer bridge types assignable', () => {
    const tsc = createRequire(join(ROOT, 'package.json')).resolve('typescript/bin/tsc')
    let output = ''
    try {
      execFileSync(process.execPath, [tsc, '-p', join(ROOT, 'tests', 'acceptance', 'f4', 'tsconfig.cr-f4-7.json')], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; message: string }
      output = `${failed.stdout ?? ''}${failed.stderr ?? ''}` || failed.message
    }
    expect(output).toBe('')
  }, 180_000)
})
