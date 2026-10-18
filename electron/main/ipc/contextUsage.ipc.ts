import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ContextUsageInput } from '../../../shared/types/contextUsage'
import { ContextUsageService } from '../services/contextUsage'
import { parseRecord, parseText, parseToken, requireAppFrame } from './ipc-guards'

/**
 * Renderer-facing IPC for the live context-window % chip.
 *   - `context-usage:get` — current `/context` fill for a pane's provider.
 */
export function registerContextUsageIpc(service = new ContextUsageService()): void {
  ipcMain.handle(IPC_CHANNELS.contextUsage.get, (event, value: unknown) => {
    requireAppFrame(event, 'Context usage')
    const input = parseRecord(value, 'Context usage request')
    const rootPath = parseText(input.workspaceRootPath, 'Workspace root', 4096)
    if (!rootPath) throw new Error('Workspace root must not be empty')
    const sessionId = input.sessionId === undefined || input.sessionId === null ? input.sessionId : parseToken(input.sessionId, 'Session id')
    return service.get(parseToken(input.provider, 'Provider', 40) as ContextUsageInput['provider'], rootPath, sessionId)
  })
}
