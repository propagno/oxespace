import { app, BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log/main.js'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { AppUpdateState, AppUpdateStatus } from '../../shared/types/updater'

/**
 * Auto-update via electron-updater against GitHub Releases (electron-builder
 * `publish` field). Behavior:
 * - No-op status in unpackaged/dev builds (UI shows "disabled").
 * - Checks once shortly after startup, then every few hours.
 * - Downloads in the background; installs on quit or when the user clicks
 *   "Restart to update".
 * - Never throws into the app lifecycle — failures only log + update state.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

type AutoUpdater = typeof import('electron-updater').autoUpdater

let autoUpdaterRef: AutoUpdater | null = null
let state: AppUpdateState = {
  status: app.isPackaged ? 'idle' : 'disabled',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  error: null,
  lastCheckedAt: null
}

function setState(partial: Partial<AppUpdateState>): void {
  state = { ...state, ...partial, currentVersion: app.getVersion() }
  broadcast()
}

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.app.onUpdateState, state)
    }
  }
}

export function getAppUpdateState(): AppUpdateState {
  return { ...state, currentVersion: app.getVersion() }
}

export async function checkForAppUpdates(manual = false): Promise<AppUpdateState> {
  if (!app.isPackaged || !autoUpdaterRef) {
    setState({
      status: 'disabled',
      error: app.isPackaged ? 'Updater not initialized' : 'Updates only run in installed builds',
      lastCheckedAt: Date.now()
    })
    return getAppUpdateState()
  }
  if (state.status === 'downloading' || state.status === 'downloaded') {
    return getAppUpdateState()
  }
  setState({ status: 'checking', error: null })
  try {
    const result = await autoUpdaterRef.checkForUpdates()
    // Event handlers usually set available/not-available; if check returns null
    // (rate limit / no feed), keep a soft not-available unless manual.
    if (!result && state.status === 'checking') {
      setState({
        status: 'not-available',
        lastCheckedAt: Date.now(),
        error: manual ? 'No update information returned' : null
      })
    }
  } catch (err) {
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      lastCheckedAt: Date.now()
    })
  }
  return getAppUpdateState()
}

export function quitAndInstallUpdate(): boolean {
  if (!autoUpdaterRef || state.status !== 'downloaded') return false
  try {
    // isSilent=false, isForceRunAfter=true — restart into the new version.
    autoUpdaterRef.quitAndInstall(false, true)
    return true
  } catch (err) {
    log.warn('[updater] quitAndInstall failed', err)
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
    return false
  }
}

export function registerAppUpdateIpc(): void {
  ipcMain.handle(IPC_CHANNELS.app.getUpdateState, () => getAppUpdateState())
  ipcMain.handle(IPC_CHANNELS.app.checkForUpdates, () => checkForAppUpdates(true))
  ipcMain.handle(IPC_CHANNELS.app.quitAndInstall, () => quitAndInstallUpdate())
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    setState({ status: 'disabled', error: null })
    return
  }
  void (async () => {
    try {
      const mod = (await import('electron-updater')) as unknown as {
        autoUpdater?: AutoUpdater
        default?: { autoUpdater?: AutoUpdater }
      }
      const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
      if (!autoUpdater) {
        log.warn('[updater] autoUpdater export not found')
        setState({ status: 'error', error: 'autoUpdater export not found' })
        return
      }
      autoUpdaterRef = autoUpdater
      autoUpdater.logger = log
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true

      autoUpdater.on('error', (err) => {
        log.warn('[updater] error', err)
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          progress: null
        })
      })
      autoUpdater.on('checking-for-update', () => {
        setState({ status: 'checking', error: null })
      })
      autoUpdater.on('update-available', (info) => {
        log.info('[updater] update available:', info.version)
        setState({
          status: 'available',
          availableVersion: info.version ?? null,
          error: null,
          lastCheckedAt: Date.now()
        })
      })
      autoUpdater.on('update-not-available', () => {
        log.info('[updater] up to date')
        setState({
          status: 'not-available',
          availableVersion: null,
          error: null,
          lastCheckedAt: Date.now(),
          progress: null
        })
      })
      autoUpdater.on('download-progress', (p) => {
        const percent = typeof p.percent === 'number' ? Math.round(p.percent) : null
        setState({ status: 'downloading', progress: percent, error: null })
      })
      autoUpdater.on('update-downloaded', (info) => {
        log.info('[updater] downloaded, ready to install:', info.version)
        setState({
          status: 'downloaded',
          availableVersion: info.version ?? state.availableVersion,
          progress: 100,
          error: null,
          lastCheckedAt: Date.now()
        })
      })

      await checkForAppUpdates(false)
      const timer = setInterval(() => {
        void checkForAppUpdates(false)
      }, CHECK_INTERVAL_MS)
      timer.unref?.()
    } catch (err) {
      log.warn('[updater] init skipped:', err instanceof Error ? err.message : err)
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  })()
}

// silence unused type import if tree-shaken oddly
export type { AppUpdateStatus }
