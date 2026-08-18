import { app, BrowserWindow, clipboard, crashReporter, dialog, ipcMain, session, shell } from 'electron'
import log from 'electron-log/main.js'
import { initAutoUpdater, registerAppUpdateIpc } from './updater'
import { getRtkService } from './services/rtk.service'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './db/index'
import { registerAgentIpc } from './ipc/agent.ipc'
import { registerFileSystemIpc } from './ipc/file-system.ipc'
import { registerGitIpc } from './ipc/git.ipc'
import { registerSearchIpc } from './ipc/search.ipc'
import { registerGitHubIpc } from './ipc/github.ipc'
import { registerLinearIpc } from './ipc/linear.ipc'
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
import { registerAgentCreditsIpc } from './ipc/agentCredits.ipc'
import { registerContextUsageIpc } from './ipc/contextUsage.ipc'
import { registerOxeContextIpc } from './ipc/oxe-context.ipc'
import { SkillService } from './services/skill.service'
import { McpManager } from './services/mcp.service'
import { WorkspaceService } from './services/workspace.service'
import { GitHubService } from './services/github.service'
import { GitService } from './services/git.service'
import { SemanticService } from './services/semantic.service'
import { CodeGraphService } from './services/codegraph.service'
import { createInternalMcpHandle, type InternalMcpHandle } from './mcp-internal/bootstrap'
import { startRpcServer, type RpcServerHandle } from './runtime/rpc/server'
import { registerTaskIpc } from './ipc/task.ipc'
import { registerTerminalIpc } from './ipc/terminal.ipc'
import { registerWorkspaceIpc } from './ipc/workspace.ipc'
import { registerSemanticIpc } from './ipc/semantic.ipc'
import { registerDiagnosticsIpc } from './ipc/diagnostics.ipc'
import { BackgroundManager } from './services/background.service'
import { TerminalManager } from './services/terminal.service'
import { fallbackShellProfiles } from './services/shell-profile.defaults'
import { isLoopbackHttpUrl, isSafeExternalUrl } from './utils/external-url'
import { applyLoginShellPath } from './utils/login-shell-path'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { ShellProfile } from '../../shared/types/workspace'

log.initialize()

// Local crash capture: writes minidumps to <userData>/Crashpad on a renderer/GPU/
// main crash. uploadToServer:false keeps them on-device (privacy) — a future
// telemetry endpoint can flip this. Must be called before `app` is ready.
try {
  crashReporter.start({ submitURL: '', uploadToServer: false, compress: true })
} catch (err) {
  log.warn('[main] crashReporter init failed:', err instanceof Error ? err.message : err)
}

// Global safety net: a stray throw or rejected promise in the main process must
// be logged (electron-log writes to userData/logs/main.log) rather than crash the
// app or vanish silently. These are last-resort catches — handlers should still
// deal with their own errors; this just keeps a single bug from taking the app
// down and gives us a forensic trail.
process.on('uncaughtException', (error) => {
  log.error('[main] uncaughtException', error)
})
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandledRejection', reason)
})

const isDev = !app.isPackaged
if (isDev) {
  app.setPath('userData', join(app.getPath('appData'), 'oxespace-dev'))
}
let ipcRegistered = false
/** In-memory session for Web Preview guests — isolated from the app's own. */
const WEB_PREVIEW_PARTITION = 'oxe-webpreview'
const clipboardImageTempFiles = new Set<string>()
const CLIPBOARD_IMAGE_TTL_MS = 30 * 60 * 1000

// Returns a `deferredInit` callback for non-critical, potentially slow startup
// work (internal MCP server: RPC port bind + .mcp.json rewrites across all
// workspaces). The caller runs it AFTER the main window is shown so the first
// paint isn't blocked behind it. No-op for the mock/native-failure paths.
async function registerIpcHandlers(): Promise<() => void> {
  const noop = (): void => {}
  if (ipcRegistered) return noop

  // Launched from a desktop icon, this process inherits the session PATH, not
  // the shell's — so agent CLIs under ~/.local/bin, ~/.npm-global/bin or a
  // version manager are invisible. Recover it before anything reads PATH:
  // provider discovery and the first auto-started agent pane both do, and an
  // agent is exec'd directly rather than through a shell, so nothing else
  // would ever source a profile on its behalf. One shell spawn, POSIX only.
  const recoveredPath = applyLoginShellPath()
  if (recoveredPath.length > 0) {
    log.info(`[main] PATH recovered from login shell: +${recoveredPath.join(', ')}`)
  }

  // App update + RTK sidecar IPC are always registered (even on native failure
  // / e2e mocks below) so Settings and the update banner keep working.
  registerAppUpdateIpc()
  registerRtkIpc()

  if (process.env.OXESPACE_E2E_MOCK_NATIVE === '1') {
    // Dynamic so the ~475 lines of E2E doubles land in their own chunk instead
    // of the main entry bundle. A normal launch never resolves this import.
    const { registerE2eMockIpcHandlers } = await import('./e2e/mock-ipc')
    registerE2eMockIpcHandlers()
    ipcRegistered = true
    return noop
  }

  let db: ReturnType<typeof openDatabase>
  try {
    db = openDatabase()
  } catch (error) {
    log.error('Native startup failed', error)
    registerNativeFailureIpcHandlers(toMessage(error))
    ipcRegistered = true
    return noop
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
    },
    // Detached sessions send this instead of their output, so the sidebar and
    // notifications still reflect a background agent without shipping bytes
    // that no view would render.
    emitActivity: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onActivity, event)
      }
    },
    userDataPath: app.getPath('userData')
  })
  
  // Semantic search service. emitLog broadcasts each activity-log line to every
  // renderer window so Tools → Semantic Activity can show processing live.
  const semanticService = new SemanticService(db, {
    emitLog: (entry) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.semantic.onLog, entry)
      }
    }
  })

  registerWorkspaceIpc(db, semanticService, terminalManager)
  registerSemanticIpc(semanticService)
  registerTerminalIpc(terminalManager)
  registerAgentIpc(db)
  registerTaskIpc(db, terminalManager)
  registerGitIpc()
  registerSearchIpc()
  const gitHubService = registerGitHubIpc(db)
  registerLinearIpc(db, gitHubService)
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
    const value = typeof text === 'string' ? text : ''
    try {
      clipboard.writeText(value)
      // Electron's write is synchronous, but verify it instead of claiming
      // success unconditionally. Normalize CRLF because the Windows clipboard
      // may canonicalize line endings while preserving the copied text.
      const normalize = (input: string): string => input.replace(/\r\n/g, '\n')
      return normalize(clipboard.readText()) === normalize(value)
    } catch {
      return false
    }
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
  registerAgentCreditsIpc()
  registerContextUsageIpc()
  const oxeService = registerOxeIpc()
  const fileSystemService = registerFileSystemIpc(db)
  // Internal oxespace MCP server — auto-starts on app boot, registers a
  // global row in mcp_servers, syncs to every workspace's .mcp.json. The
  // bridge script lives under <userData>/bin/ and is spawned by each
  // agent CLI separately (Claude Code, Copilot, …). See plan section 3.
  const internalMcpWorkspaceServ = new WorkspaceService(db)
  const internalMcpGithub = new GitHubService(db)
  const internalMcpGit = new GitService()
  const codeGraphService = new CodeGraphService(db)

  const internalMcp: InternalMcpHandle = createInternalMcpHandle({
    db,
    mcpManager,
    workspaceServ: internalMcpWorkspaceServ,
    github: internalMcpGithub,
    background: backgroundManager,
    fileSystem: fileSystemService,
    semantic: semanticService,
    codegraph: codeGraphService
  })
  registerMcpInternalIpc(internalMcp)
  registerDiagnosticsIpc(db, internalMcp)
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
    semanticService.destroy()
    void internalMcp.stop()
    void rpcServer?.stop()
  })
  ipcRegistered = true
  // Deferred until after the window is shown — all of this is non-critical for
  // first paint and was previously blocking it (sync .mcp.json rewrites, skill
  // folder scan, orphan-job UPDATE, RPC port bind). Order matters: primeConfigs()
  // writes each workspace's .mcp.json from the table; internalMcp.start() then
  // rewrites its own row with the live port last.
  return () => {
    mcpManager.primeConfigs()
    skillService.init()
    backgroundManager.init()
    void internalMcp.start()
    // F3 · Local RPC bus (named pipe / unix socket). Out-of-process callers
    // (CLI now, orchestration coordinator later) reach the same services the
    // renderer reaches over IPC. Failure here must not affect the app.
    void startRpcServer({
      db,
      gitHubService,
      appVersion: app.getVersion(),
      userDataPath: app.getPath('userData'),
      onError: (error) => log.warn('[rpc] transport error:', error.message)
    })
      .then((handle) => {
        rpcServer = handle
        log.info(`[rpc] listening on ${handle.endpoint}`)
      })
      .catch((error: unknown) => log.warn('[rpc] failed to start:', toMessage(error)))
    initAutoUpdater()
  }
}

/** Live RPC bus handle, closed on app shutdown. */
let rpcServer: RpcServerHandle | null = null

function registerNativeFailureIpcHandlers(message: string): void {
  const shellProfiles: ShellProfile[] = fallbackShellProfiles()
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
  ipcMain.handle(IPC_CHANNELS.terminal.attach, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.detach, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.status, fail)
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
  ipcMain.handle(IPC_CHANNELS.semantic.getStatus, () => ({ enabled: false, workerReady: false, indexing: false, count: 0, lastError: 'native startup failed', mode: 'auto', coverage: { lexicalDocuments: 0, lastIndexedAt: null, byCategory: { source: 0, test: 0, config: 0, docs: 0, other: 0 } }, lastQuery: null }))
  ipcMain.handle(IPC_CHANNELS.semantic.setEnabled, () => ({ enabled: false, workerReady: false, indexing: false, count: 0, lastError: 'native startup failed', mode: 'auto', coverage: { lexicalDocuments: 0, lastIndexedAt: null, byCategory: { source: 0, test: 0, config: 0, docs: 0, other: 0 } }, lastQuery: null }))
  ipcMain.handle(IPC_CHANNELS.semantic.setMode, () => ({ enabled: false, workerReady: false, indexing: false, count: 0, lastError: 'native startup failed', mode: 'auto', coverage: { lexicalDocuments: 0, lastIndexedAt: null, byCategory: { source: 0, test: 0, config: 0, docs: 0, other: 0 } }, lastQuery: null }))
  ipcMain.handle(IPC_CHANNELS.semantic.getLogs, () => [])
  ipcMain.handle(IPC_CHANNELS.diagnostics.getSnapshot, () => ({
    generatedAt: Date.now(), appVersion: app.getVersion(), platform: process.platform, arch: process.arch,
    nodeVersion: process.versions.node, electronVersion: process.versions.electron ?? 'unknown', workspaceCount: 0,
    checks: [{ id: 'native', label: 'Native runtime', tone: 'error', detail: message }]
  }))
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportReport, () => null)
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

function registerRtkIpc(): void {
  const rtk = getRtkService(app.getPath('userData'))
  ipcMain.handle(IPC_CHANNELS.rtk.getStatus, () => rtk.getStatus())
  ipcMain.handle(IPC_CHANNELS.rtk.checkForUpdate, () => rtk.checkForUpdate(true))
  ipcMain.handle(IPC_CHANNELS.rtk.updateToLatest, async () => {
    try {
      return await rtk.updateToLatest()
    } catch (err) {
      // Surface structured status with error rather than rejecting — UI can show it.
      return rtk.getStatus()
    }
  })
}

/** Protocol of a URL, or empty when it cannot be parsed. */
function safeProtocol(value: string | undefined): string {
  if (!value) return ''
  try {
    return new URL(value).protocol
  } catch {
    return ''
  }
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
  // Windows wants the multi-resolution .ico; Linux/macOS cannot read it and
  // would silently fall back to Electron's default icon, so they get the PNG.
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = isDev
    ? join(process.cwd(), 'resources', iconFile)
    : join(process.resourcesPath, iconFile)

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
      preload: join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload bundle only uses Electron's contextBridge/IPC subset, so it
      // remains compatible with Chromium's renderer sandbox. Native PTY/SQLite
      // stay exclusively in the main process behind validated IPC handlers.
      sandbox: true,
      // Design Mode (#3) needs a <webview> — an iframe cannot be scripted
      // cross-origin, so element picking is impossible there. Every attach is
      // vetted by the will-attach-webview handler below.
      webviewTag: true
    }
  })

  // Hard gate on <webview> attachment: the guest may only ever load our own
  // design-guest preload, never with node integration, and always sandboxed.
  // Without this, a compromised renderer could attach a privileged guest.
  const DESIGN_GUEST_PRELOAD = join(app.getAppPath(), 'out', 'preload', 'design-guest.cjs')
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    webPreferences.preload = DESIGN_GUEST_PRELOAD
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Pinned here, not trusted from the renderer: the guest must land in the
    // locked-down preview session, never the app's own.
    params.partition = WEB_PREVIEW_PARTITION
    // Popups stay off; the iframe this replaced could not open windows either.
    // (webview params are the raw attribute strings — absent means disabled.)
    delete params.allowpopups
    // Only http(s) guests: no file:, no about:, no custom schemes.
    if (!/^https?:$/i.test(safeProtocol(params.src))) {
      params.src = 'about:blank'
    }
  })

  // The <webview> replaced a `sandbox`ed, `no-referrer` iframe, so its guest has
  // to carry the same restrictions explicitly — they are not defaults. The guest
  // runs in its own in-memory partition, which also keeps preview cookies and
  // storage out of the app's session.
  const previewSession = session.fromPartition(WEB_PREVIEW_PARTITION)
  previewSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  previewSession.setPermissionCheckHandler(() => false)
  previewSession.on('will-download', (event) => event.preventDefault())
  previewSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    delete requestHeaders.Referer
    delete requestHeaders.referer
    callback({ requestHeaders })
  })

  // A guest must not be able to spawn windows; external links go to the OS browser.
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    guestWebContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
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

  // Relax frame-blocking headers only for loopback development servers. Remote
  // sites retain their X-Frame-Options/frame-ancestors policy even when the user
  // explicitly enables external preview mode in the renderer.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame' || !details.responseHeaders || !isLoopbackHttpUrl(details.url)) {
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
    const rendererFile = join(app.getAppPath(), 'out', 'renderer', 'index.html')
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
  app.whenReady().then(async () => {
    // Awaited so every handler is registered before the renderer can invoke
    // one. In the normal path this costs a microtask; only the E2E mock path
    // actually resolves a module here.
    const deferredInit = await registerIpcHandlers()
    const mainWindow = createMainWindow()
    // Kick off the heavy, non-critical startup work once the window is painting.
    // Idempotent + fallback: if ready-to-show never fires (renderer fails to load,
    // render-process-gone, or a slow first paint), a 3s timer still runs the
    // deferred init so the internal MCP server / config sync don't silently never
    // start. setImmediate yields so the first frame lands before the heavy work.
    let kicked = false
    const kick = (): void => {
      if (kicked) return
      kicked = true
      setImmediate(deferredInit)
    }
    mainWindow.once('ready-to-show', kick)
    const fallbackTimer = setTimeout(kick, 3000)
    fallbackTimer.unref?.()

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
