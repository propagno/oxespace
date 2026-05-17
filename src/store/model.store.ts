import { useWorkspaceStore } from './workspace.store'

/**
 * Helper that reads pane.modelOverride directly from the workspace store (DB-backed).
 * No separate Zustand store needed anymore since the override persists in the panes table.
 *
 * Use `useWorkspaceStore().setPaneModelOverride(paneId, modelId)` to mutate.
 */
export function getPaneModelOverride(paneId: string): string | null {
  for (const workspace of useWorkspaceStore.getState().workspaces) {
    const pane = workspace.panes.find((p) => p.id === paneId)
    if (pane) return pane.modelOverride
  }
  return null
}
