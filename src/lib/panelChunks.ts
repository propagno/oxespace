import { chunk } from './chunk'

/**
 * Shared dynamic panel chunks consumed across OxeCode (WorkspaceSurface, WorkspaceReviewPanel) and OxeChat
 * (ThreadChangesPanel, ThreadToolTabs). Every entry is a `() => import(...)` factory — never a static import — so
 * importing this module adds zero weight to the boot bundle (OXE-40, OXE-56, OXE-57, OXE-58).
 *
 * Rendering through `lazyFrom(chunk, pick)` resolves synchronously once a chunk has arrived, avoiding the ~300 ms
 * Suspense fallback hold on first open and when switching between OxeCode and OxeChat.
 */
export const CHANGES_PANEL_CHUNK = chunk(() => import('../components/Changes/ChangesPanel'))

export const SHARED_PANEL_CHUNKS = {
  changes: CHANGES_PANEL_CHUNK,
  git: chunk(() => import('../components/GitHub/GitControlPanel')),
  files: chunk(() => import('../components/Editor/EditorPane')),
  search: chunk(() => import('../components/Search/SearchPanel')),
  background: chunk(() => import('../components/Background/BackgroundJobsPanel')),
  webPreview: chunk(() => import('../components/WebPreview/WebPreviewPanel')),
  containers: chunk(() => import('../components/Containers/ContainersPanel')),
  activity: chunk(() => import('../components/OxeQuery/ActivityPanel')),
  httpCalls: chunk(() => import('../components/HttpCalls/HttpCallsPanel')),
  android: chunk(() => import('../components/Android/AndroidPanel')),
  threadTerminal: chunk(() => import('../components/Threads/ThreadProjectTerminal')),
  threadNetwork: chunk(() => import('../components/Threads/ThreadNetworkPanel'))
}

export type SharedPanelChunkId = keyof typeof SHARED_PANEL_CHUNKS

export const WORKSPACE_PANEL_CHUNKS = {
  background: chunk(() => import('../components/Workspace/WorkspaceBackgroundPanel')),
  editor: chunk(() => import('../components/Workspace/WorkspaceEditorPanel')),
  github: chunk(() => import('../components/Workspace/WorkspaceGitHubPanel')),
  integration: chunk(() => import('../components/Workspace/WorkspaceIntegrationPanel')),
  review: chunk(() => import('../components/Workspace/WorkspaceReviewPanel')),
  search: chunk(() => import('../components/Workspace/WorkspaceSearchPanel')),
  containers: chunk(() => import('../components/Workspace/WorkspaceContainersPanel')),
  webPreview: chunk(() => import('../components/Workspace/WorkspaceWebPreviewPanel')),
  worktree: chunk(() => import('../components/Workspace/WorkspaceWorktreePanel'))
}

export type WorkspacePanelChunkId = keyof typeof WORKSPACE_PANEL_CHUNKS

/** Optional OxeCode panels and post-paint status chips loaded on demand via `lazyFrom` (never prefetched on boot). */
export const WORKSPACE_HTTP_CALLS_PANEL_CHUNK = chunk(() => import('../components/Workspace/WorkspaceHttpCallsPanel'))
export const WORKSPACE_ANDROID_PANEL_CHUNK = chunk(() => import('../components/Workspace/WorkspaceAndroidPanel'))
export const INTEGRATIONS_STATUS_CHIPS_CHUNK = chunk(() => import('../components/Workspace/IntegrationsStatusChips'))

/** Loads the given panels' chunks; a chunk that fails is retried on the next open. */
export async function preloadPanels(ids: readonly WorkspacePanelChunkId[]): Promise<void> {
  await Promise.all(ids.map(id => WORKSPACE_PANEL_CHUNKS[id].load().then(() => undefined, () => undefined)))
}

/** Loads every core OxeCode side panel's chunk. */
export function preloadWorkspacePanels(): Promise<void> {
  return preloadPanels(Object.keys(WORKSPACE_PANEL_CHUNKS) as WorkspacePanelChunkId[])
}
