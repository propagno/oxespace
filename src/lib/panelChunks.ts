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

/**
 * OXE-309: a dock wrapper that statically imports a shared panel. When the wrapper arrives, that panel's module is
 * already in memory, so its SHARED_PANEL_CHUNKS entry is resolved too (no download; a failure is retried on open) and
 * the same panel opened later from OxeChat renders without a Suspense fallback.
 */
function warming<M>(load: () => Promise<M>, shared: SharedPanelChunkId) {
  return chunk(() => load().then(module => {
    SHARED_PANEL_CHUNKS[shared].load().catch(() => undefined)
    return module
  }))
}

export const WORKSPACE_PANEL_CHUNKS = {
  background: warming(() => import('../components/Workspace/WorkspaceBackgroundPanel'), 'background'),
  editor: warming(() => import('../components/Workspace/WorkspaceEditorPanel'), 'files'),
  github: warming(() => import('../components/Workspace/WorkspaceGitHubPanel'), 'git'),
  integration: chunk(() => import('../components/Workspace/WorkspaceIntegrationPanel')),
  review: chunk(() => import('../components/Workspace/WorkspaceReviewPanel')),
  search: warming(() => import('../components/Workspace/WorkspaceSearchPanel'), 'search'),
  containers: warming(() => import('../components/Workspace/WorkspaceContainersPanel'), 'containers'),
  webPreview: warming(() => import('../components/Workspace/WorkspaceWebPreviewPanel'), 'webPreview'),
  worktree: chunk(() => import('../components/Workspace/WorkspaceWorktreePanel'))
}

export type WorkspacePanelChunkId = keyof typeof WORKSPACE_PANEL_CHUNKS

/** Optional OxeCode panels and post-paint status chips loaded on demand via `lazyFrom` (never prefetched on boot). */
export const WORKSPACE_HTTP_CALLS_PANEL_CHUNK = warming(() => import('../components/Workspace/WorkspaceHttpCallsPanel'), 'httpCalls')
export const WORKSPACE_ANDROID_PANEL_CHUNK = warming(() => import('../components/Workspace/WorkspaceAndroidPanel'), 'android')
export const INTEGRATIONS_STATUS_CHIPS_CHUNK = chunk(() => import('../components/Workspace/IntegrationsStatusChips'))
export const THREAD_SIDE_CHAT_CHUNK = chunk(() => import('../components/Threads/side/ThreadSideChat'))

/** Loads the given panels' chunks; a chunk that fails is retried on the next open. */
export async function preloadPanels(ids: readonly WorkspacePanelChunkId[]): Promise<void> {
  await Promise.all(ids.map(id => WORKSPACE_PANEL_CHUNKS[id].load().then(() => undefined, () => undefined)))
}

/** Loads every core OxeCode side panel's chunk. */
export function preloadWorkspacePanels(): Promise<void> {
  return preloadPanels(Object.keys(WORKSPACE_PANEL_CHUNKS) as WorkspacePanelChunkId[])
}
