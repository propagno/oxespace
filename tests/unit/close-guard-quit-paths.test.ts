// @vitest-environment node
/**
 * F26 regression net for the before-quit gate in window-close-guard.ts. The guard wraps `app.emit` because a
 * listener cannot stop the other `before-quit` listeners (the quit drain, service stops). If the wrapping stops
 * gating — removed, replaced by a listener, bound to the wrong event — these fail.
 *
 * `app.exit()` emits neither `before-quit` nor `close` in Electron, so it never reaches the guard; checked on the
 * bundled Electron 44 with a probe that armed this gate and a preventing `close`: the process still exited with the
 * code given. Here the fake `exit` likewise emits nothing, and the test pins that the gate only touches `before-quit`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloseRequest } from '../../shared/types/app'

const fakes = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const windows = new Set<{ webContents: unknown }>()
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    exited: null as number | null,
    getVersion: () => '1.4.0',
    getPath: () => '/nonexistent-oxespace-test',
    // Electron's quit emits before-quit and goes on only when nobody prevented it.
    quit(): void {
      let prevented = false
      app.emit('before-quit', { preventDefault: () => { prevented = true } })
      if (!prevented) app.emit('will-quit', { preventDefault: () => {} })
    },
    // Electron's exit ends the process without either event.
    exit(code = 0): void { app.exited = code }
  })
  const autoUpdater = Object.assign(new EventEmitter(), {
    logger: null as unknown,
    checkForUpdates: async () => null,
    quitAndInstall: (_silent?: boolean, _forceRunAfter?: boolean) => { app.quit() }
  })
  return {
    app, autoUpdater, handlers, windows,
    powerMonitor: new EventEmitter(),
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
    BrowserWindow: {
      getAllWindows: () => [],
      fromWebContents: (contents: unknown) => [...windows].find(window => window.webContents === contents) ?? null
    }
  }
})
vi.mock('electron', () => ({ app: fakes.app, ipcMain: fakes.ipcMain, powerMonitor: fakes.powerMonitor, BrowserWindow: fakes.BrowserWindow }))
vi.mock('electron-updater', () => ({ autoUpdater: fakes.autoUpdater }))
vi.mock('electron-log/main.js', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }))
vi.mock('../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident: vi.fn() }))

/**
 * Electron's window, as far as the guard sees it: `close()` emits `close` and, when nobody prevents it, waits on the
 * page's beforeunload/unload, which a busy page (`busy`) never runs, so the window stays. `destroy()` skips the page and
 * the `close` event, and emits `closed`.
 */
async function fakeWindow() {
  const { EventEmitter } = await import('node:events')
  let destroyed = false
  const webContents = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => destroyed, mainFrame: {} })
  const window = Object.assign(new EventEmitter(), {
    webContents,
    busy: true,
    prevented: [] as boolean[],
    isDestroyed: () => destroyed,
    close: vi.fn(() => {
      if (destroyed) return
      if (!window.userClose() || window.busy) return
      destroyed = true
      window.emit('closed')
    }),
    destroy: vi.fn(() => {
      if (destroyed) return
      destroyed = true
      window.emit('closed')
    }),
    /** The close button: emits `close`; true when nobody prevented it. */
    userClose(): boolean {
      let prevented = false
      window.emit('close', { preventDefault: () => { prevented = true } })
      window.prevented.push(prevented)
      return !prevented
    }
  })
  fakes.windows.add(window)
  return window
}

const originalEmit = fakes.app.emit
let binding: typeof import('../../electron/main/window-close-guard')

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  fakes.app.removeAllListeners()
  fakes.app.emit = originalEmit
  fakes.app.exited = null
  fakes.autoUpdater.removeAllListeners()
  fakes.handlers.clear()
  fakes.windows.clear()
  delete process.env.OXESPACE_E2E_MOCK_NATIVE
  binding = await import('../../electron/main/window-close-guard')
})
afterEach(() => { vi.useRealTimers() })

/** Every way index.ts and its services register on before-quit: on, once, and one prepended ahead of the guard's turn. */
function quitListeners() {
  const drain = vi.fn(), stop = vi.fn(), cleanup = vi.fn(), early = vi.fn()
  fakes.app.on('before-quit', drain)
  fakes.app.on('before-quit', stop)
  fakes.app.once('before-quit', cleanup)
  fakes.app.prependListener('before-quit', early)
  return { all: [drain, stop, cleanup, early] }
}

describe('the before-quit gate', () => {
  it('runs none of the other before-quit listeners while the request is pending or held, and all of them once on proceed', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const { all } = quitListeners()
    fakes.app.quit()
    const request = window.webContents.send.mock.calls[0][1] as CloseRequest
    expect(request.reason).toBe('quit')
    for (const listener of all) expect(listener).not.toHaveBeenCalled()

    const answer = fakes.handlers.get('app:close-answer')!
    const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    answer(event, { requestId: request.requestId, answer: 'hold' })
    fakes.app.quit() // a second quit while held: still gated, still one request
    vi.advanceTimersByTime(60_000)
    for (const listener of all) expect(listener).not.toHaveBeenCalled()
    expect(window.webContents.send).toHaveBeenCalledTimes(1)

    answer(event, { requestId: request.requestId, answer: 'proceed' })
    for (const listener of all) expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a cancelled quit leaves every listener unrun, and the next quit is gated again', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const { all } = quitListeners()
    fakes.app.quit()
    const first = window.webContents.send.mock.calls[0][1] as CloseRequest
    fakes.handlers.get('app:close-answer')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { requestId: first.requestId, answer: 'cancel' })
    fakes.app.quit()
    for (const listener of all) expect(listener).not.toHaveBeenCalled()
    expect(window.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('gates before-quit only: other app events pass through the wrapper untouched', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const willQuit = vi.fn(), quit = vi.fn()
    fakes.app.on('will-quit', willQuit)
    fakes.app.on('quit', quit)
    fakes.app.emit('will-quit', {})
    fakes.app.emit('quit', {}, 0)
    expect(willQuit).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(window.webContents.send).not.toHaveBeenCalled()
  })

  it('app.exit never reaches the guard', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const { all } = quitListeners()
    fakes.app.exit(0)
    expect(fakes.app.exited).toBe(0)
    expect(window.webContents.send).not.toHaveBeenCalled()
    for (const listener of all) expect(listener).not.toHaveBeenCalled()
  })
})

describe('the forced close (no answer, or the renderer gone)', () => {
  const answerAs = (window: Awaited<ReturnType<typeof fakeWindow>>, answer: string) => {
    const request = window.webContents.send.mock.calls[0][1] as CloseRequest
    fakes.handlers.get('app:close-answer')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { requestId: request.requestId, answer })
  }

  it('no answer within 3 s destroys the window, once, without the guard asking again', async () => {
    const { recordIncident } = await import('../../electron/main/services/diagnostics/incident-sink')
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    expect(window.userClose()).toBe(false) // asked: the first close is prevented
    vi.advanceTimersByTime(2999)
    expect(window.destroy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(recordIncident).toHaveBeenCalledWith('incident.app.closeUnanswered')
    expect(window.destroy).toHaveBeenCalledTimes(1)
    expect(window.isDestroyed()).toBe(true)
    // Not close(): that would wait on the busy page's unload and leave the window open.
    expect(window.close).not.toHaveBeenCalled()
    expect(window.prevented).toEqual([true])
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(window.destroy).toHaveBeenCalledTimes(1)
  })

  it('a close issued after the forced one is not intercepted again', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    window.destroy.mockImplementationOnce(() => { throw new Error('native destroy failed') })
    window.busy = false
    window.userClose()
    vi.advanceTimersByTime(3000)
    // destroy threw: falls back to close(), whose close event the guard lets through.
    expect(window.close).toHaveBeenCalledTimes(1)
    expect(window.prevented).toEqual([true, false])
    expect(window.isDestroyed()).toBe(true)
    expect(window.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('no answer to a quit destroys the window and quits: the drain runs once and will-quit follows', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const { all } = quitListeners()
    const willQuit = vi.fn()
    fakes.app.on('will-quit', willQuit)
    fakes.app.quit()
    for (const listener of all) expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(window.destroy).toHaveBeenCalledTimes(1)
    for (const listener of all) expect(listener).toHaveBeenCalledTimes(1)
    expect(willQuit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60_000)
    expect(willQuit).toHaveBeenCalledTimes(1)
  })

  it('hold then silence is never forced: no deadline after hold', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    window.userClose()
    answerAs(window, 'hold')
    vi.advanceTimersByTime(10 * 60_000)
    expect(window.destroy).not.toHaveBeenCalled()
    expect(window.close).not.toHaveBeenCalled()
    expect(window.isDestroyed()).toBe(false)
  })

  it('a renderer gone while held still closes the window', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    window.userClose()
    answerAs(window, 'hold')
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(window.destroy).toHaveBeenCalledTimes(1)
    expect(window.isDestroyed()).toBe(true)
  })

  it('a renderer gone while a quit is held still quits', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const { all } = quitListeners()
    fakes.app.quit()
    answerAs(window, 'hold')
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(window.destroy).toHaveBeenCalledTimes(1)
    for (const listener of all) expect(listener).toHaveBeenCalledTimes(1)
  })

  it('proceed still closes the normal way, through close() and its unload', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    window.busy = false
    window.userClose()
    answerAs(window, 'proceed')
    expect(window.close).toHaveBeenCalledTimes(1)
    expect(window.destroy).not.toHaveBeenCalled()
    expect(window.prevented).toEqual([true, false])
    expect(window.isDestroyed()).toBe(true)
  })
})

describe('the updater install', () => {
  // On Linux the updater replaces only an AppImage (updaterSupportsThisInstall); say this is one, on every OS.
  beforeEach(() => { vi.stubEnv('APPIMAGE', '/tmp/OXESpace.AppImage') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('quitAndInstall quits without asking, and the drain runs', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const updater = await import('../../electron/main/updater')
    updater.initAutoUpdater()
    await vi.waitFor(() => expect(fakes.autoUpdater.listenerCount('update-downloaded')).toBe(1))
    fakes.autoUpdater.emit('update-downloaded', { version: '1.4.1' })
    expect(updater.getAppUpdateState().status).toBe('downloaded')
    const { all } = quitListeners()
    expect(updater.quitAndInstallUpdate()).toBe(true)
    expect(window.webContents.send).not.toHaveBeenCalled()
    for (const listener of all) expect(listener).toHaveBeenCalledTimes(1)
  })

  it('an install that fails to start asks again on the next quit', async () => {
    const window = await fakeWindow()
    binding.installCloseGuard(window as never)
    const updater = await import('../../electron/main/updater')
    updater.initAutoUpdater()
    await vi.waitFor(() => expect(fakes.autoUpdater.listenerCount('update-downloaded')).toBe(1))
    fakes.autoUpdater.emit('update-downloaded', { version: '1.4.1' })
    const quitAndInstall = fakes.autoUpdater.quitAndInstall
    fakes.autoUpdater.quitAndInstall = () => { throw new Error('installer missing') }
    try {
      expect(updater.quitAndInstallUpdate()).toBe(false)
    } finally {
      fakes.autoUpdater.quitAndInstall = quitAndInstall
    }
    fakes.app.quit()
    expect(window.webContents.send).toHaveBeenCalledWith('app:close-requested', expect.objectContaining({ reason: 'quit' }))
  })
})
