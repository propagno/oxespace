import { create } from 'zustand'
import { holdFocusForPalette } from '../lib/paletteFocus'

export type SidebarMode = 'code' | 'thread'

function restoredCollapsedSidebars(): Record<SidebarMode, boolean> {
  try {
    const savedCode = localStorage.getItem('oxe.sidebar.collapsed.code')
    const savedThread = localStorage.getItem('oxe.sidebar.collapsed.thread')
    if (savedCode !== null || savedThread !== null) {
      return { code: savedCode === 'true', thread: savedThread === 'true' }
    }
    const saved = localStorage.getItem('oxe.sidebar.collapsed')
    const legacy = saved !== null
      ? saved === 'true'
      : JSON.parse(localStorage.getItem('oxe.thread-navigation') ?? 'null')?.state?.collapsed === true
    if (saved === null) localStorage.setItem('oxe.sidebar.collapsed', String(legacy))
    localStorage.setItem('oxe.sidebar.collapsed.code', String(legacy))
    localStorage.setItem('oxe.sidebar.collapsed.thread', String(legacy))
    return { code: legacy, thread: legacy }
  } catch { return { code: false, thread: false } }
}

const initialCollapsedSidebars = restoredCollapsedSidebars()

function restoredOxeQuerySidebarCollapsed(): boolean {
  try {
    return localStorage.getItem('oxe.sidebar.collapsed.data') === 'true'
  } catch { return false }
}

const initialOxeQuerySidebarCollapsed = restoredOxeQuerySidebarCollapsed()

/** localStorage key of the pinned panel scopes: JSON { [workspaceId]: path }. */
const PANEL_SCOPE_PINS_KEY = 'oxe.panel-scope-pins'

/** A pinned scope: the path the panels stay on, or the legacy `true` (the workspace root). */
export type PanelScopePin = string | true

/**
 * Reads the saved pins. A legacy `true` stays `true` (read as the workspace
 * root); `false`, empty or any other value means following the active pane and
 * is dropped. A broken value is ignored.
 */
function restoredPanelScopePins(): Record<string, PanelScopePin> {
  try {
    const raw = localStorage.getItem(PANEL_SCOPE_PINS_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const pins: Record<string, PanelScopePin> = {}
    for (const [workspaceId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === true) pins[workspaceId] = true
      else if (typeof value === 'string' && value.length > 0) pins[workspaceId] = value
    }
    return pins
  } catch { return {} }
}

function savePanelScopePins(pins: Record<string, PanelScopePin>): void {
  try {
    if (Object.keys(pins).length === 0) localStorage.removeItem(PANEL_SCOPE_PINS_KEY)
    else localStorage.setItem(PANEL_SCOPE_PINS_KEY, JSON.stringify(pins))
  } catch { /* optional preference */ }
}

/** The application Settings pages, in SettingsCenter order. */
export type SettingsPageId = 'general' | 'appearance' | 'providers' | 'policy' | 'agent-permissions' | 'notifications' | 'keyboard' | 'terminal' | 'mcp' | 'devices' | 'privacy' | 'activity' | 'diagnostics' | 'about'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  collapsedSidebars: Record<SidebarMode, boolean>
  oxequerySidebarCollapsed: boolean
  isSettingsOpen: boolean
  settingsInitialPage: SettingsPageId | undefined
  /** Opens application Settings on one page. */
  openSettingsPage: (page: SettingsPageId) => void
  openAgentSettings: () => void
  /** Tools hub modal (sidebar gear) — distinct from agent Settings. */
  isCommandPaletteOpen: boolean
  isCommandMenuOpen: boolean
  isWorkspaceSettingsOpen: boolean
  slashOverlayPaneId: string | null
  isMcpPanelOpen: boolean
  isSearchPanelOpen: boolean
  isHttpCallsPanelOpen: boolean
  isAndroidPanelOpen: boolean
  isUsageOpen: boolean
  /** The Schedules dialog (requests sent to an agent at a set time), opened from OxeChat's list. */
  isSchedulesOpen: boolean
  /** F2 experimental: render the recursive split-tree layout instead of the grid. */
  splitLayoutEnabled: boolean
  /** Web Preview is workspace-owned. Keeping this keyed prevents opening or
   *  closing the panel in one workspace from affecting every other surface. */
  webPreviewOpenByWorkspace: Record<string, boolean>
  /** URLs pushed by `oxespace_open_web_preview`, retained until the matching
   *  workspace panel mounts and consumes its own entry. */
  pendingWebPreviewByWorkspace: Record<string, string>
  /** Workspaces whose side panels stay on a pinned path instead of following
   *  the active pane. The value is the pinned path (a legacy `true` reads as the
   *  workspace root); absent means following the active pane. Persisted in
   *  localStorage under "oxe.panel-scope-pins" (OXE-183). */
  panelScopePinnedByWorkspace: Record<string, PanelScopePin>
  isIntegrationPanelOpen: boolean
  activePaneId: string | null
  openNewWorkspace: () => void
  closeNewWorkspace: () => void
  setMaximizedPane: (paneId: string | null) => void
  setActivePane: (paneId: string | null) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openCommandMenu: () => void
  closeCommandMenu: () => void
  openWorkspaceSettings: () => void
  closeWorkspaceSettings: () => void
  openSlashOverlay: (paneId: string) => void
  closeSlashOverlay: () => void
  openMcpPanel: () => void
  closeMcpPanel: () => void
  openSearchPanel: () => void
  closeSearchPanel: () => void
  toggleHttpCallsPanel: () => void
  closeHttpCallsPanel: () => void
  toggleAndroidPanel: () => void
  /** Opens the Android device panel and keeps it open (an agent asked for the device). */
  openAndroidPanel: () => void
  closeAndroidPanel: () => void
  openUsage: () => void
  openSchedules: () => void
  closeSchedules: () => void
  closeUsage: () => void
  toggleSplitLayout: () => void
  openWebPreview: (workspaceId: string) => void
  closeWebPreview: (workspaceId: string) => void
  setPendingWebPreview: (workspaceId: string, url: string | null) => void
  /** Pins the panels of a workspace to `rootPath`, or unpins them when already pinned. */
  togglePanelScopePin: (workspaceId: string, rootPath: string) => void
  openIntegrationPanel: () => void
  closeIntegrationPanel: () => void
  toggleSettings: () => void
  toggleSidebar: (mode?: SidebarMode) => void
  toggleOxeQuerySidebar: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  isNewWorkspaceOpen: false,
  maximizedPaneId: null,
  isSidebarCollapsed: initialCollapsedSidebars.code,
  collapsedSidebars: initialCollapsedSidebars,
  oxequerySidebarCollapsed: initialOxeQuerySidebarCollapsed,
  isSettingsOpen: false,
  settingsInitialPage: undefined,
  openAgentSettings: () => set({ isSettingsOpen: true, isWorkspaceSettingsOpen: false, settingsInitialPage: 'providers' }),
  openSettingsPage: (page) => set({ isSettingsOpen: true, isWorkspaceSettingsOpen: false, settingsInitialPage: page }),
  isCommandPaletteOpen: false,
  isCommandMenuOpen: false,
  isWorkspaceSettingsOpen: false,
  slashOverlayPaneId: null,
  isMcpPanelOpen: false,
  isSearchPanelOpen: false,
  isHttpCallsPanelOpen: false,
  isAndroidPanelOpen: false,
  isUsageOpen: false,
  isSchedulesOpen: false,
  splitLayoutEnabled: true,
  webPreviewOpenByWorkspace: {},
  pendingWebPreviewByWorkspace: {},
  panelScopePinnedByWorkspace: restoredPanelScopePins(),
  isIntegrationPanelOpen: false,
  activePaneId: null,
  openNewWorkspace: () => set({ isNewWorkspaceOpen: true }),
  closeNewWorkspace: () => set({ isNewWorkspaceOpen: false }),
  setMaximizedPane: (paneId) => set({ maximizedPaneId: paneId }),
  setActivePane: (paneId) => set({ activePaneId: paneId }),
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  // OXE-397: keys typed before the palette mounts reach nothing, not the terminal that had focus.
  openCommandMenu: () => { if (!get().isCommandMenuOpen) holdFocusForPalette(); set({ isCommandMenuOpen: true }) },
  closeCommandMenu: () => set({ isCommandMenuOpen: false }),
  openWorkspaceSettings: () => set({ isWorkspaceSettingsOpen: true }),
  closeWorkspaceSettings: () => set({ isWorkspaceSettingsOpen: false }),
  openSlashOverlay: (paneId) => set({ slashOverlayPaneId: paneId }),
  closeSlashOverlay: () => set({ slashOverlayPaneId: null }),
  openMcpPanel: () => set({ isMcpPanelOpen: true }),
  closeMcpPanel: () => set({ isMcpPanelOpen: false }),
  openSearchPanel: () => set({ isSearchPanelOpen: true }),
  closeSearchPanel: () => set({ isSearchPanelOpen: false }),
  toggleHttpCallsPanel: () => set((s) => ({ isHttpCallsPanelOpen: !s.isHttpCallsPanelOpen })),
  closeHttpCallsPanel: () => set({ isHttpCallsPanelOpen: false }),
  toggleAndroidPanel: () => set((s) => ({ isAndroidPanelOpen: !s.isAndroidPanelOpen })),
  openAndroidPanel: () => set({ isAndroidPanelOpen: true }),
  closeAndroidPanel: () => set({ isAndroidPanelOpen: false }),
  openUsage: () => set({ isUsageOpen: true }),
  openSchedules: () => set({ isSchedulesOpen: true }),
  closeSchedules: () => set({ isSchedulesOpen: false }),
  closeUsage: () => set({ isUsageOpen: false }),
  toggleSplitLayout: () => set((s) => ({ splitLayoutEnabled: !s.splitLayoutEnabled })),
  openWebPreview: (workspaceId) => set((state) => ({
    webPreviewOpenByWorkspace: { ...state.webPreviewOpenByWorkspace, [workspaceId]: true }
  })),
  closeWebPreview: (workspaceId) => set((state) => {
    const next = { ...state.webPreviewOpenByWorkspace }
    delete next[workspaceId]
    return { webPreviewOpenByWorkspace: next }
  }),
  setPendingWebPreview: (workspaceId, url) => set((state) => {
    const next = { ...state.pendingWebPreviewByWorkspace }
    if (url === null) delete next[workspaceId]
    else next[workspaceId] = url
    return { pendingWebPreviewByWorkspace: next }
  }),
  togglePanelScopePin: (workspaceId, rootPath) => set((state) => {
    const next = { ...state.panelScopePinnedByWorkspace }
    if (next[workspaceId] !== undefined) delete next[workspaceId]
    else next[workspaceId] = rootPath
    savePanelScopePins(next)
    return { panelScopePinnedByWorkspace: next }
  }),
  openIntegrationPanel: () => set({ isIntegrationPanelOpen: true }),
  closeIntegrationPanel: () => set({ isIntegrationPanelOpen: false }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen, isWorkspaceSettingsOpen: false, settingsInitialPage: undefined })),
  toggleSidebar: (mode) => set((s) => {
    const target: SidebarMode = mode === 'thread' ? 'thread' : 'code'
    const collapsedSidebars: Record<SidebarMode, boolean> = {
      ...s.collapsedSidebars,
      [target]: !s.collapsedSidebars[target]
    }
    const isSidebarCollapsed = collapsedSidebars.code
    try {
      localStorage.setItem('oxe.sidebar.collapsed.code', String(collapsedSidebars.code))
      localStorage.setItem('oxe.sidebar.collapsed.thread', String(collapsedSidebars.thread))
      localStorage.setItem('oxe.sidebar.collapsed', String(isSidebarCollapsed))
    } catch { /* optional preference */ }
    return { collapsedSidebars, isSidebarCollapsed }
  }),
  toggleOxeQuerySidebar: () => set((s) => {
    const oxequerySidebarCollapsed = !s.oxequerySidebarCollapsed
    try {
      localStorage.setItem('oxe.sidebar.collapsed.data', String(oxequerySidebarCollapsed))
    } catch { /* optional preference */ }
    return { oxequerySidebarCollapsed }
  })
}))
