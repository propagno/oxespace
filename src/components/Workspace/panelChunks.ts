// Re-export the canonical shared panel chunks so OxeCode wrappers and frozen acceptance tests keep one chunk identity.
export {
  CHANGES_PANEL_CHUNK,
  INTEGRATIONS_STATUS_CHIPS_CHUNK,
  SHARED_PANEL_CHUNKS,
  WORKSPACE_ANDROID_PANEL_CHUNK,
  WORKSPACE_HTTP_CALLS_PANEL_CHUNK,
  WORKSPACE_PANEL_CHUNKS,
  preloadPanels,
  preloadWorkspacePanels,
  type SharedPanelChunkId,
  type WorkspacePanelChunkId
} from '../../lib/panelChunks'
