import { create } from 'zustand'
import type { CreateWorkspaceInput, ShellProfile, UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, UpdateWorkspaceWorktreeStateInput, Workspace } from '../../shared/types/workspace'

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
  setPaneAgent: (paneId: string, agentProfileId: string | null, options?: { preserveSession?: boolean }) => Promise<void>
  setPaneRootPath: (paneId: string, rootPath: string | null) => Promise<void>
  updateEditorState: (input: UpdateWorkspaceEditorStateInput) => Promise<void>
  updateReviewState: (input: UpdateWorkspaceReviewStateInput) => Promise<void>
  updateGitHubState: (input: UpdateWorkspaceGitHubStateInput) => Promise<void>
  updateBackgroundState: (input: UpdateWorkspaceBackgroundStateInput) => Promise<void>
  updateWorktreeState: (input: UpdateWorkspaceWorktreeStateInput) => Promise<void>
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>
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
    // Optimistic switch — flip the active id in the local cache BEFORE the
    // IPC roundtrips. Previously we awaited the SQLite transaction + full
    // workspace re-fetch before updating, which made every sidebar click
    // pay 100-300ms of "loading" lag for the workspace-host CSS swap.
    // The IPC is now fire-and-reconcile: persistence still happens (so a
    // restart picks the right active workspace) but the UI doesn't wait.
    const previousActiveId = get().activeWorkspaceId
    if (previousActiveId === id) return
    set((state) => ({
      workspaces: state.workspaces.map((item) =>
        item.id === id
          ? { ...item, isActive: true }
          : item.isActive
            ? { ...item, isActive: false }
            : item
      ),
      activeWorkspaceId: id,
      error: null
    }))
    try {
      const workspace = await window.oxe.workspace.setActive(id)
      // Reconcile with the authoritative row in case the backend mutated
      // anything we don't track locally (updated_at, last-active, etc.).
      set((state) => ({
        workspaces: state.workspaces.map((item) => (item.id === id ? workspace : item))
      }))
    } catch (err) {
      // Rollback the optimistic flip so the UI doesn't lie about state.
      set((state) => ({
        workspaces: state.workspaces.map((item) =>
          item.id === previousActiveId
            ? { ...item, isActive: true }
            : item.isActive
              ? { ...item, isActive: false }
              : item
        ),
        activeWorkspaceId: previousActiveId,
        error: err instanceof Error ? err.message : 'Failed to switch workspace'
      }))
    }
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
    const updated = await window.oxe.workspace.closePane(id)
    set((state) => ({
      workspaces: state.workspaces.map((workspace) => {
        if (updated && workspace.id === updated.id) return updated
        // Fallback for when the pane was already gone server-side: still drop it
        // from the local store so the UI doesn't keep a stale row.
        return { ...workspace, panes: workspace.panes.filter((pane) => pane.id !== id) }
      }),
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

  setPaneAgent: async (paneId, agentProfileId, options) => {
    const workspace = await window.oxe.workspace.setPaneAgent({ paneId, agentProfileId, preserveSession: options?.preserveSession })
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

  updateBackgroundState: async (input) => {
    try {
      const workspace = await window.oxe.workspace.updateBackgroundState(input)
      set((state) => ({
        workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
        error: null
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update Background panel state' })
    }
  },

  updateWorktreeState: async (input) => {
    try {
      const workspace = await window.oxe.workspace.updateWorktreeState(input)
      set((state) => ({
        workspaces: state.workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
        error: null
      }))
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to update Worktree panel state' })
    }
  },

  reorderWorkspaces: async (orderedIds) => {
    // Optimistic update — reorder the local cache immediately so the
    // sidebar doesn't flash back to the old order while the IPC roundtrips.
    // The IPC response replaces the cache so any concurrent writes (e.g.
    // a workspace being added during the drag) reconcile correctly.
    const previous = get().workspaces
    const indexById = new Map(orderedIds.map((id, index) => [id, index]))
    const optimistic = [...previous].sort((a, b) => {
      const ai = indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const bi = indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })
    set({ workspaces: optimistic, error: null })
    try {
      const fresh = await window.oxe.workspace.reorder(orderedIds)
      set({ workspaces: fresh, error: null })
    } catch (err) {
      // Roll back on failure so the UI doesn't lie about persistence.
      set({ workspaces: previous, error: err instanceof Error ? err.message : 'Failed to reorder workspaces' })
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
