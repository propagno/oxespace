import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import log from 'electron-log/main.js'
import { writeFile } from 'node:fs/promises'
import type { AppDatabase } from '../db'
import type { InternalMcpHandle } from '../mcp-internal/bootstrap'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { DiagnosticsService } from '../services/diagnostics.service'

export function registerDiagnosticsIpc(db: AppDatabase, internalMcp: InternalMcpHandle): DiagnosticsService {
  const service = new DiagnosticsService(db, () => internalMcp.getStatus())
  ipcMain.handle(IPC_CHANNELS.diagnostics.getSnapshot, () => service.getSnapshot())
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportReport, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options = {
      title: 'Export OXESpace diagnostics',
      defaultPath: `oxespace-diagnostics-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const logPath = log.transports.file.getFile().path
    await writeFile(result.filePath, service.buildSanitizedReport(logPath), 'utf8')
    return result.filePath
  })
  return service
}
