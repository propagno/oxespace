import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { openDatabase } from './db/index'
import { registerAgentIpc } from './ipc/agent.ipc'
import { registerFileSystemIpc } from './ipc/file-system.ipc'
import { registerTaskIpc } from './ipc/task.ipc'
import { registerTerminalIpc } from './ipc/terminal.ipc'
import { registerWorkspaceIpc } from './ipc/workspace.ipc'
import { TerminalManager } from './services/terminal.service'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { ShellProfile, Workspace, WorkspaceLayout, WorkspaceLayoutPreset } from '../../shared/types/workspace'

log.initialize()

const isDev = !app.isPackaged
let ipcRegistered = false

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
  const fileSystemService = registerFileSystemIpc()
  app.once('before-quit', () => {
    fileSystemService.closeAll()
    terminalManager.stopAll()
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
      status: 'idle'
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
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
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
