import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { SemanticService } from '../services/semantic.service'

/**
 * Renderer-facing controls for the Semantic search feature. The toggle state
 * lives in the renderer's terminal-prefs store; these channels mirror it into
 * the main process so indexing and the MCP tool actually respect it, and expose
 * a real status for the integration chip (instead of a hardcoded "always on").
 */
export function registerSemanticIpc(semantic: SemanticService): void {
  ipcMain.handle(IPC_CHANNELS.semantic.getStatus, (_event, workspaceId: unknown) => {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new Error('semantic:get-status requires a workspaceId string')
    }
    return semantic.getStatus(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.semantic.setEnabled, (_event, input: unknown) => {
    const { workspaceId, enabled } = (input ?? {}) as { workspaceId?: unknown; enabled?: unknown }
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new Error('semantic:set-enabled requires a workspaceId string')
    }
    if (typeof enabled !== 'boolean') {
      throw new Error('semantic:set-enabled requires an enabled boolean')
    }
    semantic.setEnabled(workspaceId, enabled)
    return semantic.getStatus(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.semantic.setMode, (_event, input: unknown) => {
    const { workspaceId, mode } = (input ?? {}) as { workspaceId?: unknown; mode?: unknown }
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new Error('semantic:set-mode requires a workspaceId string')
    }
    if (mode !== 'auto' && mode !== 'explore' && mode !== 'exhaustive') {
      throw new Error('semantic:set-mode requires auto, explore, or exhaustive')
    }
    semantic.setMode(workspaceId, mode)
    return semantic.getStatus(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.semantic.reindex, (_event, workspaceId: unknown) => {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new Error('semantic:reindex requires a workspaceId string')
    }
    return semantic.reindex(workspaceId)
  })

  // Recent activity log for Tools → Semantic Activity. Live updates arrive on
  // the IPC_CHANNELS.semantic.onLog channel (broadcast from index.ts).
  ipcMain.handle(IPC_CHANNELS.semantic.getLogs, () => semantic.getLogs())
}
