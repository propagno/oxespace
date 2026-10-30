import { requireAppFrame } from './ipc-guards'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { AppDatabase } from '../db'
import type { InternalMcpHandle } from '../mcp-internal/bootstrap'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { DiagnosticsService } from '../services/diagnostics.service'
import { exportRuntimeDiagnostics, recordFirstAnswer } from '../services/runtime-diagnostics'

export function registerDiagnosticsIpc(
  db: AppDatabase,
  internalMcp: InternalMcpHandle,
  service = new DiagnosticsService(db, () => internalMcp.getStatus())
): DiagnosticsService {
  ipcMain.handle(IPC_CHANNELS.diagnostics.getSnapshot, (event) => { requireAppFrame(event, 'Diagnostics'); return service.getSnapshot() })
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportReport, async (event) => {
    requireAppFrame(event, 'Diagnostics')
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const options = {
      title: 'Export OXESpace diagnostics',
      defaultPath: `oxespace-diagnostics-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, service.buildSanitizedReport(), { encoding: 'utf8', mode: 0o600 })
    return result.filePath
  })
  // Built on demand and loaded lazily: the main bundle carries only this handler, not the report builder.
  ipcMain.handle(IPC_CHANNELS.diagnostics.buildIssueReport, async (event) => {
    requireAppFrame(event, 'Diagnostics')
    const { buildIssueReport } = await import('../services/issue-report')
    return buildIssueReport({ snapshot: service.getSnapshot(), runtimeEvents: exportRuntimeDiagnostics() })
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.recordFirstAnswer, (event, input: unknown) => {
    requireAppFrame(event, 'Diagnostics')
    recordFirstAnswer(input)
  })
  return service
}
