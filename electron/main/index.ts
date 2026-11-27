import { app, BrowserWindow, clipboard, crashReporter, dialog, ipcMain, Notification, session } from 'electron'
import log from 'electron-log/main.js'
import { randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir, release, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bootstrapCoreServices, type DelegationHandleRef } from './bootstrap/core-services'
import { bootstrapInternalMcpAndAudit } from './bootstrap/internal-mcp-and-audit'
import { bootstrapWorkspaceServices } from './bootstrap/workspace-services'
import { openDatabaseWithMetadata, resolveAppDatabasePath, type AppDatabase } from './db/index'
import { e2eMocksEnabled } from './e2e/e2e-mode'
import { mainLanguage, systemLocale, tMain } from './i18n'
import { registerAppUpdateIpc, startAutoUpdater } from './ipc/app-update.ipc'
import { initialWindowColors, registerAppearanceIpc, savedUiScale } from './ipc/appearance.ipc'
import { registerBrowserPreviewIpc } from './ipc/browser-preview.ipc'
import { installIncidentHooks } from './ipc/diagnostics.ipc'
import { installIpcSenderGuard, trustAppWindow } from './ipc/ipc-sender-guard'
import { notificationsEnabled } from './ipc/notifications.ipc'
import { RendererRecoveryPolicy, showRendererGiveUp } from './renderer-recovery'
import type { RpcServerHandle } from './runtime/rpc/server'
import { removeLegacyAgentHooks } from './services/agent-hooks/legacy-cleanup'
import { APP_VERSION } from './services/app-info'
import { ApprovalNotifier } from './services/approvals/approval-notifier'
import { securePreviewGuest, securePreviewSession, WEB_PREVIEW_PARTITION_PREFIX } from './services/browser-preview-security'
import { configureExperimentalFeatures } from './services/experimental-features'
import { redactLogMessage } from './services/log-redaction'
import { recordRuntime, startRuntimeDiagnostics, stopRuntimeDiagnostics } from './services/runtime-diagnostics'
import { markAppReady, measureStartup, trackWindowStartup } from './startup-timing'
import { flushStorage } from './storage-flush'
import { singleInstanceDisabled } from './test-switches'
import { guardMainWindowLinks, isLoopbackHttpUrl } from './utils/external-open'
import { installCloseGuard } from './window-close-guard'
import { messageKey, messageValues } from '../../shared/messages'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { parseWindowsBuildNumber, WINDOWS_BUILD_ARG } from '../../shared/windows-pty'

installIpcSenderGuard() // B12: before any channel exists (markAppReady registers one ahead of registerIpcHandlers)
log.initialize()
log.transports.file.maxSize = 512 * 1024
log.hooks.push(redactLogMessage)
log.transports.console.level = false // the file already keeps the diagnostic; not duplicated into Linux syslog

// Local crash capture: minidumps in <userData>/Crashpad on a renderer/GPU/main crash; uploadToServer:false keeps
// them on-device (privacy). Must be called before `app` is ready.
try {
  crashReporter.start({ submitURL: '', uploadToServer: false, compress: true })
} catch (err) {
  log.warn('[main] crashReporter init failed:', err instanceof Error ? err.message : err)
}

// Global safety net: a stray throw or rejected promise in the main process must be logged (electron-log writes
// to userData/logs/main.log) rather than crash the app or vanish silently. These are last-resort catches —
// handlers should still deal with their own errors; this keeps a single bug from taking the app down.
let unexpectedErrorShown = false
process.on('uncaughtException', (error) => {
  log.error('[main] uncaughtException', error)
  recordRuntime('process-error', { kind: 'main', state: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) })
  // The app keeps running, but its state is no longer known: say so once, and offer a clean restart.
  if (unexpectedErrorShown || !app.isReady() || !app.isPackaged) return
  unexpectedErrorShown = true
  // B10: the app's modal when a window acknowledges it within 3 s; the system dialog otherwise (the window may be what broke).
  void Promise.all([import('./services/approvals'), import('./services/approvals/drafts')])
    .then(([{ approvalCenter }, { crashDraft }]) => approvalCenter.ask(crashDraft()))
    .then(outcome => { if (outcome.intent === 'allow') { app.relaunch(); app.quit() } }).catch(() => {})
})
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandledRejection', reason)
})

const isDev = !app.isPackaged
if (isDev && !process.env.OXESPACE_DB_PATH) {
  app.setPath('userData', join(app.getPath('appData'), 'oxespace-dev'))
}
let ipcRegistered = false
const clipboardImageTempFiles = new Set<string>()
const CLIPBOARD_IMAGE_TTL_MS = 30 * 60 * 1000

// Returns a `deferredInit` callback for non-critical, potentially slow startup
// work (internal MCP server: RPC port bind + .mcp.json rewrites across all
// workspaces). The caller runs it AFTER the main window is shown so the first
// paint isn't blocked behind it. No-op for the mock/native-failure paths.
async function registerIpcHandlers(): Promise<() => void> {
  const noop = (): void => {}
  if (ipcRegistered) return noop
  installIncidentHooks() // B8.3: a throwing handler or a crashed window becomes an incident; before any handler exists

  // Launched from a desktop icon, this process inherits the session PATH, not
  // the shell's — so agent CLIs under ~/.local/bin, ~/.npm-global/bin or a
  // version manager are invisible. Hydrate asynchronously so cold start and
  // ready-to-show are never blocked on a user's login profile (POSIX only).
  void import('./utils/login-shell-path').then(({ applyLoginShellPathAsync }) => applyLoginShellPathAsync()).then((recoveredPath) => {
    if (recoveredPath.length > 0) log.info(`[main] PATH recovered from login shell: +${recoveredPath.join(', ')}`)
  }).catch(() => undefined)

  // App update IPC is always registered (even on native failure / e2e mocks
  // below) so Settings and the update indicator keep working.
  registerAppUpdateIpc()
  registerAppearanceIpc()
  registerBrowserPreviewIpc()

  // T48: never in a packaged build, whatever the environment says (e2e/e2e-mode.ts).
  if (e2eMocksEnabled(process.env, app.isPackaged)) {
    if (process.env.OXESPACE_E2E_PREVIEW_SERVICE) {
      const { PreviewAutomation } = await import('./services/browser-preview/preview-automation')
      ;(globalThis as typeof globalThis & { preview: InstanceType<typeof PreviewAutomation> }).preview = new PreviewAutomation()
      // The spec revokes agent access from main while an approval modal blocks the window, as it does in the product.
      ;(globalThis as typeof globalThis & { previewService: unknown }).previewService = (await import('./services/browser-preview.service')).browserPreviewService
    }
    // Dynamic so the ~475 lines of E2E doubles land in their own chunk instead
    // of the main entry bundle. A normal launch never resolves this import.
    const { registerE2eMockIpcHandlers } = await import('./e2e/mock-ipc')
    registerE2eMockIpcHandlers()
    ipcRegistered = true
    return noop
  }

  // R0b: capture pre-migration version from the single SQLite open so export knows a 1.4 upgrade (1–91) from a fresh install (0).
  let db: AppDatabase
  let previousDbVersion: number
  try {
    ;({ db, previousVersion: previousDbVersion } = openDatabaseWithMetadata())
  } catch (error) {
    log.error('Native startup failed', error)
    // T87: one blocking screen with the reason, and no other handler behind it (startup-failure.ts).
    const { describeStartupFailure, registerStartupFailureIpc } = await import('./startup-failure')
    registerStartupFailureIpc(describeStartupFailure(error, resolveAppDatabasePath()))
    ipcRegistered = true
    return noop
  }
  // The window asks before it renders; a normal start answers that nothing failed.
  ipcMain.handle(IPC_CHANNELS.app.startupFailure, () => null)

  configureExperimentalFeatures(app.getPath('userData'))
  const delegationRef: DelegationHandleRef = {}
  const core = await bootstrapCoreServices({ db, rootExists: existsSync, delegationRef })
  const workspace = await bootstrapWorkspaceServices(core)
  ipcMain.handle(IPC_CHANNELS.clipboard.saveImageToTemp, async () => {
    const item = (await clipboard.read()).find(value => value.types.includes('image/png'))
    if (!item) return null
    const image = await item.getType('image/png')
    const filePath = join(tmpdir(), `oxe-paste-${randomUUID()}.png`)
    await writeFile(filePath, Buffer.from(await image.arrayBuffer()))
    clipboardImageTempFiles.add(filePath)
    const timer = setTimeout(() => {
      void cleanupTempFile(filePath)
    }, CLIPBOARD_IMAGE_TTL_MS)
    timer.unref?.()
    return filePath
  })
  const { DelegationService } = core
  const delegationService = new DelegationService(db, {
    workspace: workspace.internalMcpWorkspaceServ,
    git: workspace.internalMcpGithub,
    executions: core.executions,
    validateAgent: id => { workspace.launcher.resolve(id) },
    threadHost: workspace.threadDelegationHost,
    launch: task => workspace.launcher.launch(task),
    stop: paneId => core.terminalManager.stop({ paneId }),
    changed: (workspaceId, taskId) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.delegation.changed, { workspaceId, taskId })
      core.notifyAgentsChanged()
    }
    // R0d: no enrich. The delegated agent starts from the explicit handoff, evidence files and selected conversations.
  })
  delegationRef.current = delegationService

  const seenApprovalNotifications = new Map<string, Set<string>>()
  const approvalNotifier = new ApprovalNotifier({
    show: ({ title, body, actions, onAction }) => {
      if (!Notification.isSupported()) return { close: () => undefined }
      const lang = mainLanguage()
      const notification = new Notification({
        title: tMain(messageKey(title.code) as never, messageValues(title, lang)),
        body: tMain(messageKey(body.code) as never, messageValues(body, lang)),
        silent: false,
        actions: actions.map(action => ({ type: 'button', text: action === 'open' ? tMain('common.open' as never, { defaultValue: 'Open' }) : action }))
      })
      notification.on('click', () => onAction('open'))
      notification.on('action', (_event, index) => { const chosen = actions[index]; if (chosen) onAction(chosen) })
      notification.show()
      return { close: () => notification.close() }
    },
    focused: () => BrowserWindow.getAllWindows().some(win => !win.isDestroyed() && win.isFocused()),
    enabled: notificationsEnabled,
    focusWindow: () => {
      const win = BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    },
    openRequest: requestId => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.approvals.openRequest, requestId)
    }
  })
  workspace.delegatedThreadObserver.current = thread => {
    delegationService.observeThread(thread)
    try {
      const pending = core.agentThreadHistory.pendingRequestsOf(thread.id) // OXE-413: not the whole window on every change
      const previous = seenApprovalNotifications.get(thread.id) ?? new Set<string>()
      const current = new Set<string>()
      for (const req of pending) {
        if (req.state !== 'pending') continue
        current.add(req.id)
        if (!previous.has(req.id)) {
          approvalNotifier.pending({
            requestId: req.id,
            threadId: thread.id,
            agent: thread.provider === 'codex' ? 'Codex' : thread.provider === 'antigravity' ? 'Antigravity' : 'Claude',
            pane: thread.title || 'Chat',
            risk: req.impact?.risk ?? 'medium',
            title: req.title
          })
        }
      }
      for (const oldId of previous) if (!current.has(oldId)) approvalNotifier.resolved(oldId)
      seenApprovalNotifications.set(thread.id, current)
    } catch { /* notification bookkeeping never blocks thread observation */ }
  }
  core.registerDelegationIpc(delegationService)

  const { internalMcp, runDataExport } = await bootstrapInternalMcpAndAudit({ core, workspace, delegationService, previousDbVersion })
  let memoryShutdownComplete = false
  let memoryShutdownStarted = false
  app.on('before-quit', (event) => {
    if (memoryShutdownComplete) return
    event.preventDefault()
    if (memoryShutdownStarted) return
    memoryShutdownStarted = true
    const detachOnQuit = Boolean(core.ptyDaemon) && core.terminalManager.quitBehavior() === 'detach'
    const terminalsDrained = detachOnQuit
      ? core.terminalManager.detachForQuit()
      : core.terminalManager.stopAllAndDrain() // OXE-392/OXE-447: detach daemon PTYs or drain all exits before teardown
    // Quitting can still stall after the drain, for example on a native handle a terminal left
    // open on Windows; the window is gone by then, so end the process instead of lingering.
    const quit = (): void => {
      app.quit()
      setTimeout(() => app.exit(0), 5000).unref()
    }
    // An optional service or a long-running MCP request must not trap app shutdown.
    const shutdownDeadline = setTimeout(() => {
      memoryShutdownComplete = true
      quit()
    }, 10000)
    void Promise.allSettled([terminalsDrained, flushStorage(session.defaultSession), workspace.threadManager.stop(), delegationService?.stop(), core.androidDevices.stopOwned()]).then(() => internalMcp.stop()).catch(() => {}).finally(() => {
      clearTimeout(shutdownDeadline)
      if (memoryShutdownComplete) return
      memoryShutdownComplete = true
      quit()
    })
  })
  app.once('before-quit', () => {
    for (const filePath of clipboardImageTempFiles) void cleanupTempFile(filePath)
    workspace.fileSystemService.closeAll()
    if (!(Boolean(core.ptyDaemon) && core.terminalManager.quitBehavior() === 'detach')) {
      core.terminalManager.stopAll()
    }
    workspace.backgroundManager.stopAll()
    workspace.skillService.dispose()
    workspace.mcpManager.stopAll()
    workspace.oxeService.disposeAll()
    void core.hostsProxy.stop()
    // Keep the hook metadata bridge alive for the bounded memory shutdown drain.
    void rpcServer?.stop()
  })
  ipcRegistered = true
  // Deferred until after the window is shown — all of this is non-critical for
  // first paint and was previously blocking it (sync .mcp.json rewrites, skill
  // folder scan, orphan-job UPDATE, RPC port bind). Order matters: primeConfigs()
  // writes each workspace's .mcp.json from the table; internalMcp.start() then
  // rewrites its own row with the live port last.
  return () => {
    workspace.mcpManager.primeConfigs()
    workspace.skillService.init()
    workspace.backgroundManager.init()
    void internalMcp.start()
    // R0b: the one-time export of the removed features' data, after the window shows; it never throws.
    void runDataExport()
    void removeLegacyAgentHooks({
      claudeSettings: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'),
      codexHooks: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json'),
      memoryAdapters: join(app.getPath('userData'), 'memory', 'adapters')
    })
    // F3 · Local RPC bus (named pipe / unix socket). Out-of-process callers
    // (CLI now, orchestration coordinator later) reach the same services the
    // renderer reaches over IPC. Failure here must not affect the app.
    void import('./runtime/rpc/server')
      .then(({ startRpcServer }) => startRpcServer({
        db,
        gitHubService: workspace.gitHubService,
        appVersion: APP_VERSION,
        userDataPath: app.getPath('userData'),
        onError: (error) => log.warn('[rpc] transport error:', error.message)
      }))
      .then((handle) => {
        rpcServer = handle
        log.info(`[rpc] listening on ${handle.endpoint}`)
      })
      .catch((error: unknown) => log.warn('[rpc] failed to start:', toMessage(error)))
    void startAutoUpdater(undefined, (message) => log.warn('[updater] failed to load:', message))
  }
}

/** Live RPC bus handle, closed on app shutdown. */
let rpcServer: RpcServerHandle | null = null

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

  // The renderer draws its own title bar (menu bar, context, update state), so
  // the OS frame is hidden. Windows/Linux keep the native caption buttons through
  // the overlay (transparent so the themed title bar shows through); macOS keeps
  // its traffic lights inset and its native application menu.
  const frameOptions: Partial<Electron.BrowserWindowConstructorOptions> = process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset' }
    : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: initialWindowColors().symbols, height: 36 } }

  const winBuild = process.platform === 'win32' ? parseWindowsBuildNumber(release()) : undefined
  const mainWindow = trustAppWindow(new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'OXESpace',
    icon: iconPath,
    backgroundColor: initialWindowColors().background,
    ...frameOptions,
    webPreferences: {
      preload: join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload bundle only uses Electron's contextBridge/IPC subset, so it
      // remains compatible with Chromium's renderer sandbox. Native PTY/SQLite
      // stay exclusively in the main process behind validated IPC handlers.
      sandbox: true,
      // No <webview> (B12): the Browser preview and Design Mode run in a main-process WebContentsView.
      webviewTag: false, // the will-attach-webview handler below stays as a backstop
      zoomFactor: savedUiScale(),
      // A sandboxed preload cannot ask app.getLocale() or os.release(), so the default interface language and Windows build travel as arguments.
      additionalArguments: [
        `--oxe-locale=${systemLocale()}`,
        ...(process.env.OXESPACE_TERM_LEVERS ? [`--oxe-term-levers=${process.env.OXESPACE_TERM_LEVERS}`] : []),
        ...(winBuild ? [`${WINDOWS_BUILD_ARG}${winBuild}`] : [])
      ] // OXE-411 levers (H,Q default unless set) + OXE-436 ConPTY buildNumber
    }
  }))

  if (process.platform !== 'darwin') mainWindow.setMenuBarVisibility(false)

  // Hard gate on <webview> attachment: the guest may only ever load our own
  // design-guest preload, never with node integration, and always sandboxed.
  // Without this, a compromised renderer could attach a privileged guest.
  const DESIGN_GUEST_PRELOAD = join(app.getAppPath(), 'out', 'preload', 'design-guest.cjs')
  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    webPreferences.preload = DESIGN_GUEST_PRELOAD
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Each Code workspace or Thread conversation gets an in-memory profile.
    // Never accept a persistent or application partition from the renderer.
    if (!params.partition?.startsWith(WEB_PREVIEW_PARTITION_PREFIX) || !/^[a-zA-Z0-9:-]{1,100}$/.test(params.partition.slice(WEB_PREVIEW_PARTITION_PREFIX.length))) {
      params.partition = `${WEB_PREVIEW_PARTITION_PREFIX}${randomUUID()}`
    }
    securePreviewSession(session.fromPartition(params.partition))
    // Popups stay off; the iframe this replaced could not open windows either.
    // (webview params are the raw attribute strings — absent means disabled.)
    delete params.allowpopups
    // Only http(s) guests: no file:, no about:, no custom schemes.
    if (!/^https?:$/i.test(safeProtocol(params.src))) {
      params.src = 'about:blank'
    }
  })

  // The <webview> guest carries the old sandboxed iframe's restrictions explicitly (they are not defaults), in its
  // own in-memory partition. It is not trusted by the IPC sender guard: no channel answers it.
  // A guest must not be able to spawn windows; external links go to the OS browser.
  mainWindow.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    securePreviewGuest(guestWebContents)
  })

  // `clipboard-read` / `clipboard-sanitized-write` allow terminal Ctrl+V paste, which reads via navigator.clipboard.readText(). A
  // handler without them silently denied clipboard-read, which is what broke paste. No `media`: nothing in the window
  // uses the microphone or camera since OXEVoice left (B21), so a request for them is denied.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])
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
  installCloseGuard(mainWindow) // F26: ask the window before it closes or the app quits

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

  // The window that holds the preload API only ever shows the app itself, and opens nothing on its own: a link leaves
  // through app:open-external, after the person confirmed its host. The rest is denied and journalled.
  const appUrl = isDev && process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).origin
    : pathToFileURL(join(app.getAppPath(), 'out', 'renderer', 'index.html')).href
  guardMainWindowLinks(mainWindow.webContents, appUrl)

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    log.error('Renderer failed to load', { errorCode, errorDescription, validatedURL })
    if (isDev) console.error('[OXESpace] Renderer failed to load', { errorCode, errorDescription, validatedURL })
  })
  const rendererRecovery = new RendererRecoveryPolicy()
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    recordRuntime('renderer-gone', { kind: 'Renderer', state: details.reason, exitCode: details.exitCode })
    log.error('Renderer process gone', details)
    if (isDev) console.error('[OXESpace] Renderer process gone', details)
    // Terminals live in the main process, so a reloaded window reattaches to them.
    const next = rendererRecovery.decide(details.reason)
    if (next === 'reload' && !mainWindow.isDestroyed()) {
      setTimeout(() => { if (!mainWindow.isDestroyed()) mainWindow.webContents.reload() }, 250)
    } else if (next === 'give-up' && !mainWindow.isDestroyed()) {
      void showRendererGiveUp(mainWindow, { app, t: tMain, show: options => dialog.showMessageBox(mainWindow, options) })
    }
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

// T50: a packaged build allows a second instance only on its own --user-data-dir (test-switches.ts).
const gotLock = singleInstanceDisabled({
  env: process.env,
  isPackaged: app.isPackaged,
  userDataDirSwitch: app.commandLine.getSwitchValue('user-data-dir'),
  defaultUserData: () => join(app.getPath('appData'), app.getName()),
  realpath: realpathSync.native,
}) || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  const diagnosticsDir = join(app.getPath('userData'), 'diagnostics')
  startRuntimeDiagnostics(diagnosticsDir, APP_VERSION)
  app.on('child-process-gone', (_event, details) => {
    recordRuntime('child-gone', { kind: details.type, state: details.reason, exitCode: details.exitCode })
  })
  app.once('will-quit', stopRuntimeDiagnostics)
  app.whenReady().then(async () => {
    // Awaited so every handler is registered before the renderer can invoke one. Each step is timed
    // (startup-timing.ts) up to the renderer reporting its first screen.
    markAppReady()
    const deferredInit = await measureStartup('ipc-handlers', registerIpcHandlers)
    const mainWindow = trackWindowStartup(measureStartup('window-create', createMainWindow))
    // Kick off the heavy, non-critical startup work once the window is painting. Idempotent + fallback: if ready-to-show
    // never fires (load failure, render-process-gone, slow first paint), a 3s timer still runs the deferred init so the
    // internal MCP server / config sync always start. setImmediate yields so the first frame lands before the heavy work.
    let kicked = false
    const kick = (): void => {
      if (kicked) return
      kicked = true
      setImmediate(() => measureStartup('deferred-init', deferredInit))
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
