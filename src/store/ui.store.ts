import { create } from 'zustand'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  isSettingsOpen: boolean
  isCommandPaletteOpen: boolean
  isWorkspaceSettingsOpen: boolean
  slashOverlayPaneId: string | null
  isHistoryPanelOpen: boolean
  isMcpPanelOpen: boolean
  isSkillsBrowserOpen: boolean
  isScriptsPanelOpen: boolean
  isOxePanelOpen: boolean
  isWebPreviewOpen: boolean
  /** Workspace + URL pushed by `oxespace_open_web_preview`. The WebPreview
   *  panel watches this and loads the URL when it mounts (covers the case
   *  where the panel was closed when the agent called the tool). Cleared
   *  by the panel after consuming. */
  pendingWebPreview: { workspaceId: string; url: string } | null
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
  openHistoryPanel: () => void
  closeHistoryPanel: () => void
  openMcpPanel: () => void
  closeMcpPanel: () => void
  openSkillsBrowser: () => void
  closeSkillsBrowser: () => void
  openScriptsPanel: () => void
  closeScriptsPanel: () => void
  openOxePanel: () => void
  closeOxePanel: () => void
  openWebPreview: () => void
  closeWebPreview: () => void
  setPendingWebPreview: (value: { workspaceId: string; url: string } | null) => void
  openIntegrationPanel: () => void
  closeIntegrationPanel: () => void
  toggleSettings: () => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>((set) => ({
  isNewWorkspaceOpen: false,
  maximizedPaneId: null,
  isSidebarCollapsed: false,
  isSettingsOpen: false,
  isCommandPaletteOpen: false,
  isWorkspaceSettingsOpen: false,
  slashOverlayPaneId: null,
  isHistoryPanelOpen: false,
  isMcpPanelOpen: false,
  isSkillsBrowserOpen: false,
  isScriptsPanelOpen: false,
  isOxePanelOpen: false,
  isWebPreviewOpen: false,
  pendingWebPreview: null,
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
  openHistoryPanel: () => set({ isHistoryPanelOpen: true }),
  closeHistoryPanel: () => set({ isHistoryPanelOpen: false }),
  openMcpPanel: () => set({ isMcpPanelOpen: true }),
  closeMcpPanel: () => set({ isMcpPanelOpen: false }),
  openSkillsBrowser: () => set({ isSkillsBrowserOpen: true }),
  closeSkillsBrowser: () => set({ isSkillsBrowserOpen: false }),
  openScriptsPanel: () => set({ isScriptsPanelOpen: true }),
  closeScriptsPanel: () => set({ isScriptsPanelOpen: false }),
  openOxePanel: () => set({ isOxePanelOpen: true }),
  closeOxePanel: () => set({ isOxePanelOpen: false }),
  openWebPreview: () => set({ isWebPreviewOpen: true }),
  closeWebPreview: () => set({ isWebPreviewOpen: false }),
  setPendingWebPreview: (value) => set({ pendingWebPreview: value }),
  openIntegrationPanel: () => set({ isIntegrationPanelOpen: true }),
  closeIntegrationPanel: () => set({ isIntegrationPanelOpen: false }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed }))
}))
