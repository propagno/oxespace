import { create } from 'zustand'
import { useWorkspaceStore } from './workspace.store'

/**
 * A comparison another panel asks the Changes panel to show: a pull request's branches from the GitHub
 * panel, or one file from the editor. The Changes panel applies it once and clears it.
 */
export interface ChangesRequest {
  /** Side A; a branch name is matched against local and remote branches. */
  base?: string
  /** Side B as a ref; absent keeps the work tree. */
  head?: string
  /** Show only this file. */
  path?: string
}

interface ChangesRequestState {
  byWorkspace: Record<string, ChangesRequest & { at: number }>
  request(workspaceId: string, request: ChangesRequest): void
  clear(workspaceId: string): void
}

export const useChangesRequestStore = create<ChangesRequestState>((set) => ({
  byWorkspace: {},
  request: (workspaceId, request) => set(state => ({ byWorkspace: { ...state.byWorkspace, [workspaceId]: { ...request, at: Date.now() } } })),
  clear: (workspaceId) => set(state => {
    const { [workspaceId]: _removed, ...rest } = state.byWorkspace
    return { byWorkspace: rest }
  })
}))

/** Opens the workspace's Changes panel on the given comparison. */
export function openInChanges(workspaceId: string, request: ChangesRequest): void {
  useChangesRequestStore.getState().request(workspaceId, request)
  void useWorkspaceStore.getState().updateReviewState({ workspaceId, reviewPanelVisible: true })
}

/** `main` names a branch that may only exist as `origin/main` here; prefer the local one. */
export function resolveRequestedRef(name: string, available: string[]): string {
  if (available.includes(name)) return name
  const remote = available.find(candidate => candidate.endsWith(`/${name}`) && candidate.indexOf('/') === candidate.length - name.length - 1)
  return remote ?? name
}
