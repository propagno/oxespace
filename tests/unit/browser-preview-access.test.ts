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
      setZoomFactor: () => undefined, getUserAgent: () => 'Mozilla/5.0', enableDeviceEmulation: () => undefined, disableDeviceEmulation: () => undefined, setUserAgent: () => undefined,
      id: Math.floor(Math.random() * 1e6)
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
const { PreviewAutomation } = await import('../../electron/main/services/browser-preview/preview-automation')

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

describe('OXE-442 · per-owner preview access and settings survive tab close and chat switches', () => {
  beforeEach(() => { sent.length = 0 })

  it('preserves agentAccess, allowExternal, autoVerify, zoom, and device across close/reopen while isolating other chats', async () => {
    const service = new BrowserPreviewService()
    const threadA = 'thread:chat-a'
    const threadB = 'thread:chat-b'
    const stateA = service.session(window, { ownerKey: threadA, action: 'open' })
    const tabA = stateA.activeTabId
    await service.mount(window, { ownerKey: threadA, workspaceId: OWNER, threadId: 'chat-a', tabId: tabA, url: 'https://example.com/', allowExternal: true, agentAccess: false })
    service.bounds(window, { ownerKey: threadA, tabId: tabA, x: 0, y: 0, width: 400, height: 300, visible: true })
    expect(service.setAccess(window, { ownerKey: threadA, tabId: tabA, agentAccess: true, allowExternal: true, autoVerify: false, grant: true })).toEqual({ agentAccess: true })
    service.setZoom(window, { ownerKey: threadA, tabId: tabA, zoom: 120 })
    await service.setDevice(window, { ownerKey: threadA, tabId: tabA, deviceId: 'pixel-8', rotated: true })

    // Switching away unmounts NativePreviewHost and closes the live WebContentsView, keeping session state.
    service.close(window, { ownerKey: threadA, tabId: tabA })
    expect(service.activeFor(OWNER, { kind: 'thread', id: 'chat-a' })).toBeNull()

    // Another chat starts clean and never inherits Thread A's grants or display settings.
    const openedB = service.session(window, { ownerKey: threadB, action: 'open' })
    expect(openedB.agentAccess).toBe(false)
    expect(openedB.allowExternal).toBe(false)
    expect(openedB.autoVerify).toBeUndefined()
    expect(openedB.zoom).toBeUndefined()
    expect(openedB.deviceId).toBeUndefined()

    // Returning to Thread A returns all persisted settings from main.
    const reopenedA = service.session(window, { ownerKey: threadA, action: 'open' })
    expect(reopenedA.agentAccess).toBe(true)
    expect(reopenedA.allowExternal).toBe(true)
    expect(reopenedA.autoVerify).toBe(false)
    expect(reopenedA.zoom).toBe(120)
    expect(reopenedA.deviceId).toBe('pixel-8')
    expect(reopenedA.rotated).toBe(true)

    // Remounting Thread A with its hydrated settings keeps access and respects saved autoVerify=false.
    await service.mount(window, { ownerKey: threadA, workspaceId: OWNER, threadId: 'chat-a', tabId: tabA, url: URL, allowExternal: true, agentAccess: true })
    service.bounds(window, { ownerKey: threadA, tabId: tabA, x: 0, y: 0, width: 400, height: 300, visible: true })
    expect(service.hasAgentAccess(window, threadA)).toBe(true)
    expect(service.activeFor(OWNER, { kind: 'thread', id: 'chat-a' })).toMatchObject({ tabId: tabA, external: true })
    expect(service.autoVerifyNote('chat-a')).toBeNull()

    // Turning autoVerify back on updates both tab and ownerSettings.
    expect(service.setAccess(window, { ownerKey: threadA, tabId: tabA, agentAccess: true, allowExternal: true, autoVerify: true })).toEqual({ agentAccess: true })
    expect(service.autoVerifyNote('chat-a')).toContain('http://localhost:5173/')
    expect(service.session(window, { ownerKey: threadA, action: 'open' }).autoVerify).toBe(true)
  })

  it('T43: revoking agent access while away makes session(open) report agentAccess=false while keeping non-grant settings', async () => {
    const service = new BrowserPreviewService()
    const threadA = 'thread:chat-revoke'
    const tabA = service.session(window, { ownerKey: threadA, action: 'open' }).activeTabId
    await service.mount(window, { ownerKey: threadA, workspaceId: OWNER, threadId: 'chat-revoke', tabId: tabA, url: 'https://example.com/', allowExternal: true, agentAccess: false })
    service.setAccess(window, { ownerKey: threadA, tabId: tabA, agentAccess: true, allowExternal: true, grant: true })
    service.close(window, { ownerKey: threadA, tabId: tabA })

    expect(service.revokeAgentAccess({ ownerKey: threadA })).toBe(1)

    const reopened = service.session(window, { ownerKey: threadA, action: 'open' })
    expect(reopened.agentAccess).toBe(false)
    expect(reopened.allowExternal).toBe(true)
    expect(service.setAccess(window, { ownerKey: threadA, tabId: tabA, agentAccess: true, allowExternal: true })).toEqual({ agentAccess: false })
    expect(service.hasAgentAccess(window, threadA)).toBe(false)
  })

  it('persists allowExternal, autoVerify, zoom, and device even before any URL mounts, while still refusing ungranted agentAccess (T43)', async () => {
    const service = new BrowserPreviewService()
    const threadPre = 'thread:chat-pre'
    const tabId = service.session(window, { ownerKey: threadPre, action: 'open' }).activeTabId

    // No tab mounted yet: settings save, but agentAccess cannot be raised without grant:true.
    expect(service.setAccess(window, { ownerKey: threadPre, tabId, agentAccess: true, allowExternal: true, autoVerify: false })).toEqual({ agentAccess: false })
    service.setZoom(window, { ownerKey: threadPre, tabId, zoom: 130 })
    await service.setDevice(window, { ownerKey: threadPre, tabId, deviceId: 'iphone-15', rotated: false })

    const reopened = service.session(window, { ownerKey: threadPre, action: 'open' })
    expect(reopened.agentAccess).toBe(false)
    expect(reopened.allowExternal).toBe(true)
    expect(reopened.autoVerify).toBe(false)
    expect(reopened.zoom).toBe(130)
    expect(reopened.deviceId).toBe('iphone-15')
    expect(reopened.rotated).toBe(false)
  })
})
