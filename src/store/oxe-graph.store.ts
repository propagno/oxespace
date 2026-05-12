import { create } from 'zustand'
import type { OxeExecutionGraph } from '../../shared/types/oxe-graph'

interface WorkspaceGraphState {
  graph: OxeExecutionGraph | null
  isLoading: boolean
  error: string | null
}

interface OxeGraphState {
  byWorkspaceId: Record<string, WorkspaceGraphState>
  loadGraph: (workspaceId: string, rootPath: string) => Promise<OxeExecutionGraph | null>
  subscribeToGraphUpdates: (workspaceId: string) => () => void
  setGraph: (workspaceId: string, graph: OxeExecutionGraph) => void
  clearGraph: (workspaceId: string) => void
}

const EMPTY_GRAPH_STATE: WorkspaceGraphState = {
  graph: null,
  isLoading: false,
  error: null,
}

export const useOxeGraphStore = create<OxeGraphState>((set, get) => ({
  byWorkspaceId: {},

  loadGraph: async (workspaceId, rootPath) => {
    setWorkspaceState(set, workspaceId, { isLoading: true, error: null })
    try {
      const graph = await window.oxe.oxe.getGraph({ workspaceId, rootPath })
      setWorkspaceState(set, workspaceId, { graph, isLoading: false, error: null })
      return graph
    } catch (error) {
      setWorkspaceState(set, workspaceId, { isLoading: false, error: toMessage(error) })
      return null
    }
  },

  subscribeToGraphUpdates: (workspaceId) => {
    return window.oxe.oxe.onGraphUpdate((graph) => {
      setWorkspaceState(set, workspaceId, { graph, error: null })
    })
  },

  setGraph: (workspaceId, graph) => {
    setWorkspaceState(set, workspaceId, { graph, isLoading: false, error: null })
  },

  clearGraph: (workspaceId) =>
    set((state) => {
      const { [workspaceId]: _removed, ...remaining } = state.byWorkspaceId
      return { byWorkspaceId: remaining }
    })
}))

export function selectGraphState(workspaceId: string | null | undefined) {
  return (state: OxeGraphState): WorkspaceGraphState =>
    workspaceId ? (state.byWorkspaceId[workspaceId] ?? EMPTY_GRAPH_STATE) : EMPTY_GRAPH_STATE
}

export function selectGraph(workspaceId: string | null | undefined) {
  return (state: OxeGraphState): OxeExecutionGraph | null =>
    selectGraphState(workspaceId)(state).graph

}

function setWorkspaceState(
  set: (partial: OxeGraphState | Partial<OxeGraphState> | ((state: OxeGraphState) => OxeGraphState | Partial<OxeGraphState>)) => void,
  workspaceId: string,
  patch: Partial<WorkspaceGraphState>
): void {
  set((state) => ({
    byWorkspaceId: {
      ...state.byWorkspaceId,
      [workspaceId]: {
        ...(state.byWorkspaceId[workspaceId] ?? EMPTY_GRAPH_STATE),
        ...patch,
      },
    },
  }))
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected graph error'
}
