import { describe, expect, it, vi } from 'vitest'

// Only the access rules are under test: Electron's views are faked as plain objects in the service's maps.
vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, clipboard: {}, ClipboardItem: class {}, ipcMain: { handle: vi.fn(), on: vi.fn() }, WebContentsView: class {} }))
vi.mock('../../electron/main/services/browser-preview-security', () => ({ guestProbeWebPreferences: vi.fn(), previewSessionFor: vi.fn(), securePreviewGuest: vi.fn() }))
vi.mock('../../electron/main/ipc/ipc-sender-guard', () => ({ trustPreviewGuest: vi.fn() }))

const { BrowserPreviewService } = await import('../../electron/main/services/browser-preview.service')

type FakeTab = { tabId: string; visible: boolean; agentAccess: boolean; destroyed?: boolean }
const window = { id: 1 }
function service(tabs: FakeTab[], activeTabId = tabs[0]?.tabId) {
  const s = new BrowserPreviewService()
  const inner = s as unknown as { tabs: Map<string, unknown>; tabSessions: Map<string, { activeTabId?: string }> }
  for (const tab of tabs) inner.tabs.set(`1:ws:${tab.tabId}`, { window, ownerKey: 'ws', workspaceId: 'ws', tabId: tab.tabId, allowExternal: false, agentAccess: tab.agentAccess, visible: tab.visible, lease: 'l',
    view: { webContents: { isDestroyed: () => tab.destroyed === true, id: tab.tabId } } })
  inner.tabSessions.set('1:ws', { activeTabId })
  return { s, tab: (id: string) => inner.tabs.get(`1:ws:${id}`) as { agentAccess: boolean; visible: boolean } }
}

describe('a covered preview with access waits, nothing else does (#243)', () => {
  it('a visible tab with access is the active one; covered only while it is hidden', () => {
    const { s, tab } = service([{ tabId: 'a', visible: true, agentAccess: true }])
    expect(s.activeFor('ws')?.tabId).toBe('a')
    expect(s.coveredWithAccess('ws')).toBe(false)
    tab('a').visible = false
    expect(s.activeFor('ws')).toBeNull()
    expect(s.coveredWithAccess('ws')).toBe(true)
  })

  it('access off, no tab or a destroyed tab is never covered, so an action refuses at once', () => {
    expect(service([{ tabId: 'a', visible: false, agentAccess: false }]).s.coveredWithAccess('ws')).toBe(false)
    expect(service([]).s.coveredWithAccess('ws')).toBe(false)
    expect(service([{ tabId: 'a', visible: false, agentAccess: true, destroyed: true }]).s.coveredWithAccess('ws')).toBe(false)
  })

  it('access turned off while covered ends the wait', () => {
    const { s, tab } = service([{ tabId: 'a', visible: false, agentAccess: true }])
    expect(s.coveredWithAccess('ws')).toBe(true)
    tab('a').agentAccess = false
    expect(s.coveredWithAccess('ws')).toBe(false)
  })

  it('a background tab with access does not count as covered (security review L2)', () => {
    const { s } = service([{ tabId: 'a', visible: true, agentAccess: false }, { tabId: 'b', visible: false, agentAccess: true }], 'a')
    expect(s.coveredWithAccess('ws')).toBe(false)
  })

  it('another owner or workspace never sees this preview', () => {
    const { s } = service([{ tabId: 'a', visible: false, agentAccess: true }])
    expect(s.coveredWithAccess('other')).toBe(false)
    expect(s.coveredWithAccess('ws', { kind: 'thread', id: 't1' })).toBe(false)
  })
})
