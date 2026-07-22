import { create } from 'zustand'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  isSettingsOpen: boolean
  /** Tools hub modal (sidebar gear) — distinct from agent Settings. */
  isToolsOpen: boolean
  isCommandPaletteOpen: boolean
  isWorkspaceSettingsOpen: boolean
  slashOverlayPaneId: string | null
  isMcpPanelOpen: boolean
  isSkillsBrowserOpen: boolean
  isScriptsPanelOpen: boolean
  isSearchPanelOpen: boolean
  /** Web Preview is workspace-owned. Keeping this keyed prevents opening or
   *  closing the panel in one workspace from affecting every other surface. */
  webPreviewOpenByWorkspace: Record<string, boolean>
  /** URLs pushed by `oxespace_open_web_preview`, retained until the matching
   *  workspace panel mounts and consumes its own entry. */
  pendingWebPreviewByWorkspace: Record<string, string>
  isIntegrationPanelOpen: boolean
  activePaneId: string | null
  openNewWorkspace: () => void
  closeNewWorkspace: () => void
  setMaximizedPane: (paneId: string | null) => void
  setActivePane: (paneId: string | null) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openWorkspaceSettings: () => void
  closeWorkspaceSettings: () => void
  openSlashOverlay: (paneId: string) => void
  closeSlashOverlay: () => void
  openMcpPanel: () => void
  closeMcpPanel: () => void
  openSkillsBrowser: () => void
  closeSkillsBrowser: () => void
  openScriptsPanel: () => void
  closeScriptsPanel: () => void
  openSearchPanel: () => void
  closeSearchPanel: () => void
  openWebPreview: (workspaceId: string) => void
  closeWebPreview: (workspaceId: string) => void
  setPendingWebPreview: (workspaceId: string, url: string | null) => void
  openIntegrationPanel: () => void
  closeIntegrationPanel: () => void
  openTools: () => void
  closeTools: () => void
  toggleSettings: () => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>((set) => ({
  isNewWorkspaceOpen: false,
  maximizedPaneId: null,
  isSidebarCollapsed: false,
  isSettingsOpen: false,
  isToolsOpen: false,
  isCommandPaletteOpen: false,
  isWorkspaceSettingsOpen: false,
  slashOverlayPaneId: null,
  isMcpPanelOpen: false,
  isSkillsBrowserOpen: false,
  isScriptsPanelOpen: false,
  isSearchPanelOpen: false,
  webPreviewOpenByWorkspace: {},
  pendingWebPreviewByWorkspace: {},
  isIntegrationPanelOpen: false,
  activePaneId: null,
  openNewWorkspace: () => set({ isNewWorkspaceOpen: true }),
  closeNewWorkspace: () => set({ isNewWorkspaceOpen: false }),
  setMaximizedPane: (paneId) => set({ maximizedPaneId: paneId }),
  setActivePane: (paneId) => set({ activePaneId: paneId }),
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
  openWorkspaceSettings: () => set({ isWorkspaceSettingsOpen: true }),
  closeWorkspaceSettings: () => set({ isWorkspaceSettingsOpen: false }),
  openSlashOverlay: (paneId) => set({ slashOverlayPaneId: paneId }),
  closeSlashOverlay: () => set({ slashOverlayPaneId: null }),
  openMcpPanel: () => set({ isMcpPanelOpen: true }),
  closeMcpPanel: () => set({ isMcpPanelOpen: false }),
  openSkillsBrowser: () => set({ isSkillsBrowserOpen: true }),
  closeSkillsBrowser: () => set({ isSkillsBrowserOpen: false }),
  openScriptsPanel: () => set({ isScriptsPanelOpen: true }),
  closeScriptsPanel: () => set({ isScriptsPanelOpen: false }),
  openSearchPanel: () => set({ isSearchPanelOpen: true }),
  closeSearchPanel: () => set({ isSearchPanelOpen: false }),
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
  openIntegrationPanel: () => set({ isIntegrationPanelOpen: true }),
  closeIntegrationPanel: () => set({ isIntegrationPanelOpen: false }),
  openTools: () => set({ isToolsOpen: true }),
  closeTools: () => set({ isToolsOpen: false }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed }))
}))
