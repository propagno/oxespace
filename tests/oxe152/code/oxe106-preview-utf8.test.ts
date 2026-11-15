// Frozen acceptance test for 1.5.2 OxeCode F3 (OXE program oxespace-152-code, phase F3, Jira OXE-106).
// Written by the planner; the executor must not edit it.
// Defect (real use, 13/11): a page served without a charset (Vite on 127.0.0.1:5180) shows "Ã©" for "é" in the Web
// Preview, because Chromium falls back to Windows-1252. The preview's WebContentsView is created without
// `defaultEncoding` (electron/main/services/browser-preview.service.ts:141).
// Contract:
// - Every WebContentsView BrowserPreviewService.mount creates carries `webPreferences.defaultEncoding === 'UTF-8'`,
//   whether the key is written in the service or in a helper it spreads (guestProbeWebPreferences or a new one in
//   electron/main/services/browser-preview-security.ts; this test runs that module for real).
// - The security preferences stay as they are (contextIsolation, no nodeIntegration, sandbox).
// - UTF-8 is only Chromium's default: the page is loaded with its plain URL, nothing forces an encoding, so a charset
//   the page declares still wins. The rendered-text proof is the e2e e2e/preview.spec.ts (CI only, Electron).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const created: Array<{ webPreferences?: Record<string, unknown> }> = []
const loads: unknown[][] = []

const win = {
  id: 1,
  once: () => undefined,
  isDestroyed: () => false,
  getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  contentView: { addChildView: () => undefined, removeChildView: () => undefined },
  webContents: { send: () => undefined, executeJavaScript: async () => false }
}

vi.mock('electron', () => {
  const fakeSession = {
    setPermissionRequestHandler: () => undefined, setPermissionCheckHandler: () => undefined, on: () => undefined,
    webRequest: { onBeforeSendHeaders: () => undefined }
  }
  class WebContentsView {
    webContents = {
      on: () => undefined, once: () => undefined, isDestroyed: () => false, getURL: () => '', getTitle: () => 'App',
      isLoading: () => false, canGoBack: () => false, canGoForward: () => false, close: () => undefined,
      loadURL: async (...args: unknown[]) => { loads.push(args) }, setWindowOpenHandler: () => undefined,
      setZoomFactor: () => undefined, id: Math.floor(Math.random() * 1e6)
    }
    constructor(options: { webPreferences?: Record<string, unknown> }) { created.push(options) }
    setBackgroundColor(): void {}
    setVisible(): void {}
    setBounds(): void {}
  }
  return {
    app: { getAppPath: () => '/app', isPackaged: false, getPath: () => '/user-data' },
    session: { fromPartition: () => fakeSession },
    BrowserWindow: { getAllWindows: () => [win], fromWebContents: () => win },
    WebContentsView, clipboard: {}, ClipboardItem: class {}
  }
})
vi.mock('../../../electron/main/ipc/ipc-sender-guard', () => ({ trustPreviewGuest: () => undefined }))
vi.mock('../../../electron/main/i18n', () => ({ tMain: (key: string) => key }))
vi.mock('../../../electron/main/services/approvals', () => ({ approvalCenter: { ask: vi.fn() } }))

const { BrowserPreviewService } = await import('../../../electron/main/services/browser-preview.service')

const window = win as never

async function mountTab(service: InstanceType<typeof BrowserPreviewService>, ownerKey: string, action: 'open' | 'new', url: string): Promise<void> {
  const state = service.session(window, { ownerKey, action })
  await service.mount(window, { ownerKey, workspaceId: ownerKey, tabId: state.activeTabId, url, allowExternal: false, agentAccess: false })
}

describe('OXE-106 · the Web Preview reads a page without a charset as UTF-8', () => {
  beforeEach(() => { created.length = 0; loads.length = 0 })

  it('CA-1 · every Web Preview view is created with defaultEncoding UTF-8', async () => {
    const service = new BrowserPreviewService()
    await mountTab(service, 'w1', 'open', 'http://127.0.0.1:5180/')
    await mountTab(service, 'w1', 'new', 'http://127.0.0.1:5180/about')
    await mountTab(service, 'w2', 'open', 'http://localhost:5173/')
    expect(created).toHaveLength(3)
    for (const options of created) {
      expect(options.webPreferences?.defaultEncoding).toBe('UTF-8')
      expect(options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true })
    }
  })

  it('CA-2 · a charset the page declares still wins: UTF-8 is only the default', async () => {
    const service = new BrowserPreviewService()
    await mountTab(service, 'w1', 'open', 'http://127.0.0.1:5180/legacy-1252.html')
    expect(created[0]?.webPreferences?.defaultEncoding).toBe('UTF-8')
    // The page loads by its plain URL: no extra headers, no forced content type or charset over what the server sends.
    expect(loads).toEqual([['http://127.0.0.1:5180/legacy-1252.html']])
  })
})
