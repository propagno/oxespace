import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { AgentService } from '../services/agent.service'
import { ShellProfileService } from '../services/shell-profile.service'
import { WorkspaceService } from '../services/workspace.service'
import { checkWorkspaceRoot, normalizeWorkspaceRoot } from '../services/workspace-root'
import { parseId, parseSetPaneAgentInput, parseSetPaneRootPathInput, parseSplitPaneInput, parseUpdatePaneNameInput, parseUpdatePaneTypeInput, parseUpdateWorkspaceBackgroundStateInput, parseUpdateWorkspaceEditorStateInput, parseUpdateWorkspaceGitHubStateInput, parseUpdateWorkspaceReviewStateInput, parseUpdateWorkspaceSettingsInput, parseUpdateWorkspaceWorktreeStateInput, parseWorkspaceCreateInput } from './validation'
import { acceptedConfig } from '../services/policy'
import { firstPolicyRead } from '../services/policy/first-read'
import { mainMessage } from '../../../shared/messages'
import { isSameRootPath } from '../../../shared/utils/path'

interface WorkspaceLifecycleController {
  stop(input: { paneId: string }): Promise<void> | void
  stopWorkspace(workspaceId: string): Promise<void> | void
  hasSession?(paneId: string): boolean
}

/**
 * Services this adapter drives. Supplied as an object rather than as three more
 * positional defaults so a test can replace one without naming the other two.
 */
export interface WorkspaceIpcServices {
  workspaceService?: WorkspaceService
  shellProfileService?: ShellProfileService
  agentService?: AgentService
}

/** The app's own service: it asks the terminals what runs, and registration is startup, so it clears stale rows once. */
function startWorkspaceService(db: AppDatabase, lifecycle?: WorkspaceLifecycleController): WorkspaceService {
  const service = new WorkspaceService(db, { isPaneRunning: (paneId) => lifecycle?.hasSession?.(paneId) ?? false })
  service.resetStalePaneStatus()
  return service
}

export function registerWorkspaceIpc(
  db: AppDatabase,
  lifecycle?: WorkspaceLifecycleController,
  services: WorkspaceIpcServices = {}
): void {
  const workspaceService = services.workspaceService ?? startWorkspaceService(db, lifecycle)
  const shellProfileService = services.shellProfileService ?? new ShellProfileService(db)
  const agentService = services.agentService ?? new AgentService(db)

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => workspaceService.list())
  ipcMain.handle(IPC_CHANNELS.workspace.create, (_event, input: unknown) => {
    // A pasted path loses its surrounding spaces and quotes here, so every caller gets the same root.
    const rootPath = typeof (input as { rootPath?: unknown } | null)?.rootPath === 'string' ? normalizeWorkspaceRoot((input as { rootPath: string }).rootPath) : undefined
    // A root that is not an existing folder is refused before the service runs:
    // no row, no panes, and no terminals started in a folder that is not there.
    const root = rootPath === undefined ? undefined : checkWorkspaceRoot(rootPath)
    if (root && !root.ok) return root
    const parsed = parseWorkspaceCreateInput(rootPath === undefined ? input : { ...(input as object), rootPath })
    const created = workspaceService.create(parsed)
    // B7.4: the project's policy is read before any pane of it starts (the floor applies; what needs the person asks).
    if (created?.rootPath) firstPolicyRead(created.rootPath)
    return created
  })
  // OXE-367: whether the workspace's folder is still an existing folder that can be listed.
  ipcMain.handle(IPC_CHANNELS.workspace.rootStatus, (_event, id: unknown) => {
    const root = workspaceService.get(parseId(id))?.rootPath
    return { available: !!root && checkWorkspaceRoot(root).ok }
  })
  // OXE-367: the same workspace and panes on another folder, with create's checks (quotes, an existing folder, the
  // first policy read); a folder another workspace already has is refused. Never creates, moves or deletes a folder.
  ipcMain.handle(IPC_CHANNELS.workspace.relink, (_event, input: unknown) => {
    const record = (input && typeof input === 'object' ? input : {}) as { workspaceId?: unknown; rootPath?: unknown }
    const workspaceId = parseId(record.workspaceId, 'workspaceId')
    if (!workspaceService.get(workspaceId)) throw new Error(`Workspace ${workspaceId} not found`)
    const rootPath = typeof record.rootPath === 'string' ? normalizeWorkspaceRoot(record.rootPath) : ''
    const root = checkWorkspaceRoot(rootPath)
    if (!root.ok) return root
    if (workspaceService.list().some(other => other.id !== workspaceId && isSameRootPath(other.rootPath, rootPath, process.platform))) {
      return { ok: false, refusal: 'taken', message: mainMessage('workspace.root.taken', { path: rootPath }) }
    }
    const linked = workspaceService.relinkRoot(workspaceId, rootPath)
    firstPolicyRead(linked.rootPath)
    return linked
  })
  ipcMain.handle(IPC_CHANNELS.workspace.setActive, (_event, id: unknown) => {
    const workspaceId = parseId(id)
    return workspaceService.setActive(workspaceId)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.delete, (_event, id: unknown) => {
    const workspaceId = parseId(id)
    lifecycle?.stopWorkspace(workspaceId)
    // B7.4: a policy change still asked about for this project ends with it (closing a pane never cancels one).
    const root = workspaceService.get(workspaceId)?.rootPath
    workspaceService.delete(workspaceId)
    if (root && !workspaceService.list().some(other => other.rootPath === root)) acceptedConfig()?.forgetRoot(root)
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

  ipcMain.handle(IPC_CHANNELS.workspace.createPane, (_event, input: unknown) => {
    const { workspaceId } = (input ?? {}) as { workspaceId?: unknown }
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      throw new Error('workspace:create-pane requires a workspaceId string')
    }
    return workspaceService.createPane(workspaceId)
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
