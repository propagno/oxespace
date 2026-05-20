import { create } from 'zustand'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  isSettingsOpen: boolean
  isCommandPaletteOpen: boolean
  isWorkspaceSettingsOpen: boolean
  slashOverlayPaneId: string | null
  contextUsagePaneId: string | null
  worktreeMenuPaneId: string | null
  isHistoryPanelOpen: boolean
  isMcpPanelOpen: boolean
  isSkillsBrowserOpen: boolean
  isScriptsPanelOpen: boolean
  isWebPreviewOpen: boolean
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
  openContextUsage: (paneId: string) => void
  closeContextUsage: () => void
  openWorktreeMenu: (paneId: string) => void
  closeWorktreeMenu: () => void
  openHistoryPanel: () => void
  closeHistoryPanel: () => void
  openMcpPanel: () => void
  closeMcpPanel: () => void
  openSkillsBrowser: () => void
  closeSkillsBrowser: () => void
  openScriptsPanel: () => void
  closeScriptsPanel: () => void
  openWebPreview: () => void
  closeWebPreview: () => void
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
  contextUsagePaneId: null,
  worktreeMenuPaneId: null,
  isHistoryPanelOpen: false,
  isMcpPanelOpen: false,
  isSkillsBrowserOpen: false,
  isScriptsPanelOpen: false,
  isWebPreviewOpen: false,
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
  openContextUsage: (paneId) => set({ contextUsagePaneId: paneId }),
  closeContextUsage: () => set({ contextUsagePaneId: null }),
  openWorktreeMenu: (paneId) => set({ worktreeMenuPaneId: paneId }),
  closeWorktreeMenu: () => set({ worktreeMenuPaneId: null }),
  openHistoryPanel: () => set({ isHistoryPanelOpen: true }),
  closeHistoryPanel: () => set({ isHistoryPanelOpen: false }),
  openMcpPanel: () => set({ isMcpPanelOpen: true }),
  closeMcpPanel: () => set({ isMcpPanelOpen: false }),
  openSkillsBrowser: () => set({ isSkillsBrowserOpen: true }),
  closeSkillsBrowser: () => set({ isSkillsBrowserOpen: false }),
  openScriptsPanel: () => set({ isScriptsPanelOpen: true }),
  closeScriptsPanel: () => set({ isScriptsPanelOpen: false }),
  openWebPreview: () => set({ isWebPreviewOpen: true }),
  closeWebPreview: () => set({ isWebPreviewOpen: false }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed }))
}))
