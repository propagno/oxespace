import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { InternalMcpHandle } from '../mcp-internal/bootstrap'

/**
 * Renderer-facing IPC for the internal MCP server.
 *
 * Three channels:
 *   - `mcp-internal:get-status`        — polled by the McpPanel's built-in card.
 *   - `mcp-internal:regenerate-token`  — fired by the "Regenerate token" button.
 *   - `mcp-internal:on-web-preview`    — pushes a payload when an agent calls
 *      `oxespace_open_web_preview`. The renderer's WebPreview panel listens
 *      and updates its URL to match.
 */
export function registerMcpInternalIpc(handle: InternalMcpHandle): void {
  ipcMain.handle(IPC_CHANNELS.mcpInternal.getStatus, (event) => handle.getStatus())
  // A new token disconnects every agent using the bridge: only the app's own window may ask.
  ipcMain.handle(IPC_CHANNELS.mcpInternal.regenerateToken, (event) => handle.regenerateToken())
  ipcMain.handle(IPC_CHANNELS.mcpInternal.actionAudit, (event, limit: unknown) => {
    return handle.actionAudit(typeof limit === 'number' && Number.isInteger(limit) ? limit : 200)
  })
  ipcMain.handle(IPC_CHANNELS.mcpInternal.exportAudit, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options = { title: 'Export the audit', defaultPath: `oxespace-audit-${new Date().toISOString().slice(0, 10)}.jsonl`, filters: [{ name: 'JSON lines', extensions: ['jsonl'] }] }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, handle.exportAudit(), { encoding: 'utf8', mode: 0o600 })
    return result.filePath
  })

  // Push-channel: we don't ipcMain.handle this — instead we broadcast on the
  // event channel to every BrowserWindow whenever a web-preview is requested.
  handle.onWebPreview((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.mcpInternal.onWebPreview, event)
      }
    }
  })

  // Push-channel: broadcast worktree mutations so the renderer refreshes the
  // Worktree panel + sidebar badge after an agent creates/removes a worktree.
  handle.onWorktreeChanged((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.mcpInternal.onWorktreeChanged, event)
      }
    }
  })
}
