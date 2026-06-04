import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { AgentService } from '../services/agent.service'
import { ShellProfileService } from '../services/shell-profile.service'
import { WorkspaceService } from '../services/workspace.service'
import { parseId, parseSetPaneAgentInput, parseSetPaneRootPathInput, parseSplitPaneInput, parseUpdatePaneNameInput, parseUpdatePaneTypeInput, parseUpdateWorkspaceBackgroundStateInput, parseUpdateWorkspaceEditorStateInput, parseUpdateWorkspaceGitHubStateInput, parseUpdateWorkspaceReviewStateInput, parseUpdateWorkspaceSettingsInput, parseUpdateWorkspaceWorktreeStateInput, parseWorkspaceCreateInput } from './validation'
import type { SemanticService } from '../services/semantic.service'

interface WorkspaceLifecycleController {
  stop(input: { paneId: string }): Promise<void> | void
  stopWorkspace(workspaceId: string): Promise<void> | void
}

export function registerWorkspaceIpc(db: AppDatabase, semanticService: SemanticService, lifecycle?: WorkspaceLifecycleController): void {
  const workspaceService = new WorkspaceService(db)
  const shellProfileService = new ShellProfileService(db)
  const agentService = new AgentService(db)

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => workspaceService.list())
  ipcMain.handle(IPC_CHANNELS.workspace.create, (_event, input: unknown) =>
    workspaceService.create(parseWorkspaceCreateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.setActive, (_event, id: unknown) => {
    const workspaceId = parseId(id)
    const workspace = workspaceService.setActive(workspaceId)
    // Index the workspace's canonical root for semantic search. Per-pane
    // rootPath is only an optional worktree override, so the workspace root is
    // the right tree to watch.
    if (workspace.rootPath) semanticService.watchWorkspace(workspaceId, workspace.rootPath)
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.delete, (_event, id: unknown) => {
    const workspaceId = parseId(id)
    lifecycle?.stopWorkspace(workspaceId)
    semanticService.unwatchWorkspace(workspaceId)
    workspaceService.delete(workspaceId)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.closePane, (_event, id: unknown) => {
    const paneId = parseId(id, 'paneId')
    lifecycle?.stop({ paneId })
    return workspaceService.closePane(paneId)
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
  ipcMain.handle(IPC_CHANNELS.workspace.updatePaneName, (_event, input: unknown) => {
    const { paneId, displayName } = parseUpdatePaneNameInput(input)
    return workspaceService.updatePaneName(paneId, displayName)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.setPaneAgent, (_event, input: unknown) => {
    const { paneId, agentProfileId, preserveSession } = parseSetPaneAgentInput(input)
    let agentName: string | null = null
    if (agentProfileId) {
      const profile = agentService.list().find((p) => p.agentProfileId === agentProfileId)
      if (!profile) throw new Error(`Agent profile ${agentProfileId} not found`)
      agentName = profile.name
    }
    // Explicit user switches restart the pane. Auto-detection from a running
    // shell only updates metadata so the current PTY is not interrupted.
    if (!preserveSession) lifecycle?.stop({ paneId })
    return workspaceService.setPaneAgent(paneId, agentProfileId, agentName)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.setPaneRootPath, (_event, input: unknown) => {
    const { paneId, rootPath } = parseSetPaneRootPathInput(input)
    // Stop the pane so it picks up the new cwd on next start
    lifecycle?.stop({ paneId })
    return workspaceService.setPaneRootPath(paneId, rootPath)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateEditorState, (_event, input: unknown) =>
    workspaceService.updateEditorState(parseUpdateWorkspaceEditorStateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.updateReviewState, (_event, input: unknown) =>
    workspaceService.updateReviewState(parseUpdateWorkspaceReviewStateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.updateGitHubState, (_event, input: unknown) =>
    workspaceService.updateGitHubState(parseUpdateWorkspaceGitHubStateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.updateBackgroundState, (_event, input: unknown) =>
    workspaceService.updateBackgroundState(parseUpdateWorkspaceBackgroundStateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.updateWorktreeState, (_event, input: unknown) =>
    workspaceService.updateWorktreeState(parseUpdateWorkspaceWorktreeStateInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.reorder, (_event, input: unknown) => {
    if (!Array.isArray(input)) throw new Error('workspace:reorder input must be an array of ids')
    const ids = input.map((value, index) => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`workspace:reorder ids[${index}] must be a non-empty string`)
      }
      return value
    })
    return workspaceService.reorderWorkspaces(ids)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateSettings, (_event, input: unknown) =>
    workspaceService.updateSettings(parseUpdateWorkspaceSettingsInput(input))
  )
  ipcMain.handle(IPC_CHANNELS.workspace.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(IPC_CHANNELS.workspace.shellProfiles, () => shellProfileService.list())
  ipcMain.handle(IPC_CHANNELS.workspace.createGitHubTerminalPane, (_event, id: unknown) =>
    workspaceService.createGitHubTerminalPane(parseId(id))
  )
}
