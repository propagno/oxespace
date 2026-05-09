import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { ShellProfileService } from '../services/shell-profile.service'
import { WorkspaceService } from '../services/workspace.service'
import { parseId, parseSplitPaneInput, parseUpdatePaneTypeInput, parseUpdateWorkspaceEditorStateInput, parseUpdateWorkspaceSettingsInput, parseWorkspaceCreateInput } from './validation'

interface WorkspaceLifecycleController {
  stop(input: { paneId: string }): Promise<void> | void
  stopWorkspace(workspaceId: string): Promise<void> | void
}

export function registerWorkspaceIpc(db: AppDatabase, lifecycle?: WorkspaceLifecycleController): void {
  const workspaceService = new WorkspaceService(db)
  const shellProfileService = new ShellProfileService(db)

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => workspaceService.list())
  ipcMain.handle(IPC_CHANNELS.workspace.create, (_event, input: unknown) =>
    workspaceService.create(parseWorkspaceCreateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.setActive, (_event, id: unknown) => workspaceService.setActive(parseId(id)))
  ipcMain.handle(IPC_CHANNELS.workspace.delete, (_event, id: unknown) => {
    const workspaceId = parseId(id)
    lifecycle?.stopWorkspace(workspaceId)
    workspaceService.delete(workspaceId)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.closePane, (_event, id: unknown) => {
    const paneId = parseId(id, 'paneId')
    lifecycle?.stop({ paneId })
    workspaceService.closePane(paneId)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.splitPane, (_event, input: unknown) => {
    const { paneId, direction } = parseSplitPaneInput(input)
    return workspaceService.splitPane(paneId, direction)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updatePaneType, (_event, input: unknown) => {
    const { paneId, type } = parseUpdatePaneTypeInput(input)
    if (type !== 'terminal') lifecycle?.stop({ paneId })
    return workspaceService.updatePaneType(paneId, type)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateEditorState, (_event, input: unknown) =>
    workspaceService.updateEditorState(parseUpdateWorkspaceEditorStateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.updateSettings, (_event, input: unknown) =>
    workspaceService.updateSettings(parseUpdateWorkspaceSettingsInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(IPC_CHANNELS.workspace.shellProfiles, () => shellProfileService.list())
}
