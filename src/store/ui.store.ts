import { create } from 'zustand'

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

/** The application Settings pages, in SettingsCenter order. */
export type SettingsPageId = 'general' | 'appearance' | 'providers' | 'policy' | 'agent-permissions' | 'notifications' | 'keyboard' | 'terminal' | 'mcp' | 'devices' | 'privacy' | 'activity' | 'diagnostics' | 'about'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  collapsedSidebars: Record<SidebarMode, boolean>
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
  isScriptsPanelOpen: boolean
  isSearchPanelOpen: boolean
  isHttpCallsPanelOpen: boolean
  isAndroidPanelOpen: boolean
  isUsageOpen: boolean
  /** F2 experimental: render the recursive split-tree layout instead of the grid. */
  splitLayoutEnabled: boolean
  /** Web Preview is workspace-owned. Keeping this keyed prevents opening or
   *  closing the panel in one workspace from affecting every other surface. */
  webPreviewOpenByWorkspace: Record<string, boolean>
  /** URLs pushed by `oxespace_open_web_preview`, retained until the matching
   *  workspace panel mounts and consumes its own entry. */
  pendingWebPreviewByWorkspace: Record<string, string>
  /** Workspaces whose side panels are pinned to the workspace root instead of
   *  following the active pane into its worktree. Deliberately not persisted:
   *  following the pane is the safe default, so every session starts there. */
  panelScopePinnedByWorkspace: Record<string, boolean>
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
  openScriptsPanel: () => void
  closeScriptsPanel: () => void
  openSearchPanel: () => void
  closeSearchPanel: () => void
  toggleHttpCallsPanel: () => void
  closeHttpCallsPanel: () => void
  toggleAndroidPanel: () => void
  closeAndroidPanel: () => void
  openUsage: () => void
  closeUsage: () => void
  toggleSplitLayout: () => void
  openWebPreview: (workspaceId: string) => void
  closeWebPreview: (workspaceId: string) => void
  setPendingWebPreview: (workspaceId: string, url: string | null) => void
  togglePanelScopePin: (workspaceId: string) => void
  openIntegrationPanel: () => void
  closeIntegrationPanel: () => void
  toggleSettings: () => void
  toggleSidebar: (mode?: SidebarMode) => void
}

export const useUIStore = create<UIState>((set) => ({
  isNewWorkspaceOpen: false,
  maximizedPaneId: null,
  isSidebarCollapsed: initialCollapsedSidebars.code,
  collapsedSidebars: initialCollapsedSidebars,
  isSettingsOpen: false,
  settingsInitialPage: undefined,
  openAgentSettings: () => set({ isSettingsOpen: true, isWorkspaceSettingsOpen: false, settingsInitialPage: 'providers' }),
  openSettingsPage: (page) => set({ isSettingsOpen: true, isWorkspaceSettingsOpen: false, settingsInitialPage: page }),
  isCommandPaletteOpen: false,
  isCommandMenuOpen: false,
  isWorkspaceSettingsOpen: false,
  slashOverlayPaneId: null,
  isMcpPanelOpen: false,
  isScriptsPanelOpen: false,
  isSearchPanelOpen: false,
  isHttpCallsPanelOpen: false,
  isAndroidPanelOpen: false,
  isUsageOpen: false,
  splitLayoutEnabled: true,
  webPreviewOpenByWorkspace: {},
  pendingWebPreviewByWorkspace: {},
  panelScopePinnedByWorkspace: {},
  isIntegrationPanelOpen: false,
  activePaneId: null,
  openNewWorkspace: () => set({ isNewWorkspaceOpen: true }),
  closeNewWorkspace: () => set({ isNewWorkspaceOpen: false }),
  setMaximizedPane: (paneId) => set({ maximizedPaneId: paneId }),
  setActivePane: (paneId) => set({ activePaneId: paneId }),
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  openCommandMenu: () => set({ isCommandMenuOpen: true }),
  closeCommandMenu: () => set({ isCommandMenuOpen: false }),
  openWorkspaceSettings: () => set({ isWorkspaceSettingsOpen: true }),
  closeWorkspaceSettings: () => set({ isWorkspaceSettingsOpen: false }),
  openSlashOverlay: (paneId) => set({ slashOverlayPaneId: paneId }),
  closeSlashOverlay: () => set({ slashOverlayPaneId: null }),
  openMcpPanel: () => set({ isMcpPanelOpen: true }),
  closeMcpPanel: () => set({ isMcpPanelOpen: false }),
  openScriptsPanel: () => set({ isScriptsPanelOpen: true }),
  closeScriptsPanel: () => set({ isScriptsPanelOpen: false }),
  openSearchPanel: () => set({ isSearchPanelOpen: true }),
  closeSearchPanel: () => set({ isSearchPanelOpen: false }),
  toggleHttpCallsPanel: () => set((s) => ({ isHttpCallsPanelOpen: !s.isHttpCallsPanelOpen })),
  closeHttpCallsPanel: () => set({ isHttpCallsPanelOpen: false }),
  toggleAndroidPanel: () => set((s) => ({ isAndroidPanelOpen: !s.isAndroidPanelOpen })),
  closeAndroidPanel: () => set({ isAndroidPanelOpen: false }),
  openUsage: () => set({ isUsageOpen: true }),
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
  togglePanelScopePin: (workspaceId) => set((state) => {
    const next = { ...state.panelScopePinnedByWorkspace }
    if (next[workspaceId]) delete next[workspaceId]
    else next[workspaceId] = true
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
  })
}))
