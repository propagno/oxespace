import { create } from 'zustand'

interface UIState {
  isNewWorkspaceOpen: boolean
  maximizedPaneId: string | null
  isSidebarCollapsed: boolean
  openNewWorkspace: () => void
  closeNewWorkspace: () => void
  setMaximizedPane: (paneId: string | null) => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>((set) => ({
  isNewWorkspaceOpen: false,
  maximizedPaneId: null,
  isSidebarCollapsed: false,
  openNewWorkspace: () => set({ isNewWorkspaceOpen: true }),
  closeNewWorkspace: () => set({ isNewWorkspaceOpen: false }),
  setMaximizedPane: (paneId) => set({ maximizedPaneId: paneId }),
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed }))
}))
