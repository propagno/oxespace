import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { createOxeApi } from '../../../electron/preload/api'

// OXE-325 ([OXE-132 · CA-3a]): Capture the active Web Preview (WebContentsView.capturePage())
// as a persisted PNG + JSON metadata session artifact linked to the active thread/session.

let userDataDir = ''
let mockImageEmpty = false
let mockPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])
let mockPageUrl = 'http://localhost:5173/dashboard'
let mockPageTitle = 'OXESpace Preview App'
const capturePageSpy = vi.fn(async () => ({
  isEmpty: () => mockImageEmpty,
  toPNG: () => mockPngBytes,
  getSize: () => ({ width: 1280, height: 720 }),
  toDataURL: () => `data:image/png;base64,${mockPngBytes.toString('base64')}`
}))

const win = {
  id: 42,
  once: () => undefined,
  isDestroyed: () => false,
  getContentBounds: () => ({ x: 0, y: 0, width: 1400, height: 900 }),
  contentView: { addChildView: () => undefined, removeChildView: () => undefined },
  webContents: { send: () => undefined }
}

vi.mock('electron', () => {
  class WebContentsView {
    private currentBounds = { x: 0, y: 0, width: 0, height: 0 }
    webContents = {
      on: () => undefined,
      once: () => undefined,
      isDestroyed: () => false,
      getURL: () => mockPageUrl,
      getTitle: () => mockPageTitle,
      isLoading: () => false,
      canGoBack: () => false,
      canGoForward: () => false,
      loadURL: async () => undefined,
      close: () => undefined,
      setZoomFactor: () => undefined,
      capturePage: capturePageSpy,
      id: Math.floor(Math.random() * 1e6)
    }
    setBackgroundColor(): void {}
    setVisible(): void {}
    setBounds(rect: { x: number; y: number; width: number; height: number }): void {
      this.currentBounds = rect
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.currentBounds
    }
  }
  return {
    app: {
      getAppPath: () => '/app',
      getPath: (name: string) => (name === 'userData' ? userDataDir : '/tmp'),
      isPackaged: false
    },
    BrowserWindow: { getAllWindows: () => [win], fromWebContents: () => win },
    WebContentsView,
    clipboard: {},
    ClipboardItem: class {}
  }
})
vi.mock('../../../electron/main/services/browser-preview-security', () => ({
  guestProbeWebPreferences: () => ({}),
  previewSessionFor: () => ({}),
  securePreviewGuest: () => undefined
}))
vi.mock('../../../electron/main/ipc/ipc-sender-guard', () => ({ trustPreviewGuest: () => undefined }))
vi.mock('../../../electron/main/i18n', () => ({ tMain: (key: string) => key }))
vi.mock('../../../electron/main/services/approvals', () => ({ approvalCenter: { ask: vi.fn() } }))

const { BrowserPreviewService } = await import('../../../electron/main/services/browser-preview.service')

const browserWindow = win as never

describe('OXE-325 · Web Preview session artifact capture', () => {
  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'oxe-325-'))
    mockImageEmpty = false
    mockPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03])
    mockPageUrl = 'http://localhost:5173/dashboard'
    mockPageTitle = 'OXESpace Preview App'
    capturePageSpy.mockClear()
  })

  afterEach(async () => {
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  })

  it('captures the active WebContentsView and persists PNG + JSON metadata linked to the thread session', async () => {
    const service = new BrowserPreviewService()
    const threadId = 'thread-oxe-325'
    const ownerKey = `thread:${threadId}`
    const session = service.session(browserWindow, { ownerKey, action: 'open' })
    await service.mount(browserWindow, {
      ownerKey,
      workspaceId: 'ws-1',
      threadId,
      tabId: session.activeTabId,
      url: mockPageUrl,
      allowExternal: false,
      agentAccess: false
    })
    service.bounds(browserWindow, {
      ownerKey,
      tabId: session.activeTabId,
      x: 10,
      y: 20,
      width: 1024,
      height: 640,
      visible: true
    })

    const before = Date.now()
    const artifact = await service.captureSessionArtifact(browserWindow, { ownerKey, tabId: session.activeTabId })
    const after = Date.now()

    expect(capturePageSpy).toHaveBeenCalledTimes(1)
    expect(artifact.id).toMatch(/^artifact-[a-z0-9]+-[a-f0-9]{8}$/)
    expect(artifact.sessionId).toBe(session.sessionId)
    expect(artifact.ownerKey).toBe(ownerKey)
    expect(artifact.workspaceId).toBe('ws-1')
    expect(artifact.threadId).toBe(threadId)
    expect(artifact.url).toBe(mockPageUrl)
    expect(artifact.title).toBe(mockPageTitle)
    expect(artifact.viewport).toEqual({ width: 1024, height: 640 })
    expect(artifact.capturedAt).toBeGreaterThanOrEqual(before)
    expect(artifact.capturedAt).toBeLessThanOrEqual(after)
    expect(artifact.bytes).toBe(mockPngBytes.length)
    expect(artifact.fileName).toBe(`${artifact.id}.png`)
    expect(artifact.path).toBe(join(userDataDir, 'web-preview-captures', threadId, `${artifact.id}.png`))
    expect(artifact.metadataPath).toBe(join(userDataDir, 'web-preview-captures', threadId, `${artifact.id}.json`))

    const savedPng = await readFile(artifact.path)
    expect(savedPng.equals(mockPngBytes)).toBe(true)

    const savedMeta = JSON.parse(await readFile(artifact.metadataPath, 'utf8')) as Record<string, unknown>
    expect(savedMeta).toMatchObject({
      id: artifact.id,
      sessionId: session.sessionId,
      ownerKey,
      workspaceId: 'ws-1',
      threadId,
      fileName: artifact.fileName,
      url: mockPageUrl,
      title: mockPageTitle,
      viewport: { width: 1024, height: 640 },
      capturedAt: artifact.capturedAt,
      bytes: mockPngBytes.length
    })
  })

  it('persists workspace-scoped artifacts under workspaceId when no threadId is set', async () => {
    const service = new BrowserPreviewService()
    const ownerKey = 'ws-solo'
    const session = service.session(browserWindow, { ownerKey, action: 'open' })
    await service.mount(browserWindow, {
      ownerKey,
      workspaceId: ownerKey,
      tabId: session.activeTabId,
      url: mockPageUrl,
      allowExternal: false,
      agentAccess: false
    })
    service.bounds(browserWindow, {
      ownerKey,
      tabId: session.activeTabId,
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      visible: true
    })

    const artifact = await service.captureSessionArtifact(browserWindow, { ownerKey, tabId: session.activeTabId })
    expect(artifact.threadId).toBeUndefined()
    expect(artifact.workspaceId).toBe(ownerKey)
    expect(artifact.path).toBe(join(userDataDir, 'web-preview-captures', ownerKey, `${artifact.id}.png`))
  })

  it('rejects cleanly when no preview tab is active or mounted', async () => {
    const service = new BrowserPreviewService()
    await expect(
      service.captureSessionArtifact(browserWindow, { ownerKey: 'ws-missing', tabId: '00000000-0000-0000-0000-000000000000' })
    ).rejects.toThrow('Browser tab is no longer open')
    expect(capturePageSpy).not.toHaveBeenCalled()
  })

  it('rejects cleanly when the preview tab is hidden (not visible)', async () => {
    const service = new BrowserPreviewService()
    const ownerKey = 'ws-hidden'
    const session = service.session(browserWindow, { ownerKey, action: 'open' })
    await service.mount(browserWindow, {
      ownerKey,
      workspaceId: ownerKey,
      tabId: session.activeTabId,
      url: mockPageUrl,
      allowExternal: false,
      agentAccess: false
    })
    // Mounted tabs start with visible=false until bounds(..., visible: true) is called.
    await expect(
      service.captureSessionArtifact(browserWindow, { ownerKey, tabId: session.activeTabId })
    ).rejects.toThrow('Open a visible browser tab before capturing it')
    expect(capturePageSpy).not.toHaveBeenCalled()
  })

  it('rejects cleanly when capturePage returns an empty image', async () => {
    mockImageEmpty = true
    const service = new BrowserPreviewService()
    const ownerKey = 'ws-empty'
    const session = service.session(browserWindow, { ownerKey, action: 'open' })
    await service.mount(browserWindow, {
      ownerKey,
      workspaceId: ownerKey,
      tabId: session.activeTabId,
      url: mockPageUrl,
      allowExternal: false,
      agentAccess: false
    })
    service.bounds(browserWindow, {
      ownerKey,
      tabId: session.activeTabId,
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      visible: true
    })

    await expect(
      service.captureSessionArtifact(browserWindow, { ownerKey, tabId: session.activeTabId })
    ).rejects.toThrow('Preview capture returned an empty image')
  })

  it('registers the IPC channel, preload API, and MCP coverage entry', async () => {
    expect(IPC_CHANNELS.browserPreview.captureSessionArtifact).toBe('browser-preview:capture-session-artifact')
    expect(MCP_COVERAGE['web_preview.use']?.ipc).toContain('browserPreview.captureSessionArtifact')

    const invoke = vi.fn(async () => ({ id: 'artifact-1' }))
    const api = createOxeApi({ invoke, on: vi.fn(), removeListener: vi.fn() })
    await api.browserPreview.captureSessionArtifact({ ownerKey: 'thread:t1', tabId: 'tab-1' })
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.browserPreview.captureSessionArtifact, {
      ownerKey: 'thread:t1',
      tabId: 'tab-1'
    })
  })
})
