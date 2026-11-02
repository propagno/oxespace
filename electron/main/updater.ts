import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import { recordIncident } from './services/diagnostics/incident-sink'
import { bypassCloseGuard } from './window-close-guard'
import type { AppUpdateChannel, AppUpdatePreferences, AppUpdateState, AppUpdateStatus } from '../../shared/types/updater'

/**
 * Auto-update via electron-updater against GitHub Releases (electron-builder
 * `publish` field). Behavior:
 * - No-op status in unpackaged/dev builds (UI shows "disabled").
 * - Checks once shortly after startup, then every few hours.
 * - Downloads in the background; installs on quit or when the user clicks
 *   "Restart to update".
 * - Never throws into the app lifecycle — failures only log + update state.
 * - The person's preferences (AppUpdatePreferences) decide whether checks run on their own and whether a
 *   found update downloads by itself.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const RELEASES_API = 'https://api.github.com/repos/propagno/oxespace/releases/latest'
/** The beta channel reads the whole list: `latest` never returns a pre-release. */
const RELEASES_LIST_API = 'https://api.github.com/repos/propagno/oxespace/releases?per_page=20'

interface ParsedVersion { core: number[]; pre: string[] }

function parseVersion(value: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(value.trim())
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] }
}

/** SemVer precedence: 0.16.0-beta.8 < 0.16.0, and beta.10 > beta.9. */
function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1
  }
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index], y = b.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x), yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) > Number(y) ? 1 : -1
    if (xNumeric) return -1
    if (yNumeric) return 1
    return x > y ? 1 : -1
  }
  return 0
}

export function isNewerRelease(latest: string, current: string): boolean {
  const a = parseVersion(latest), b = parseVersion(current)
  if (!a || !b) return false
  return compareVersions(a, b) > 0
}

/** The highest published version a pre-release install should be offered (pre-releases included). */
export function newestVersion(tags: string[]): string | null {
  let best: { tag: string; version: ParsedVersion } | null = null
  for (const tag of tags) {
    const version = parseVersion(tag)
    if (version && (!best || compareVersions(version, best.version) > 0)) best = { tag, version }
  }
  return best ? best.tag.replace(/^v/, '') : null
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
/**
 * B13 (T8): a feed on this machine's loopback for the packaged smoke, so the shipped binary's updater can be proven
 * against a newer version without the internet. Honoured only as plain http on 127.0.0.1, localhost or [::1], and it
 * makes the updater read-only: while it is set nothing downloads and nothing installs (see applyPolicy), whatever the
 * preferences say. So it can never be used to put another build on the machine; at most a process that already runs
 * as the person can make the app *say* an update exists, which it could do by editing the app's files anyway.
 */
export function loopbackUpdateFeed(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.OXESPACE_UPDATE_FEED_URL
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' || url.username || url.password) return null
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

export function updaterSupportsThisInstall(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (platform !== 'linux') return true
  return Boolean(env.APPIMAGE)
}

/** A pre-release install is on the beta channel until the person chooses otherwise. */
export const defaultChannel = (version: string): AppUpdateChannel => (parseVersion(version)?.pre.length ?? 0) > 0 ? 'beta' : 'stable'

export const DEFAULT_UPDATE_PREFERENCES: AppUpdatePreferences = { mode: 'auto', pinnedVersion: null, channel: 'stable' }

export function normalizeUpdatePreferences(value: unknown, version = app.getVersion()): AppUpdatePreferences {
  const input = value && typeof value === 'object' ? value as Partial<AppUpdatePreferences> : {}
  const mode = input.mode === 'notify' || input.mode === 'off' ? input.mode : 'auto'
  const pinnedVersion = typeof input.pinnedVersion === 'string' && parseVersion(input.pinnedVersion) ? input.pinnedVersion.replace(/^v/, '') : null
  const channel = input.channel === 'beta' || input.channel === 'stable' ? input.channel : defaultChannel(version)
  return { mode, pinnedVersion, channel }
}

/** What the preferences allow: checks on a timer, downloads without asking, install on quit. */
export function updatePolicy(preferences: AppUpdatePreferences): { periodic: boolean; autoDownload: boolean; autoInstall: boolean } {
  const pinned = preferences.pinnedVersion !== null
  return { periodic: preferences.mode !== 'off' && !pinned, autoDownload: preferences.mode === 'auto' && !pinned, autoInstall: preferences.mode === 'auto' && !pinned }
}

const preferencesFile = (): string => join(app.getPath('userData'), 'update-preferences.json')
function loadPreferences(): AppUpdatePreferences {
  try { return normalizeUpdatePreferences(JSON.parse(readFileSync(preferencesFile(), 'utf8'))) } catch { return normalizeUpdatePreferences(undefined) }
}

type AutoUpdater = typeof import('electron-updater').autoUpdater

let autoUpdaterRef: AutoUpdater | null = null
let preferences: AppUpdatePreferences = normalizeUpdatePreferences(undefined)
let state: AppUpdateState = {
  status: app.isPackaged ? 'idle' : 'disabled',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: null,
  error: null,
  lastCheckedAt: null
}

function setState(partial: Partial<AppUpdateState>): void {
  if (partial.status === 'error') recordIncident('incident.updater.failed', state.status) // the step that failed, never the error text
  state = { ...state, ...partial, currentVersion: app.getVersion(), preferences }
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
  return { ...state, currentVersion: app.getVersion(), preferences }
}

function applyPolicy(): void {
  if (!autoUpdaterRef) return
  const policy = updatePolicy(preferences)
  // A loopback smoke feed only ever reads (loopbackUpdateFeed).
  const readOnly = loopbackUpdateFeed() !== null
  autoUpdaterRef.autoDownload = policy.autoDownload && !readOnly
  autoUpdaterRef.autoInstallOnAppQuit = policy.autoInstall && !readOnly
  // The channel setter also turns on downgrades; turn them back off, so leaving beta waits for a newer stable.
  autoUpdaterRef.channel = preferences.channel === 'beta' ? 'beta' : 'latest'
  autoUpdaterRef.allowPrerelease = preferences.channel === 'beta'
  autoUpdaterRef.allowDowngrade = false
}

export function setUpdatePreferences(value: unknown): AppUpdateState {
  preferences = normalizeUpdatePreferences(value)
  try { writeFileSync(preferencesFile(), JSON.stringify(preferences, null, 2)) } catch (err) { log.warn('[updater] could not save preferences', err) }
  applyPolicy()
  setState({})
  return getAppUpdateState()
}

/** Downloads an update that was found but not downloaded, because the mode asks first. */
export async function downloadAppUpdate(): Promise<AppUpdateState> {
  if (!autoUpdaterRef || state.status !== 'available' || loopbackUpdateFeed() !== null) return getAppUpdateState()
  try { await autoUpdaterRef.downloadUpdate() } catch (err) { setState({ status: 'error', error: err instanceof Error ? err.message : String(err) }) }
  return getAppUpdateState()
}

export async function checkForAppUpdates(manual = false): Promise<AppUpdateState> {
  // With updates off or a version pinned, only the person starts a check.
  if (!manual && !updatePolicy(preferences).periodic) return getAppUpdateState()
  if (!app.isPackaged || !updaterSupportsThisInstall()) {
    setState({ status: 'checking', installMode: 'manual', error: null })
    try {
      // `latest` never returns a pre-release, so the beta channel reads the list.
      const response = await fetch(preferences.channel === 'beta' ? RELEASES_LIST_API : RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OXESpace' },
        signal: AbortSignal.timeout(10_000)
      })
      if (!response.ok) throw new Error(`Release check failed (${response.status})`)
      const body = await response.json() as unknown
      const items = Array.isArray(body) ? body : [body]
      const tags = items
        .filter((item): item is { tag_name: string; draft?: boolean } => Boolean(item) && typeof (item as { tag_name?: unknown }).tag_name === 'string' && !(item as { draft?: boolean }).draft)
        .map(item => item.tag_name)
      const version = newestVersion(tags) ?? ''
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
  if (!autoUpdaterRef || state.status !== 'downloaded' || loopbackUpdateFeed() !== null) return false
  // F26: the install quits without asking the window; autosaved drafts cover it.
  const askAgain = bypassCloseGuard()
  try {
    // isSilent=false, isForceRunAfter=true — restart into the new version.
    autoUpdaterRef.quitAndInstall(false, true)
    return true
  } catch (err) {
    askAgain()
    log.warn('[updater] quitAndInstall failed', err)
    setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
    return false
  }
}

export function initAutoUpdater(): void {
  preferences = loadPreferences()
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
      const smokeFeed = loopbackUpdateFeed()
      if (smokeFeed) autoUpdater.setFeedURL({ provider: 'generic', url: smokeFeed })
      applyPolicy()

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
