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
import { registerUsageIpc } from './ipc/usage.ipc'
import { registerBackgroundIpc } from './ipc/background.ipc'
import { registerSessionIpc } from './ipc/session.ipc'
import { broadcastSkillChange, registerSkillIpc } from './ipc/skill.ipc'
import { broadcastMcpHealth, registerMcpIpc } from './ipc/mcp.ipc'
import { SkillService } from './services/skill.service'
import { McpManager } from './services/mcp.service'
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
  registerUsageIpc()
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
  const fileSystemService = registerFileSystemIpc()
  app.once('before-quit', () => {
    for (const filePath of clipboardImageTempFiles) void cleanupTempFile(filePath)
    fileSystemService.closeAll()
    terminalManager.stopAll()
    backgroundManager.stopAll()
    skillService.dispose()
    mcpManager.stopAll()
  })
  ipcRegistered = true
}

function registerNativeFailureIpcHandlers(message: string): void {
  const shellProfiles: ShellProfile[] = [
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
  // Wave 2-6 channels — degrade gracefully so the renderer doesn't spam
  // "No handler registered" errors when native startup failed. Listing channels
  // return empty data; mutating channels throw via `fail` so the user sees the
  // root cause in any action they try.
  ipcMain.handle(IPC_CHANNELS.usage.getContextUsage, () => null)
  ipcMain.handle(IPC_CHANNELS.usage.getSnapshotFor, () => null)
  ipcMain.handle(IPC_CHANNELS.usage.supportedProviders, () => [])
  ipcMain.handle(IPC_CHANNELS.usage.listSessions, () => [])
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
  ipcMain.handle(IPC_CHANNELS.workspace.updateBackgroundState, fail)
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
      workspace.panes = workspace.panes.filter((pane) => pane.id !== paneId)
    }
  })
  ipcMain.handle(IPC_CHANNELS.workspace.splitPane, (_event: IpcMainInvokeEvent, input: { paneId: string }) => {
    const workspace = workspaces.find((item) => item.panes.some((pane) => pane.id === input.paneId))
    if (!workspace) throw new Error(`Pane ${input.paneId} not found`)
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
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
