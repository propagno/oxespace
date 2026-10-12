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
const RELEASES_API = 'https://api.github.com/repos/propagno/oxespace/releases/latest'

export function isNewerRelease(latest: string, current: string): boolean {
  const parse = (value: string): number[] | null => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim())
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
  }
  const a = parse(latest), b = parse(current)
  if (!a || !b) return false
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return false
}

/**
 * electron-updater can only replace itself in-place from an AppImage. A `.deb`
 * install is owned by apt, so every check would fail and the UI would show a
 * recurring error for something the user cannot act on. AppImage sets $APPIMAGE
 * to the bundle path at launch, which is the documented way to detect it.
 *
 * Exported with injectable platform/env so the matrix can be covered without
 * building four installers.
 */
export function updaterSupportsThisInstall(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (platform !== 'linux') return true
  return Boolean(env.APPIMAGE)
}

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
  if (!app.isPackaged || !updaterSupportsThisInstall()) {
    setState({ status: 'checking', installMode: 'manual', error: null })
    try {
      const response = await fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OXESpace' },
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) throw new Error(`Release check failed (${response.status})`)
      const release = await response.json() as { tag_name?: unknown }
      const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : ''
      if (!version) throw new Error('Release version unavailable')
      const available = isNewerRelease(version, app.getVersion())
      setState({ status: available ? 'available' : 'not-available', installMode: 'manual', availableVersion: available ? version : null, progress: null, error: null, lastCheckedAt: Date.now() })
    } catch (err) {
      setState({ status: 'error', installMode: 'manual', error: err instanceof Error ? err.message : String(err), lastCheckedAt: Date.now() })
    }
    return getAppUpdateState()
  }
  if (!autoUpdaterRef) {
    setState({
      status: 'disabled',
      error: 'Updater not initialized',
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
  if (!app.isPackaged || !updaterSupportsThisInstall()) {
    setState({ status: 'idle', installMode: 'manual', error: null })
    if (process.env.OXESPACE_E2E_MOCK_NATIVE !== '1') {
      void checkForAppUpdates(false)
      const timer = setInterval(() => { void checkForAppUpdates(false) }, CHECK_INTERVAL_MS)
      timer.unref?.()
    }
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
