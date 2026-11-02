import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

type Updater = typeof import('../updater')

let loading: Promise<Updater> | null = null

/**
 * The updater (state, preferences, electron-updater wiring) loads on the first update request or when
 * `startAutoUpdater` runs after the first window, so the main entry carries only these handlers (T44). A failed
 * import rejects the call that asked, and the next call tries again.
 */
export function loadUpdater(): Promise<Updater> {
  loading ??= import('../updater').catch((error: unknown) => { loading = null; throw error })
  return loading
}

/** The update channels register at boot, like before; each one loads the updater when it is first called. */
export function registerAppUpdateIpc(load: () => Promise<Updater> = loadUpdater): void {
  ipcMain.handle(IPC_CHANNELS.app.getUpdateState, async () => (await load()).getAppUpdateState())
  ipcMain.handle(IPC_CHANNELS.app.checkForUpdates, async () => (await load()).checkForAppUpdates(true))
  ipcMain.handle(IPC_CHANNELS.app.quitAndInstall, async () => (await load()).quitAndInstallUpdate())
  ipcMain.handle(IPC_CHANNELS.app.downloadUpdate, async () => (await load()).downloadAppUpdate())
  ipcMain.handle(IPC_CHANNELS.app.setUpdatePreferences, async (_event, value: unknown) => (await load()).setUpdatePreferences(value))
}

/** Starts the periodic checks after the first window; an updater that cannot load only leaves updates off. */
export function startAutoUpdater(load: () => Promise<Updater> = loadUpdater, warn: (message: string) => void = () => undefined): Promise<void> {
  return load().then(updater => updater.initAutoUpdater(), (error: unknown) => warn(error instanceof Error ? error.message : String(error)))
}
