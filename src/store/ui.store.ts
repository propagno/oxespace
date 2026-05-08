import { create } from 'zustand'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  isSettingsOpen: boolean
  openNewWorkspace: () => void
  closeNewWorkspace: () => void
  setMaximizedPane: (paneId: string | null) => void
  toggleSettings: () => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>((set) => ({
  isNewWorkspaceOpen: false,
  maximizedPaneId: null,
  isSidebarCollapsed: false,
  isSettingsOpen: false,
  openNewWorkspace: () => set({ isNewWorkspaceOpen: true }),
  closeNewWorkspace: () => set({ isNewWorkspaceOpen: false }),
  setMaximizedPane: (paneId) => set({ maximizedPaneId: paneId }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed }))
}))
