import { create } from 'zustand'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  isSettingsOpen: boolean
  isCommandPaletteOpen: boolean
  isWorkspaceSettingsOpen: boolean
  slashOverlayPaneId: string | null
  modelSelectorPaneId: string | null
  contextUsagePaneId: string | null
  worktreeMenuPaneId: string | null
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
  openModelSelector: (paneId: string) => void
  closeModelSelector: () => void
  openContextUsage: (paneId: string) => void
  closeContextUsage: () => void
  openWorktreeMenu: (paneId: string) => void
  closeWorktreeMenu: () => void
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
  modelSelectorPaneId: null,
  contextUsagePaneId: null,
  worktreeMenuPaneId: null,
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
  openModelSelector: (paneId) => set({ modelSelectorPaneId: paneId }),
  closeModelSelector: () => set({ modelSelectorPaneId: null }),
  openContextUsage: (paneId) => set({ contextUsagePaneId: paneId }),
  closeContextUsage: () => set({ contextUsagePaneId: null }),
  openWorktreeMenu: (paneId) => set({ worktreeMenuPaneId: paneId }),
  closeWorktreeMenu: () => set({ worktreeMenuPaneId: null }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed }))
}))
