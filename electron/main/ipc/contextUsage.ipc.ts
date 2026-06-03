import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ContextUsageInput } from '../../../shared/types/contextUsage'
import { ContextUsageService } from '../services/contextUsage'

/**
 * Renderer-facing IPC for the live context-window % chip.
 *   - `context-usage:get` — current `/context` fill for a pane's provider.
 */
export function registerContextUsageIpc(): void {
  const service = new ContextUsageService()
  ipcMain.handle(IPC_CHANNELS.contextUsage.get, (_e, input: ContextUsageInput) =>
    service.get(input.provider, input.workspaceRootPath, input.sessionId)
  )
}
