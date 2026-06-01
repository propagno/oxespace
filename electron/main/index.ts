import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main.js'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './db/index'
import { registerAgentIpc } from './ipc/agent.ipc'
import { registerFileSystemIpc } from './ipc/file-system.ipc'
import { registerGitIpc } from './ipc/git.ipc'
import { registerGitHubIpc } from './ipc/github.ipc'
import { registerIntegrationIpc } from './ipc/integration.ipc'
import { registerBackgroundIpc } from './ipc/background.ipc'
import { registerSessionIpc } from './ipc/session.ipc'
import { broadcastSkillChange, registerSkillIpc } from './ipc/skill.ipc'
import { broadcastMcpHealth, registerMcpIpc } from './ipc/mcp.ipc'
import { registerMcpInternalIpc } from './ipc/mcp-internal.ipc'
import { registerVoiceIpc } from './ipc/voice.ipc'
import { registerNotificationsIpc } from './ipc/notifications.ipc'
import { registerOxeIpc } from './ipc/oxe.ipc'
import { registerCopilotIpc } from './ipc/copilot.ipc'
import { registerOxeContextIpc } from './ipc/oxe-context.ipc'
import { SkillService } from './services/skill.service'
import { McpManager } from './services/mcp.service'
import { WorkspaceService } from './services/workspace.service'
import { GitHubService } from './services/github.service'
import { GitService } from './services/git.service'
import { createInternalMcpHandle, type InternalMcpHandle } from './mcp-internal/bootstrap'
import { registerTaskIpc } from './ipc/task.ipc'
import { registerTerminalIpc } from './ipc/terminal.ipc'
import { registerWorkspaceIpc } from './ipc/workspace.ipc'
import { BackgroundManager } from './services/background.service'
import { TerminalManager } from './services/terminal.service'
import { isSafeExternalUrl } from './utils/external-url'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { ShellProfile, Workspace, WorkspaceLayout, WorkspaceLayoutPreset } from '../../shared/types/workspace'

log.initialize()

const isDev = !app.isPackaged
if (isDev) {
  app.setPath('userData', join(app.getPath('appData'), 'oxespace-dev'))
}
let ipcRegistered = false
const clipboardImageTempFiles = new Set<string>()
const CLIPBOARD_IMAGE_TTL_MS = 30 * 60 * 1000

function registerIpcHandlers(): void {
  if (ipcRegistered) return
  if (process.env.OXESPACE_E2E_MOCK_NATIVE === '1') {
    registerE2eMockIpcHandlers()
    ipcRegistered = true
    return
  }

  let db: ReturnType<typeof openDatabase>
  try {
    db = openDatabase()
  } catch (error) {
    log.error('Native startup failed', error)
    registerNativeFailureIpcHandlers(toMessage(error))
    ipcRegistered = true
    return
  }

  const terminalManager = new TerminalManager(db, {
    emitData: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onData, event)
      }
    },
    emitExit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onExit, event)
      }
    }
  })
  registerWorkspaceIpc(db, terminalManager)
  registerTerminalIpc(terminalManager)
  registerAgentIpc(db)
  registerTaskIpc(db, terminalManager)
  registerGitIpc()
  registerGitHubIpc(db)
  registerIntegrationIpc(db)
  const backgroundManager = new BackgroundManager(db, {
    emitOutput: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.background.onOutput, event)
      }
    },
    emitUpdate: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.background.onUpdate, event)
      }
    }
  })
  registerBackgroundIpc(backgroundManager)
  registerSessionIpc(db)
  const skillService = new SkillService({ onChange: broadcastSkillChange })
  registerSkillIpc(skillService, (input) => terminalManager.write(input))
  const mcpManager = new McpManager(db, { emitHealth: broadcastMcpHealth })
  registerMcpIpc(mcpManager)
  // Read clipboard text in main (Electron's clipboard module needs no renderer
  // permission), so terminal Ctrl+V paste never depends on navigator.clipboard
  // being granted clipboard-read.
  ipcMain.handle(IPC_CHANNELS.clipboard.readText, () => clipboard.readText())
  ipcMain.handle(IPC_CHANNELS.clipboard.writeText, (_e, text: string) => {
    clipboard.writeText(typeof text === 'string' ? text : '')
    return true
  })
  ipcMain.handle(IPC_CHANNELS.clipboard.saveImageToTemp, async () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const filePath = join(tmpdir(), `oxe-paste-${randomUUID()}.png`)
    await writeFile(filePath, image.toPNG())
    clipboardImageTempFiles.add(filePath)
    const timer = setTimeout(() => {
      void cleanupTempFile(filePath)
    }, CLIPBOARD_IMAGE_TTL_MS)
    timer.unref?.()
    return filePath
  })
  registerVoiceIpc()
  registerNotificationsIpc()
  registerCopilotIpc()
  const oxeService = registerOxeIpc()
  const fileSystemService = registerFileSystemIpc()
  // Internal oxespace MCP server — auto-starts on app boot, registers a
  // global row in mcp_servers, syncs to every workspace's .mcp.json. The
  // bridge script lives under <userData>/bin/ and is spawned by each
  // agent CLI separately (Claude Code, Copilot, …). See plan section 3.
  const internalMcpWorkspaceServ = new WorkspaceService(db)
  const internalMcpGithub = new GitHubService(db)
  const internalMcpGit = new GitService()
  const internalMcp: InternalMcpHandle = createInternalMcpHandle({
    db,
    mcpManager,
    workspaceServ: internalMcpWorkspaceServ,
    github: internalMcpGithub,
    background: backgroundManager,
    fileSystem: fileSystemService
  })
  registerMcpInternalIpc(internalMcp)
  void internalMcp.start()
  // OXESpace context manifest — prepended to the agent's initial prompt on
  // pane spawn so the CLI knows the workspace state without calling any MCP
  // tool. Read shortcut; MCP is still the action path (see oxe-context.service.ts).
  registerOxeContextIpc({
    db,
    workspaceServ: internalMcpWorkspaceServ,
    github: internalMcpGithub,
    git: internalMcpGit,
    background: backgroundManager,
    fileSystem: fileSystemService
  })
  app.once('before-quit', () => {
    for (const filePath of clipboardImageTempFiles) void cleanupTempFile(filePath)
    fileSystemService.closeAll()
    terminalManager.stopAll()
    backgroundManager.stopAll()
    skillService.dispose()
    mcpManager.stopAll()
    oxeService.disposeAll()
    void internalMcp.stop()
  })
  ipcRegistered = true
}

function registerNativeFailureIpcHandlers(message: string): void {
  const shellProfiles: ShellProfile[] = [
    { id: 'builtin-powershell', name: 'PowerShell', executable: 'powershell.exe', args: ['-NoLogo'], isBuiltin: true },
    { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true },
    { id: 'builtin-copilot', name: 'copilot', executable: 'copilot', args: [], isBuiltin: true }
  ]
  const fail = (): never => {
    throw new Error(`Native runtime unavailable: ${message}`)
  }

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => [])
  ipcMain.handle(IPC_CHANNELS.workspace.shellProfiles, () => shellProfiles)
  ipcMain.handle(IPC_CHANNELS.workspace.create, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.setActive, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.delete, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.closePane, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.splitPane, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updatePaneType, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateEditorState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateReviewState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateGitHubState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateSettings, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(IPC_CHANNELS.terminal.start, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.write, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.resize, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.stop, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.restart, fail)
  ipcMain.handle(IPC_CHANNELS.voice.transcribe, fail)
  ipcMain.handle(IPC_CHANNELS.voice.getModelStatus, () => ({ size: 'base', ready: false, path: '', engineReady: false }))
  ipcMain.handle(IPC_CHANNELS.voice.ensureModel, fail)
  ipcMain.handle(IPC_CHANNELS.notifications.notify, () => false)
  ipcMain.handle(IPC_CHANNELS.oxe.detect, () => ({ installed: false, version: null }))
  ipcMain.handle(IPC_CHANNELS.oxe.status, () => ({ installed: false, version: null, isOxeProject: false, status: null, error: null }))
  ipcMain.handle(IPC_CHANNELS.oxe.openDashboard, () => ({ ok: false, error: null }))
  ipcMain.handle(IPC_CHANNELS.agent.list, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.discover, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.getReadiness, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.create, fail)
  ipcMain.handle(IPC_CHANNELS.agent.update, fail)
  ipcMain.handle(IPC_CHANNELS.agent.delete, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.list, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.create, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.update, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.delete, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.reorder, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.run, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.verify, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.executions, () => [])
  ipcMain.handle(IPC_CHANNELS.fs.listTree, fail)
  ipcMain.handle(IPC_CHANNELS.fs.readFile, fail)
  ipcMain.handle(IPC_CHANNELS.fs.writeFile, fail)
  ipcMain.handle(IPC_CHANNELS.fs.watchFile, fail)
  ipcMain.handle(IPC_CHANNELS.fs.unwatchFile, fail)
  for (const channel of Object.values(IPC_CHANNELS.github)) {
    ipcMain.handle(channel, fail)
  }
  ipcMain.handle(IPC_CHANNELS.integration.listGroups, () => [])
  ipcMain.handle(IPC_CHANNELS.integration.createGroup, fail)
  ipcMain.handle(IPC_CHANNELS.integration.updateGroup, fail)
  ipcMain.handle(IPC_CHANNELS.integration.deleteGroup, fail)
  ipcMain.handle(IPC_CHANNELS.integration.addMember, fail)
  ipcMain.handle(IPC_CHANNELS.integration.updateMember, fail)
  ipcMain.handle(IPC_CHANNELS.integration.removeMember, fail)
  ipcMain.handle(IPC_CHANNELS.integration.attachSession, fail)
  ipcMain.handle(IPC_CHANNELS.integration.listHandoffs, () => [])
  ipcMain.handle(IPC_CHANNELS.integration.createHandoff, fail)
  ipcMain.handle(IPC_CHANNELS.integration.updateHandoff, fail)
  ipcMain.handle(IPC_CHANNELS.integration.buildContext, fail)
  // Wave 2-6 channels — degrade gracefully so the renderer doesn't spam
  // "No handler registered" errors when native startup failed. Listing channels
  // return empty data; mutating channels throw via `fail` so the user sees the
  // root cause in any action they try.
  ipcMain.handle(IPC_CHANNELS.background.list, () => [])
  ipcMain.handle(IPC_CHANNELS.background.start, fail)
  ipcMain.handle(IPC_CHANNELS.background.stop, fail)
  ipcMain.handle(IPC_CHANNELS.background.remove, fail)
  ipcMain.handle(IPC_CHANNELS.background.getOutput, () => ({ jobId: '', startSequence: 0, lines: [] }))
  ipcMain.handle(IPC_CHANNELS.session.list, () => [])
  ipcMain.handle(IPC_CHANNELS.session.fork, fail)
  ipcMain.handle(IPC_CHANNELS.session.delete, fail)
  ipcMain.handle(IPC_CHANNELS.skill.list, () => [])
  ipcMain.handle(IPC_CHANNELS.skill.get, () => null)
  ipcMain.handle(IPC_CHANNELS.skill.invoke, fail)
  ipcMain.handle(IPC_CHANNELS.skill.create, fail)
  ipcMain.handle(IPC_CHANNELS.mcp.list, () => [])
  ipcMain.handle(IPC_CHANNELS.mcp.create, fail)
  ipcMain.handle(IPC_CHANNELS.mcp.update, fail)
  ipcMain.handle(IPC_CHANNELS.mcp.delete, fail)
  ipcMain.handle(IPC_CHANNELS.mcp.start, fail)
  ipcMain.handle(IPC_CHANNELS.mcp.stop, fail)
  ipcMain.handle(IPC_CHANNELS.mcp.callTool, fail)
  if ('setTrust' in IPC_CHANNELS.mcp) {
    ipcMain.handle((IPC_CHANNELS.mcp as Record<string, string>).setTrust, fail)
  }
  ipcMain.handle(IPC_CHANNELS.mcpInternal.getStatus, () => ({
    running: false,
    port: null,
    bridgePath: null,
    serverRowId: null,
    lastError: 'native startup failed',
    uptimeMs: 0,
    toolCount: 0,
    tools: []
  }))
  ipcMain.handle(IPC_CHANNELS.mcpInternal.regenerateToken, fail)
  ipcMain.handle(IPC_CHANNELS.oxeContext.buildPaneManifest, () => '')
  ipcMain.handle(IPC_CHANNELS.workspace.updateBackgroundState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateWorktreeState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.reorder, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.setPaneAgent, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.setPaneRootPath, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updatePaneName, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.createGitHubTerminalPane, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.onVerifyOutput, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.addDependency, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.removeDependency, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.getReady, () => [])
}

function registerE2eMockIpcHandlers(): void {
  const shellProfiles: ShellProfile[] = [
    { id: 'builtin-powershell', name: 'PowerShell', executable: 'powershell.exe', args: ['-NoLogo'], isBuiltin: true },
    { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true },
    { id: 'builtin-copilot', name: 'copilot', executable: 'copilot', args: [], isBuiltin: true }
  ]
  const workspaces: Workspace[] = []

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => workspaces)
  ipcMain.handle(IPC_CHANNELS.workspace.shellProfiles, () => shellProfiles)
  ipcMain.handle(IPC_CHANNELS.workspace.create, (_event: IpcMainInvokeEvent, input: { rootPath: string; layout?: WorkspaceLayout; layoutPreset?: WorkspaceLayoutPreset; defaultShellProfileId?: string; autoStart?: boolean }) => {
    const layout = input.layout ?? presetToLayout(input.layoutPreset ?? 4)
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.rootPath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? 'workspace',
      rootPath: input.rootPath,
      layout,
      layoutPreset: input.layoutPreset ?? layoutToPreset(layout),
      themeId: 'midnight',
      uiDensity: 'compact',
      defaultShellProfileId: input.defaultShellProfileId ?? 'builtin-claude',
      autoStart: input.autoStart !== false,
      isActive: true,
      editorVisible: false,
      editorExpanded: false,
      editorWidthPercent: 40,
      reviewPanelVisible: false,
      reviewPanelExpanded: false,
      reviewPanelWidthPercent: 40,
      githubPanelVisible: false,
      githubPanelExpanded: false,
      githubPanelWidthPercent: 40,
      githubActiveTab: 'status',
      panes: []
    }
    workspace.panes = createMockPanes(workspace.id, layout)

    for (const item of workspaces) item.isActive = false
    workspaces.unshift(workspace)
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.setActive, (_event: IpcMainInvokeEvent, id: string) => {
    const workspace = workspaces.find((item) => item.id === id)
    if (!workspace) throw new Error(`Workspace ${id} not found`)
    for (const item of workspaces) item.isActive = item.id === id
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.delete, (_event: IpcMainInvokeEvent, id: string) => {
    const index = workspaces.findIndex((item) => item.id === id)
    if (index >= 0) workspaces.splice(index, 1)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.closePane, (_event: IpcMainInvokeEvent, paneId: string) => {
    for (const workspace of workspaces) {
      const before = workspace.panes.length
      workspace.panes = workspace.panes.filter((pane) => pane.id !== paneId)
      if (workspace.panes.length !== before) return workspace
    }
    return null
  })
  ipcMain.handle(IPC_CHANNELS.workspace.splitPane, (_event: IpcMainInvokeEvent, input: { paneId: string; direction?: 'vertical' | 'horizontal' }) => {
    const workspace = workspaces.find((item) => item.panes.some((pane) => pane.id === input.paneId))
    if (!workspace) throw new Error(`Pane ${input.paneId} not found`)
    const source = workspace.panes.find((pane) => pane.id === input.paneId)
    if (!source) throw new Error(`Pane ${input.paneId} not found`)
    const [rows, columns] = workspace.layout.split('x').map(Number)
    const targetRow = input.direction === 'horizontal' ? source.rowIndex + 1 : source.rowIndex
    const targetColumn = input.direction === 'horizontal' ? source.columnIndex : source.columnIndex + 1
    const nextLayout = input.direction === 'horizontal'
      ? `${Math.max(rows, targetRow + 1)}x${columns}` as WorkspaceLayout
      : `${rows}x${Math.max(columns, targetColumn + 1)}` as WorkspaceLayout
    workspace.layout = nextLayout
    workspace.layoutPreset = layoutToPreset(nextLayout)
    workspace.panes.push({
      id: randomUUID(),
      workspaceId: workspace.id,
      type: 'terminal',
      rowIndex: targetRow,
      columnIndex: targetColumn,
      shellProfileId: 'builtin-powershell',
      status: 'idle',
      agentProfileId: null,
      agentName: null,
      displayName: null,
      createdAt: null,
      rootPath: null
    })
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updatePaneType, (_event: IpcMainInvokeEvent, input: { paneId: string; type: Workspace['panes'][number]['type'] }) => {
    for (const workspace of workspaces) {
      const pane = workspace.panes.find((item) => item.id === input.paneId)
      if (pane) {
        pane.type = input.type
        pane.status = 'idle'
        return workspace
      }
    }
    throw new Error(`Pane ${input.paneId} not found`)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateEditorState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; editorVisible?: boolean; editorExpanded?: boolean; editorWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.editorVisible = input.editorVisible ?? workspace.editorVisible
    workspace.editorExpanded = input.editorExpanded ?? workspace.editorExpanded
    workspace.editorWidthPercent = input.editorWidthPercent ?? workspace.editorWidthPercent
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateReviewState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; reviewPanelVisible?: boolean; reviewPanelExpanded?: boolean; reviewPanelWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.reviewPanelVisible = input.reviewPanelVisible ?? workspace.reviewPanelVisible
    workspace.reviewPanelExpanded = input.reviewPanelExpanded ?? workspace.reviewPanelExpanded
    workspace.reviewPanelWidthPercent = input.reviewPanelWidthPercent ?? workspace.reviewPanelWidthPercent
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateGitHubState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; githubPanelVisible?: boolean; githubPanelExpanded?: boolean; githubPanelWidthPercent?: number; githubActiveTab?: Workspace['githubActiveTab'] }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.githubPanelVisible = input.githubPanelVisible ?? workspace.githubPanelVisible
    workspace.githubPanelExpanded = input.githubPanelExpanded ?? workspace.githubPanelExpanded
    workspace.githubPanelWidthPercent = input.githubPanelWidthPercent ?? workspace.githubPanelWidthPercent
    workspace.githubActiveTab = input.githubActiveTab ?? workspace.githubActiveTab
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateSettings, (_event: IpcMainInvokeEvent, input: { workspaceId: string; themeId?: Workspace['themeId']; uiDensity?: Workspace['uiDensity']; defaultShellProfileId?: string; layoutPreset?: WorkspaceLayoutPreset }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.themeId = input.themeId ?? workspace.themeId
    workspace.uiDensity = input.uiDensity ?? workspace.uiDensity
    workspace.defaultShellProfileId = input.defaultShellProfileId ?? workspace.defaultShellProfileId
    if (input.layoutPreset) {
      workspace.layoutPreset = input.layoutPreset
      workspace.layout = presetToLayout(input.layoutPreset)
      workspace.panes = createMockPanes(workspace.id, workspace.layout)
    }
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.setPaneAgent, (_event: IpcMainInvokeEvent, input: { paneId: string; agentProfileId: string | null }) => {
    for (const workspace of workspaces) {
      const pane = workspace.panes.find((item) => item.id === input.paneId)
      if (!pane) continue
      pane.agentProfileId = input.agentProfileId
      pane.agentName = input.agentProfileId === 'agent-copilot' ? 'Copilot' : input.agentProfileId === 'agent-claude' ? 'Claude' : null
      return workspace
    }
    throw new Error(`Pane ${input.paneId} not found`)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.pickFolder, () => null)
  ipcMain.handle(IPC_CHANNELS.terminal.start, (_event: IpcMainInvokeEvent, input: { paneId: string }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.terminal.onData, { paneId: input.paneId, data: 'PS> ' })
    }
  })
  ipcMain.handle(IPC_CHANNELS.terminal.write, (_event: IpcMainInvokeEvent, input: { paneId: string; data: string }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.terminal.onData, { paneId: input.paneId, data: input.data })
    }
  })
  ipcMain.handle(IPC_CHANNELS.terminal.resize, () => undefined)
  ipcMain.handle(IPC_CHANNELS.terminal.stop, () => undefined)
  ipcMain.handle(IPC_CHANNELS.terminal.restart, () => undefined)
  ipcMain.handle(IPC_CHANNELS.voice.transcribe, () => ({ text: '', durationMs: 0 }))
  ipcMain.handle(IPC_CHANNELS.voice.getModelStatus, () => ({ size: 'base', ready: false, path: '', engineReady: false }))
  ipcMain.handle(IPC_CHANNELS.voice.ensureModel, () => ({ size: 'base', ready: false, path: '', engineReady: false }))
  ipcMain.handle(IPC_CHANNELS.notifications.notify, () => false)
  ipcMain.handle(IPC_CHANNELS.oxe.detect, () => ({ installed: false, version: null }))
  ipcMain.handle(IPC_CHANNELS.oxe.status, () => ({ installed: false, version: null, isOxeProject: false, status: null, error: null }))
  ipcMain.handle(IPC_CHANNELS.oxe.openDashboard, () => ({ ok: false, error: null }))
  ipcMain.handle(IPC_CHANNELS.agent.list, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.discover, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.getReadiness, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.create, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agent.update, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agent.delete, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.list, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.create, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.update, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.delete, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.reorder, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.run, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.verify, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.executions, () => [])
  ipcMain.handle(IPC_CHANNELS.fs.listTree, () => [])
  ipcMain.handle(IPC_CHANNELS.fs.readFile, () => {
    throw new Error('File system API is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.fs.writeFile, () => {
    throw new Error('File system API is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.fs.watchFile, () => {
    throw new Error('File system API is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.fs.unwatchFile, () => undefined)
  ipcMain.handle(IPC_CHANNELS.github.getCliStatus, () => ({ available: false, authenticated: false, user: null, host: null, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.getWorkspaceStatus, (_event: IpcMainInvokeEvent, input: { workspaceId: string; rootPath: string }) => ({
    cli: { available: false, authenticated: false, user: null, host: null, message: 'E2E mock mode' },
    repository: { owner: null, name: null, fullName: null, url: null, isPrivate: null, defaultBranch: null, remoteName: null, remoteUrl: null, detected: false },
    isGitRepository: false,
    branch: null,
    lastCommit: null,
    lastCommitRelative: null,
    lastPushRelative: null,
    staged: 0,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    hasUncommittedChanges: false,
    workspaceId: input.workspaceId,
    rootPath: input.rootPath
  }))
  ipcMain.handle(IPC_CHANNELS.github.listBranches, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listPullRequests, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listCommits, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listReleases, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listWorkflows, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listWorkflowRuns, () => [])
  ipcMain.handle(IPC_CHANNELS.github.getWorkflowRunDetails, (_event: IpcMainInvokeEvent, input: { runId: number }) => ({
    databaseId: input.runId,
    name: 'E2E mock workflow',
    displayTitle: 'E2E mock workflow',
    status: 'completed',
    conclusion: 'success',
    event: 'workflow_dispatch',
    branch: 'main',
    actor: null,
    url: null,
    createdAt: new Date().toISOString(),
    jobs: []
  }))
  ipcMain.handle(IPC_CHANNELS.github.listCheckpoints, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listConnectedRepositories, () => [])
  ipcMain.handle(IPC_CHANNELS.github.fetch, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.stageAll, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.commit, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.push, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.commitAndPush, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createBranch, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.checkoutBranch, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createPullRequest, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createRelease, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.runWorkflow, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createCheckpoint, (_event: IpcMainInvokeEvent, input: { workspaceId: string; name: string; description?: string }) => ({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description ?? null,
    branch: null,
    baseCommit: null,
    patch: '',
    untrackedFiles: [],
    createdAt: Date.now()
  }))
  ipcMain.handle(IPC_CHANNELS.github.restoreCheckpoint, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.deleteCheckpoint, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.connectRepository, (_event: IpcMainInvokeEvent, input: { workspaceId: string; fullName: string; url?: string | null }) => ({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    fullName: input.fullName,
    url: input.url ?? null,
    createdAt: Date.now()
  }))
  const integrationGroups: Array<import('../../shared/types/integration').IntegrationGroup> = []
  const integrationHandoffs: Record<string, import('../../shared/types/integration').IntegrationHandoff[]> = {}
  ipcMain.handle(IPC_CHANNELS.integration.listGroups, () => integrationGroups)
  ipcMain.handle(IPC_CHANNELS.integration.createGroup, (_event: IpcMainInvokeEvent, input: { name: string; goal: string; description?: string | null; activeWorkspaceId?: string | null }) => {
    const now = Date.now()
    const group: import('../../shared/types/integration').IntegrationGroup = {
      id: randomUUID(),
      name: input.name,
      goal: input.goal,
      description: input.description ?? null,
      status: 'active',
      activeWorkspaceId: input.activeWorkspaceId ?? null,
      createdAt: now,
      updatedAt: now,
      members: []
    }
    integrationGroups.unshift(group)
    return group
  })
  ipcMain.handle(IPC_CHANNELS.integration.addMember, (_event: IpcMainInvokeEvent, input: { groupId: string; workspaceId: string; role: import('../../shared/types/integration').IntegrationRole; alias?: string | null; paneId?: string | null; rootPath?: string | null }) => {
    const group = integrationGroups.find((item) => item.id === input.groupId)
    if (!group) throw new Error('Integration group not found')
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    group.members.push({
      id: randomUUID(),
      groupId: group.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRootPath: workspace.rootPath,
      paneId: input.paneId ?? null,
      rootPath: input.rootPath ?? workspace.rootPath,
      role: input.role,
      alias: input.alias ?? input.role.toUpperCase(),
      branch: 'main',
      activeProvider: null,
      activeSessionId: null,
      lastIntent: null,
      lastResult: null,
      blockers: null,
      updatedAt: Date.now()
    })
    return group
  })
  ipcMain.handle(IPC_CHANNELS.integration.updateGroup, () => integrationGroups[0])
  ipcMain.handle(IPC_CHANNELS.integration.deleteGroup, () => undefined)
  ipcMain.handle(IPC_CHANNELS.integration.updateMember, () => integrationGroups[0])
  ipcMain.handle(IPC_CHANNELS.integration.removeMember, () => integrationGroups[0])
  ipcMain.handle(IPC_CHANNELS.integration.attachSession, () => ({ id: randomUUID(), updatedAt: Date.now() }))
  ipcMain.handle(IPC_CHANNELS.integration.listHandoffs, (_event: IpcMainInvokeEvent, groupId: string) => integrationHandoffs[groupId] ?? [])
  ipcMain.handle(IPC_CHANNELS.integration.createHandoff, (_event: IpcMainInvokeEvent, input: { groupId: string; fromMemberId: string; toMemberId: string; title: string; content: string; status?: 'draft' | 'sent' | 'saved' }) => {
    const handoff = { id: randomUUID(), groupId: input.groupId, fromMemberId: input.fromMemberId, toMemberId: input.toMemberId, title: input.title, content: input.content, status: input.status ?? 'draft', createdAt: Date.now() }
    integrationHandoffs[input.groupId] = [handoff, ...(integrationHandoffs[input.groupId] ?? [])]
    return handoff
  })
  ipcMain.handle(IPC_CHANNELS.integration.buildContext, (_event: IpcMainInvokeEvent, input: { groupId: string }) => {
    const group = integrationGroups.find((item) => item.id === input.groupId)
    return { groupId: input.groupId, text: group ? `# Integration context: ${group.name}\n\nGoal: ${group.goal}` : '' }
  })
}

function createMockPanes(workspaceId: string, layout: WorkspaceLayout): Workspace['panes'] {
  const [rows, columns] = layout.split('x').map(Number)
  return Array.from({ length: rows * columns }, (_, index) => {
    const rowIndex = Math.floor(index / columns)
    const columnIndex = index % columns
    return {
      id: randomUUID(),
      workspaceId,
      type: 'terminal',
      rowIndex,
      columnIndex,
      shellProfileId: 'builtin-claude',
      status: 'idle',
      agentProfileId: null,
      agentName: null,
      displayName: null,
      createdAt: null,
      rootPath: null
    }
  })
}

function presetToLayout(preset: WorkspaceLayoutPreset): WorkspaceLayout {
  const layouts: Record<WorkspaceLayoutPreset, WorkspaceLayout> = {
    1: '1x1',
    2: '1x2',
    4: '2x2',
    6: '2x3',
    8: '2x4',
    10: '2x5',
    12: '3x4',
    14: '2x7',
    16: '4x4'
  }
  return layouts[preset]
}

function layoutToPreset(layout: WorkspaceLayout): WorkspaceLayoutPreset {
  const preset = Object.entries({
    1: '1x1',
    2: '1x2',
    4: '2x2',
    6: '2x3',
    8: '2x4',
    10: '2x5',
    12: '3x4',
    14: '2x7',
    16: '4x4'
  }).find(([, value]) => value === layout)?.[0]
  return (Number(preset ?? 4) as WorkspaceLayoutPreset)
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown native startup error'
}

async function cleanupTempFile(filePath: string): Promise<void> {
  clipboardImageTempFiles.delete(filePath)
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(filePath)
  } catch {
    // Temp file may already be gone.
  }
}

function createMainWindow(): BrowserWindow {
  const iconPath = isDev
    ? join(process.cwd(), 'resources', 'icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'OXESpace',
    icon: iconPath,
    backgroundColor: '#0d0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox remains disabled while native PTY/SQLite packaging is bridged
      // through preload. Renderer isolation stays enabled; all privileged access
      // must pass validated IPC handlers.
      sandbox: false
    }
  })

  // `media` allows microphone for OXEVoice. `clipboard-read` / `clipboard-sanitized-write`
  // allow terminal Ctrl+V paste, which reads via navigator.clipboard.readText(). A
  // media-only handler silently denied clipboard-read, which is what broke paste.
  const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write'])
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isMainWindow = webContents === mainWindow.webContents
    const isMainFrame = details.isMainFrame !== false
    callback(isMainWindow && isMainFrame && ALLOWED_PERMISSIONS.has(permission))
  })
  // Some clipboard reads go through the synchronous check handler rather than
  // the async request handler; allow the same set there so Ctrl+V never stalls.
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    const isMainWindow = webContents === null || webContents === mainWindow.webContents
    return isMainWindow && ALLOWED_PERMISSIONS.has(permission)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Relax frame-blocking headers ONLY for sub-frames (the Web Preview iframe).
  // Sites like Google send `X-Frame-Options: SAMEORIGIN` / CSP
  // `frame-ancestors`, which makes the preview render blank. We scope the
  // strip to resourceType === 'subFrame' so OXESpace's own top-level document
  // keeps its CSP fully intact — only content the user explicitly loads into
  // the preview pane gets the relaxation. Acceptable for a local dev tool:
  // the user chose the URL, and OXESpace itself is never embedded by anyone.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame' || !details.responseHeaders) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const next: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(details.responseHeaders)) {
      const lower = key.toLowerCase()
      if (lower === 'x-frame-options') continue // drop entirely
      if (lower === 'content-security-policy') {
        // Keep the CSP but remove just the frame-ancestors directive that
        // would block embedding; leave script-src / connect-src / etc alone.
        const values = Array.isArray(value) ? value : [value]
        next[key] = values
          .map((v) => v.split(';').filter((d) => !d.trim().toLowerCase().startsWith('frame-ancestors')).join(';').trim())
          .filter((v) => v.length > 0)
        continue
      }
      next[key] = Array.isArray(value) ? value : [value]
    }
    callback({ responseHeaders: next })
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error('Renderer failed to load', { errorCode, errorDescription, validatedURL })
    if (isDev) console.error('[OXESpace] Renderer failed to load', { errorCode, errorDescription, validatedURL })
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone', details)
    if (isDev) console.error('[OXESpace] Renderer process gone', details)
  })
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (isDev && level >= 2) console.error(`[OXESpace renderer:${level}] ${message} (${sourceId}:${line})`)
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    console.log(`[OXESpace] Loading renderer ${rendererUrl}`)
    void mainWindow.loadURL(rendererUrl).catch((error) => {
      log.error('Renderer loadURL failed', error)
      console.error('[OXESpace] Renderer loadURL failed', error)
    })
  } else {
    const rendererFile = join(__dirname, '../renderer/index.html')
    void mainWindow.loadFile(rendererFile).catch((error) => {
      log.error('Renderer loadFile failed', error)
      if (isDev) console.error('[OXESpace] Renderer loadFile failed', error)
    })
  }

  return mainWindow
}

const gotLock = process.env.OXESPACE_DISABLE_SINGLE_INSTANCE === '1' || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    registerIpcHandlers()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
