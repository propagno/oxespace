import { create } from 'zustand'
import type { OxeArtifactSummary, OxeStatus } from '../../shared/types/ipc'

interface WorkspaceOxeState {
  status: OxeStatus | null
  artifacts: OxeArtifactSummary[]
  isLoading: boolean
  error: string | null
}

interface OxeState {
  byWorkspaceId: Record<string, WorkspaceOxeState>
  loadStatus: (workspaceId: string, rootPath: string) => Promise<OxeStatus | null>
  loadArtifacts: (workspaceId: string, rootPath: string) => Promise<OxeArtifactSummary[]>
  clearWorkspaceStatus: (workspaceId: string) => void
}

const EMPTY_WORKSPACE_OXE_STATE: WorkspaceOxeState = {
  status: null,
  artifacts: [],
  isLoading: false,
  error: null
}

export const useOxeStore = create<OxeState>((set, get) => ({
  byWorkspaceId: {},

  loadStatus: async (workspaceId, rootPath) => {
    setWorkspaceState(set, workspaceId, { isLoading: true, error: null })
    try {
      const status = await window.oxe.oxe.getStatusJson({ workspaceId, rootPath })
      setWorkspaceState(set, workspaceId, {
        status,
        artifacts: status.artifacts,
        isLoading: false,
        error: null
      })
      return status
    } catch (error) {
      setWorkspaceState(set, workspaceId, { isLoading: false, error: toMessage(error) })
      return null
    }
  },

  loadArtifacts: async (workspaceId, rootPath) => {
    try {
      const artifacts = await window.oxe.oxe.listArtifacts({ workspaceId, rootPath })
      setWorkspaceState(set, workspaceId, { artifacts, error: null })
      return artifacts
    } catch (error) {
      setWorkspaceState(set, workspaceId, { error: toMessage(error) })
      return get().byWorkspaceId[workspaceId]?.artifacts ?? []
    }
  },

  clearWorkspaceStatus: (workspaceId) =>
    set((state) => {
      const { [workspaceId]: _removed, ...remaining } = state.byWorkspaceId
      return { byWorkspaceId: remaining }
    })
}))

export function selectOxeWorkspaceState(workspaceId: string | null | undefined) {
  return (state: OxeState): WorkspaceOxeState => (workspaceId ? state.byWorkspaceId[workspaceId] ?? EMPTY_WORKSPACE_OXE_STATE : EMPTY_WORKSPACE_OXE_STATE)
}

function setWorkspaceState(
  set: (partial: OxeState | Partial<OxeState> | ((state: OxeState) => OxeState | Partial<OxeState>)) => void,
  workspaceId: string,
  patch: Partial<WorkspaceOxeState>
): void {
  set((state) => ({
    byWorkspaceId: {
      ...state.byWorkspaceId,
      [workspaceId]: {
        ...(state.byWorkspaceId[workspaceId] ?? EMPTY_WORKSPACE_OXE_STATE),
        ...patch
      }
    }
  }))
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected OXE integration error'
}
