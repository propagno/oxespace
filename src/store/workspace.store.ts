import { create } from 'zustand'
import type { CreateWorkspaceInput, ShellProfile, UpdateWorkspaceAgentsStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceOxeStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, Workspace } from '../../shared/types/workspace'

interface WorkspaceState {
  workspaces: Workspace[]
  shellProfiles: ShellProfile[]
  activeWorkspaceId: string | null
  isLoading: boolean
  error: string | null
  bootstrap: () => Promise<void>
  loadShellProfiles: () => Promise<void>
  createWorkspace: (input: CreateWorkspaceInput) => Promise<Workspace>
  setActiveWorkspace: (id: string) => Promise<void>
  closeWorkspace: (id: string) => Promise<void>
  closePane: (id: string) => Promise<void>
  splitPane: (paneId: string, direction: 'vertical' | 'horizontal') => Promise<void>
  updatePaneType: (paneId: string, type: Workspace['panes'][number]['type']) => Promise<void>
  updatePaneName: (paneId: string, displayName: string | null) => Promise<void>
  setPaneModelOverride: (paneId: string, modelId: string | null) => Promise<void>
  setPaneAgent: (paneId: string, agentProfileId: string | null) => Promise<void>
  setPaneRootPath: (paneId: string, rootPath: string | null) => Promise<void>
  updateEditorState: (input: UpdateWorkspaceEditorStateInput) => Promise<void>
  updateOxeState: (input: UpdateWorkspaceOxeStateInput) => Promise<void>
  updateAgentsState: (input: UpdateWorkspaceAgentsStateInput) => Promise<void>
  updateReviewState: (input: UpdateWorkspaceReviewStateInput) => Promise<void>
  updateGitHubState: (input: UpdateWorkspaceGitHubStateInput) => Promise<void>
  updateSettings: (input: UpdateWorkspaceSettingsInput) => Promise<void>
  clearError: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  shellProfiles: [],
  activeWorkspaceId: null,
  isLoading: false,
  error: null,

  bootstrap: async () => {
    set({ isLoading: true, error: null })
    try {
      const [workspaces, shellProfiles] = await Promise.all([window.oxe.workspace.list(), window.oxe.workspace.shellProfiles()])
      set({
        workspaces,
        shellProfiles,
        activeWorkspaceId: workspaces.find((workspace) => workspace.isActive)?.id ?? workspaces[0]?.id ?? null,
        isLoading: false
      })
    } catch (error) {
      set({ error: toMessage(error), isLoading: false })
    }
  },

  loadShellProfiles: async () => {
    try {
      const shellProfiles = await window.oxe.workspace.shellProfiles()
      set({ shellProfiles, error: null })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  createWorkspace: async (input) => {
    const workspace = await window.oxe.workspace.create(input)
    set((state) => ({
      workspaces: [workspace, ...state.workspaces.map((item) => ({ ...item, isActive: item.id === workspace.id }))],
      activeWorkspaceId: workspace.id,
      error: null
    }))
    return workspace
  },

  setActiveWorkspace: async (id) => {
    const workspace = await window.oxe.workspace.setActive(id)
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === id ? workspace : { ...item, isActive: false })),
      activeWorkspaceId: id,
      error: null
    }))
  },

  closeWorkspace: async (id) => {
    await window.oxe.workspace.delete(id)
    const remaining = get().workspaces.filter((workspace) => workspace.id !== id)
    const nextActiveId = get().activeWorkspaceId === id ? remaining[0]?.id ?? null : get().activeWorkspaceId
    set({
      workspaces: remaining.map((workspace) => ({ ...workspace, isActive: workspace.id === nextActiveId })),
      activeWorkspaceId: nextActiveId,
      error: null
    })
  },

  closePane: async (id) => {
    await window.oxe.workspace.closePane(id)
    set((state) => ({
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        panes: workspace.panes.filter((pane) => pane.id !== id)
      })),
      error: null
    }))
  },

  splitPane: async (paneId, direction) => {
    const workspace = await window.oxe.workspace.splitPane({ paneId, direction })
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  updatePaneType: async (paneId, type) => {
    const workspace = await window.oxe.workspace.updatePaneType({ paneId, type })
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  updatePaneName: async (paneId, displayName) => {
    const workspace = await window.oxe.workspace.updatePaneName({ paneId, displayName })
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  setPaneModelOverride: async (paneId, modelId) => {
    const workspace = await window.oxe.workspace.setPaneModelOverride({ paneId, modelId })
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  setPaneAgent: async (paneId, agentProfileId) => {
    const workspace = await window.oxe.workspace.setPaneAgent({ paneId, agentProfileId })
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  setPaneRootPath: async (paneId, rootPath) => {
    const workspace = await window.oxe.workspace.setPaneRootPath({ paneId, rootPath })
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  updateEditorState: async (input) => {
    const workspace = await window.oxe.workspace.updateEditorState(input)
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  updateOxeState: async (input) => {
    const workspace = await window.oxe.workspace.updateOxeState(input)
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  updateAgentsState: async (input) => {
    const workspace = await window.oxe.workspace.updateAgentsState(input)
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  updateReviewState: async (input) => {
    try {
      const workspace = await window.oxe.workspace.updateReviewState(input)
      set((state) => ({
        workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
        error: null
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update review state' })
    }
  },

  updateGitHubState: async (input) => {
    try {
      const workspace = await window.oxe.workspace.updateGitHubState(input)
      set((state) => ({
        workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
        error: null
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update GitHub panel state' })
    }
  },

  updateSettings: async (input) => {
    const workspace = await window.oxe.workspace.updateSettings(input)
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
      error: null
    }))
  },

  clearError: () => set({ error: null })
}))

export function selectActiveWorkspace(state: WorkspaceState): Workspace | null {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected workspace error'
}
