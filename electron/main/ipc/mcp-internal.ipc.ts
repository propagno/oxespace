import { BrowserWindow, clipboard, ipcMain } from 'electron'
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
  ipcMain.handle(IPC_CHANNELS.mcpInternal.getStatus, () => handle.getStatus())
  ipcMain.handle(IPC_CHANNELS.mcpInternal.regenerateToken, () => handle.regenerateToken())
  ipcMain.handle(IPC_CHANNELS.mcpInternal.captureWebPreview, async () => {
    const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed())
    if (!win) throw new Error('No application window found')

    const rectJson = await win.webContents.executeJavaScript(`
      (() => {
        const frame = document.querySelector('iframe[title="Workspace web preview"]')
        if (!frame) return null
        const rect = frame.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return null
        return JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      })()
    `)
    if (!rectJson) throw new Error('Open a visible Web Preview before capturing it.')

    const rect = JSON.parse(rectJson) as { x: number; y: number; width: number; height: number }
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
    clipboard.writeImage(image)
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
