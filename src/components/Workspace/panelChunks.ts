import { chunk } from '../../lib/chunk'

// The side panels' chunks. WorkspaceSurface renders each panel through `lazyFrom` over these, so once a chunk has
// arrived the panel opens in the same commit: a plain React.lazy shows its Suspense fallback for ~300 ms on the first
// open even when the module is already loaded (OXE-40, OXE-56).
export const WORKSPACE_PANEL_CHUNKS = {
  background: chunk(() => import('./WorkspaceBackgroundPanel')),
  editor: chunk(() => import('./WorkspaceEditorPanel')),
  github: chunk(() => import('./WorkspaceGitHubPanel')),
  integration: chunk(() => import('./WorkspaceIntegrationPanel')),
  review: chunk(() => import('./WorkspaceReviewPanel')),
  search: chunk(() => import('./WorkspaceSearchPanel')),
  containers: chunk(() => import('./WorkspaceContainersPanel')),
  webPreview: chunk(() => import('./WorkspaceWebPreviewPanel')),
  worktree: chunk(() => import('./WorkspaceWorktreePanel'))
}

export type WorkspacePanelChunkId = keyof typeof WORKSPACE_PANEL_CHUNKS

/** The Changes view inside the review panel; warmed at idle so its first open does not suspend either. */
export const CHANGES_PANEL_CHUNK = chunk(() => import('../Changes/ChangesPanel'))

/** Loads the given panels' chunks; a chunk that fails is retried on the next open. */
export async function preloadPanels(ids: readonly WorkspacePanelChunkId[]): Promise<void> {
  await Promise.all(ids.map(id => WORKSPACE_PANEL_CHUNKS[id].load().then(() => undefined, () => undefined)))
}

/** Loads every side panel's chunk. */
export function preloadWorkspacePanels(): Promise<void> {
  return preloadPanels(Object.keys(WORKSPACE_PANEL_CHUNKS) as WorkspacePanelChunkId[])
}
