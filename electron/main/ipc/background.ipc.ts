import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { BackgroundManager } from '../services/background.service'

export function registerBackgroundIpc(manager: BackgroundManager): void {
  ipcMain.handle(IPC_CHANNELS.background.list, (_event, workspaceId: unknown) => {
    if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId is required')
    return manager.list(workspaceId)
  })

  ipcMain.handle(IPC_CHANNELS.background.start, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid input')
    const { workspaceId, workspaceRootPath, command, label, paneRootPath, confirmed } = input as {
      workspaceId?: unknown; workspaceRootPath?: unknown; command?: unknown; label?: unknown; paneRootPath?: unknown; confirmed?: unknown
    }
    if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId is required')
    if (typeof workspaceRootPath !== 'string' || !workspaceRootPath) throw new Error('workspaceRootPath is required')
    if (typeof command !== 'string' || !command.trim()) throw new Error('command is required')
    return manager.start({
      workspaceId,
      workspaceRootPath,
      command: command.trim(),
      label: typeof label === 'string' && label.trim() ? label.trim() : undefined,
      paneRootPath: typeof paneRootPath === 'string' && paneRootPath ? paneRootPath : null,
      confirmed: confirmed === true
    })
  })

  ipcMain.handle(IPC_CHANNELS.background.stop, (_event, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) throw new Error('jobId is required')
    manager.stop(jobId)
  })

  ipcMain.handle(IPC_CHANNELS.background.remove, (_event, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) throw new Error('jobId is required')
    manager.remove(jobId)
  })

  ipcMain.handle(IPC_CHANNELS.background.getOutput, (_event, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId) throw new Error('jobId is required')
    return manager.getOutput(jobId)
  })
}
