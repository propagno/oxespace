import { beforeEach, describe, expect, it, vi } from 'vitest'

// T43: main is the authority for agent access to the preview. The window re-sends its state on every tab change, and
// that must never give back what main took away.

const sent: Array<[string, unknown]> = []
let rendererSaysOn = true
const win = {
  id: 1,
  once: () => undefined,
  isDestroyed: () => false,
  getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
  contentView: { addChildView: () => undefined, removeChildView: () => undefined },
  // The window's own flag (data-agent-automation) still says on: the stale renderer state this item is about.
  webContents: { send: (channel: string, event: unknown) => { sent.push([channel, event]) }, executeJavaScript: async () => rendererSaysOn }
}

vi.mock('electron', () => {
  class WebContentsView {
    webContents = {
      on: () => undefined, once: () => undefined, isDestroyed: () => false, getURL: () => 'http://localhost:5173/', getTitle: () => 'App',
      isLoading: () => false, canGoBack: () => false, canGoForward: () => false, loadURL: async () => undefined, close: () => undefined,
      setZoomFactor: () => undefined, id: Math.floor(Math.random() * 1e6)
    }
    setBackgroundColor(): void {}
    setVisible(): void {}
    setBounds(): void {}
  }
  return { app: { getAppPath: () => '/app', isPackaged: false }, BrowserWindow: { getAllWindows: () => [win], fromWebContents: () => win }, WebContentsView, clipboard: {}, ClipboardItem: class {} }
})
vi.mock('../../electron/main/services/browser-preview-security', () => ({ guestProbeWebPreferences: () => ({}), previewSessionFor: () => ({}), securePreviewGuest: () => undefined }))
vi.mock('../../electron/main/ipc/ipc-sender-guard', () => ({ trustPreviewGuest: () => undefined }))
vi.mock('../../electron/main/i18n', () => ({ tMain: (key: string) => key }))
vi.mock('../../electron/main/services/approvals', () => ({ approvalCenter: { ask: vi.fn() } }))

const { BrowserPreviewService, browserPreviewService } = await import('../../electron/main/services/browser-preview.service')
const { PreviewAutomation } = await import('../../electron/main/services/documentation/preview-automation')

const window = win as never
const OWNER = 'w1'
const URL = 'http://localhost:5173/'

async function openTab(service: InstanceType<typeof BrowserPreviewService>, action: 'open' | 'new', agentAccess: boolean): Promise<string> {
  const state = service.session(window, { ownerKey: OWNER, action })
  await service.mount(window, { ownerKey: OWNER, workspaceId: OWNER, tabId: state.activeTabId, url: URL, allowExternal: false, agentAccess })
  service.bounds(window, { ownerKey: OWNER, tabId: state.activeTabId, x: 0, y: 0, width: 400, height: 300, visible: true })
  return state.activeTabId
}

/** What the window's effect does after any tab change: re-send its state for every tab, with no grant. */
function rendererResync(service: InstanceType<typeof BrowserPreviewService>, agentAccess: boolean): void {
  for (const tab of service.tabsFor(window, OWNER)) if (tab.url) service.setAccess(window, { ownerKey: OWNER, tabId: tab.id, agentAccess, allowExternal: false })
}

describe('T43 · agent access to the preview: main decides, the window asks or reflects', () => {
  beforeEach(() => { sent.length = 0; rendererSaysOn = true })

  it('the window cannot turn access on by itself: only the person\'s grant does', async () => {
    const service = new BrowserPreviewService()
    const tab = await openTab(service, 'open', true)
    expect(service.hasAgentAccess(window, OWNER)).toBe(false)
    expect(service.activeFor(OWNER)).toBeNull()
    expect(service.setAccess(window, { ownerKey: OWNER, tabId: tab, agentAccess: true, allowExternal: false })).toEqual({ agentAccess: false })
    expect(service.setAccess(window, { ownerKey: OWNER, tabId: tab, agentAccess: true, allowExternal: false, grant: true })).toEqual({ agentAccess: true })
    expect(service.activeFor(OWNER)?.tabId).toBe(tab)
    // Turning it off from the window always applies.
    expect(service.setAccess(window, { ownerKey: OWNER, tabId: tab, agentAccess: false, allowExternal: false })).toEqual({ agentAccess: false })
    expect(service.activeFor(OWNER)).toBeNull()
  })

  it('a revoke reaches an owner with no open tab, so reopening the panel does not bring access back (review M1)', async () => {
    const service = new BrowserPreviewService()
    const tab = await openTab(service, 'open', true)
    service.setAccess(window, { ownerKey: OWNER, tabId: tab, agentAccess: true, allowExternal: false, grant: true })
    service.session(window, { ownerKey: OWNER, action: 'close', tabId: tab })
    expect(service.revokeAgentAccess({ workspaceId: OWNER })).toBe(1)
    // The panel opens again with the window's "on" still set, mounting a tab and re-sending.
    const reopened = await openTab(service, 'new', true)
    rendererResync(service, true)
    expect(service.hasAgentAccess(window, OWNER)).toBe(false)
    expect(service.activeFor(OWNER)).toBeNull()
    expect(service.setAccess(window, { ownerKey: OWNER, tabId: reopened, agentAccess: true, allowExternal: false })).toEqual({ agentAccess: false })
  })

  it('a grant made before any tab mounted is cleared by a workspace revoke (its workspace is not known yet)', () => {
    const service = new BrowserPreviewService()
    service.session(window, { ownerKey: 'thread:t1', action: 'open' })
    service.setAccess(window, { ownerKey: 'thread:t1', tabId: '00000000-0000-0000-0000-000000000000', agentAccess: true, allowExternal: false, grant: true })
    expect(service.hasAgentAccess(window, 'thread:t1')).toBe(true)
    expect(service.revokeAgentAccess({ workspaceId: OWNER })).toBe(1)
    expect(service.hasAgentAccess(window, 'thread:t1')).toBe(false)
  })

  it('a revoke from main holds through tab changes and the window\'s re-sends, until the person grants again', async () => {
    const service = browserPreviewService
    const first = await openTab(service, 'open', true)
    service.setAccess(window, { ownerKey: OWNER, tabId: first, agentAccess: true, allowExternal: false, grant: true })
    const automation = new PreviewAutomation()
    expect(await automation.run(OWNER, { action: 'tabs' } as never, () => undefined)).toMatchObject({ tabs: [{ id: first }] })

    expect(service.revokeAgentAccess({ workspaceId: OWNER })).toBe(1)
    // The window is told, so its toggle shows off.
    expect(sent).toContainEqual(['browser-preview:event', expect.objectContaining({ ownerKey: OWNER, type: 'access', agentAccess: false })])

    // The tab list changes (a new tab, mounted with the window's stale "on"), and the window re-sends its state.
    const second = await openTab(service, 'new', true)
    rendererResync(service, true)
    expect(service.hasAgentAccess(window, OWNER)).toBe(false)
    expect(service.activeFor(OWNER)).toBeNull()
    await expect(automation.run(OWNER, { action: 'tabs' } as never, () => undefined)).rejects.toThrow('enable Agent documentation access')
    await expect(automation.assertAccess(OWNER, () => undefined)).rejects.toThrow('enable Agent documentation access')

    // The person turns it on again: the next call runs.
    service.setAccess(window, { ownerKey: OWNER, tabId: second, agentAccess: true, allowExternal: false, grant: true })
    expect(await automation.run(OWNER, { action: 'tabs' } as never, () => undefined)).toMatchObject({ tabs: [{ id: first }, { id: second }] })
    expect(service.activeFor(OWNER)?.tabId).toBe(second)
  })
})
