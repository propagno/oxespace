import { join, dirname } from 'node:path'
import { app, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { StartupFailure, StartupFailureCode } from '../../shared/types/app'

/**
 * T87: when the database cannot be opened, the app says so instead of starting empty. Before this, the reason went
 * only to main.log while the window showed a first-run screen, "Could not load conversations" and buttons that did
 * nothing (no handlers behind them), which read as lost data. Now main keeps one record of the failure, the window
 * asks for it before it renders anything, and shows a single blocking screen. None of the app's other handlers are
 * registered in that state, so nothing half works behind it.
 */

const MESSAGE_LIMIT = 2_000

/** What kind of failure it is, from the error better-sqlite3 or the migration runner threw. */
export function startupFailureCode(error: unknown): StartupFailureCode {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = error instanceof Error ? error.message : String(error ?? '')
  if ((error as { newerSchema?: unknown } | null)?.newerSchema === true || /created by a newer OXESpace version/i.test(message)) return 'newer-schema'
  if (/SQLITE_CORRUPT|SQLITE_NOTADB/.test(code) || /malformed|not a database|file is encrypted/i.test(message)) return 'corrupt'
  if (/SQLITE_BUSY|SQLITE_LOCKED|EBUSY/.test(code) || /database is locked|resource busy/i.test(message)) return 'locked'
  return 'other'
}

/** The record the window shows: the kind, the error's own words (clipped) and where the backups are. */
export function describeStartupFailure(error: unknown, databasePath: string): StartupFailure {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  const message = raw.length > MESSAGE_LIMIT ? `${raw.slice(0, MESSAGE_LIMIT)}…` : raw
  return { code: startupFailureCode(error), message, backupsPath: join(dirname(databasePath), 'db-backups'), databasePath }
}

/**
 * The window's channels for this state. `startupFailure` is registered on every launch (null when the start
 * was fine), so the window can always ask; the others exist only after a failure and take no input: the folder
 * opened is main's own, never one the window names.
 */
export function registerStartupFailureIpc(failure: StartupFailure | null): void {
  ipcMain.handle(IPC_CHANNELS.app.startupFailure, () => failure)
  if (!failure) return
  ipcMain.handle(IPC_CHANNELS.app.openBackupsFolder, async () => {
    // The folder exists once a backup was taken; otherwise open the data folder that holds the database.
    const opened = await shell.openPath(failure.backupsPath)
    if (opened) await shell.openPath(dirname(failure.databasePath))
  })
  ipcMain.handle(IPC_CHANNELS.app.quitAfterStartupFailure, () => { app.quit() })
  // A locked database may be free now (another OXESpace finished closing): start again from scratch.
  ipcMain.handle(IPC_CHANNELS.app.relaunchAfterStartupFailure, () => { app.relaunch(); app.quit() })
}
