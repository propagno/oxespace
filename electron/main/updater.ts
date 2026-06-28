import { app } from 'electron'
import log from 'electron-log/main.js'

/**
 * Auto-update via electron-updater against the GitHub Releases feed (configured
 * by electron-builder's `publish` field). Behavior:
 * - No-op in dev / unpackaged builds (nothing to update).
 * - Checks once shortly after startup, then every few hours.
 * - Downloads in the background and installs on the next quit.
 * - Never throws — an update failure (offline, rate-limited, unsigned warning)
 *   must never affect the running app; everything is logged to main.log.
 *
 * NOTE: on Windows, fully frictionless updates need a signed build (see
 * electron-builder signing). Unsigned updates still install but may show a
 * SmartScreen prompt. Requires a published release to exercise end-to-end.
 */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function initAutoUpdater(): void {
  if (!app.isPackaged) return
  void (async () => {
    try {
      // electron-updater is CommonJS; under the ESM main bundle the named export
      // lands on `.default`, so reach it through either shape.
      const mod = (await import('electron-updater')) as unknown as {
        autoUpdater?: typeof import('electron-updater').autoUpdater
        default?: { autoUpdater?: typeof import('electron-updater').autoUpdater }
      }
      const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater
      if (!autoUpdater) { log.warn('[updater] autoUpdater export not found'); return }
      autoUpdater.logger = log
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.on('error', (err) => log.warn('[updater] error', err))
      autoUpdater.on('update-available', (info) => log.info('[updater] update available:', info.version))
      autoUpdater.on('update-not-available', () => log.info('[updater] up to date'))
      autoUpdater.on('update-downloaded', (info) => log.info('[updater] downloaded, will install on quit:', info.version))
      await autoUpdater.checkForUpdates()
      const timer = setInterval(() => { void autoUpdater.checkForUpdates().catch(() => undefined) }, CHECK_INTERVAL_MS)
      timer.unref?.()
    } catch (err) {
      log.warn('[updater] init skipped:', err instanceof Error ? err.message : err)
    }
  })()
}
