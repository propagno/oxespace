import { beforeEach, describe, expect, it, vi } from 'vitest'

const openExternal = vi.fn(async () => undefined)
const recordIncident = vi.fn()
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const windows = new Set<unknown>()
vi.mock('electron', () => ({
  shell: { openExternal },
  app: { isPackaged: false },
  net: { isOnline: () => true },
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
  BrowserWindow: { fromWebContents: (contents: unknown) => (windows.has(contents) ? {} : null), getAllWindows: () => [] }
}))
vi.mock('../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident }))

const { EXTERNAL_REFUSALS_PER_MINUTE, guardMainWindowLinks, resetExternalRefusals } = await import('../../electron/main/utils/external-open')
const { registerAppInfoIpc } = await import('../../electron/main/ipc/app-info.ipc')
const { E2E_OPENED_EXTERNAL_GLOBAL, recordOpenExternal } = await import('../../electron/main/e2e/open-external-mock')
const { IPC_CHANNELS } = await import('../../shared/types/ipc')

const APP_URL = 'file:///C:/app/out/renderer/index.html'

/** A stand-in for the main window's WebContents: keeps the handlers the guard installs. */
function fakeContents() {
  let openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined
  const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>()
  const contents = {
    setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler },
    on: (event: string, listener: (event: { preventDefault(): void }, url: string) => void) => { listeners.set(event, listener); return contents }
  }
  guardMainWindowLinks(contents, APP_URL, () => 1_000_000)
  const navigate = (event: 'will-navigate' | 'will-redirect', url: string) => {
    const preventDefault = vi.fn()
    listeners.get(event)!({ preventDefault }, url)
    return preventDefault
  }
  return { open: (url: string) => openHandler!({ url }), navigate }
}

/** An IPC event from the app window's main frame, or from a frame or contents that is not it. */
function appEvent() {
  const mainFrame = {}
  const sender = { mainFrame }
  windows.add(sender)
  return { sender, senderFrame: mainFrame }
}

beforeEach(() => {
  openExternal.mockClear()
  recordIncident.mockClear()
  resetExternalRefusals()
})

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('the main window opens nothing by itself', () => {
  it('denies window.open, journals it without the URL, and opens nothing', async () => {
    const window = fakeContents()
    for (const url of ['https://example.com/', 'mailto:a@example.com', 'file:///C:/secret.txt']) expect(window.open(url)).toEqual({ action: 'deny' })
    await flush()
    expect(openExternal).not.toHaveBeenCalled()
    expect(recordIncident.mock.calls).toEqual([['incident.window.openDenied', undefined], ['incident.window.openDenied', undefined], ['incident.window.openDenied', undefined]])
    expect(JSON.stringify(recordIncident.mock.calls)).not.toMatch(/example|secret/)
  })

  it('cancels an outward navigation or redirect, journals it, and opens nothing', async () => {
    const window = fakeContents()
    expect(window.navigate('will-navigate', 'https://example.com/a?token=x')).toHaveBeenCalledTimes(1)
    expect(window.navigate('will-redirect', 'https://private.example/')).toHaveBeenCalledTimes(1)
    await flush()
    expect(openExternal).not.toHaveBeenCalled()
    expect(recordIncident.mock.calls).toEqual([['incident.window.navigationDenied', undefined], ['incident.window.navigationDenied', undefined]])
    expect(JSON.stringify(recordIncident.mock.calls)).not.toMatch(/example|token|private/)
  })

  it('lets the app navigate within itself', () => {
    const window = fakeContents()
    expect(window.navigate('will-navigate', `${APP_URL}#/settings`)).not.toHaveBeenCalled()
    expect(recordIncident).not.toHaveBeenCalled()
  })

  it('shares the per-minute budget with refusals: a burst of denials records the limit, then once', () => {
    const window = fakeContents()
    for (let index = 0; index < EXTERNAL_REFUSALS_PER_MINUTE + 30; index++) {
      if (index % 2) window.open('https://example.com/')
      else window.navigate('will-navigate', 'https://example.com/')
    }
    expect(recordIncident).toHaveBeenCalledTimes(EXTERNAL_REFUSALS_PER_MINUTE + 1)
    expect(recordIncident).toHaveBeenLastCalledWith('incident.window.externalRateLimited')
  })
})

describe('app:open-external', () => {
  registerAppInfoIpc()
  const invoke = (event: unknown, url: unknown) => handlers.get(IPC_CHANNELS.app.openExternal)!(event, url)

  it('is the channel the preload calls', () => {
    expect(IPC_CHANNELS.app.openExternal).toBe('app:open-external')
    expect(handlers.has('app:open-external')).toBe(true)
  })

  it('opens a good https link', () => {
    expect(invoke(appEvent(), 'https://example.com/docs?page=2')).toEqual({ opened: true })
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs?page=2')
    expect(recordIncident).not.toHaveBeenCalled()
  })

  it('refuses a bad URL or a non-string, journalled by its reason only', () => {
    const bad: unknown[] = ['javascript:alert(1)', 'file:///C:/secret.txt', 'https://user:pass@example.com/', `https://example.com/${'a'.repeat(2_049)}`,
      42, null, undefined, { url: 'https://example.com/' }, ['https://example.com/'], '']
    for (const url of bad) expect(invoke(appEvent(), url), String(url)).toEqual({ opened: false })
    expect(openExternal).not.toHaveBeenCalled()
    expect(recordIncident.mock.calls.map(([code, reason]) => `${code}:${reason}`)).toEqual([
      'incident.window.externalRefused:protocol', 'incident.window.externalRefused:protocol', 'incident.window.externalRefused:credentials',
      'incident.window.externalRefused:length', ...Array(6).fill('incident.window.externalRefused:malformed')
    ])
    expect(JSON.stringify(recordIncident.mock.calls)).not.toMatch(/example|secret|pass/)
  })

  it('refuses a sender that is not the app window\'s main frame', () => {
    const { sender } = appEvent()
    expect(() => invoke({ sender, senderFrame: {} }, 'https://example.com/')).toThrow(/main frame/)
    expect(() => invoke({ sender: { mainFrame: {} }, senderFrame: {} }, 'https://example.com/')).toThrow(/main frame/)
    const stranger = { mainFrame: {} }
    expect(() => invoke({ sender: stranger, senderFrame: stranger.mainFrame }, 'https://example.com/')).toThrow(/main frame/)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('the E2E mock of app:open-external', () => {
  it('records each request with the real verdict, in order, and opens nothing', () => {
    const target: Record<string, unknown> = {}
    expect(recordOpenExternal('https://example.com/', target)).toEqual({ opened: true })
    expect(recordOpenExternal('javascript:alert(1)', target)).toEqual({ opened: false })
    expect(recordOpenExternal(7, target)).toEqual({ opened: false })
    expect(target[E2E_OPENED_EXTERNAL_GLOBAL]).toEqual([
      { url: 'https://example.com/', opened: true }, { url: 'javascript:alert(1)', opened: false }, { url: 7, opened: false }
    ])
    expect(E2E_OPENED_EXTERNAL_GLOBAL).toBe('__oxeOpenedExternal')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
