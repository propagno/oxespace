import { ipcMain, shell } from 'electron'
import log from 'electron-log/main.js'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AppDatabase } from '../db/index'

type RemovedFeaturesRun = typeof import('../services/data-export/removed-features-run')

export interface DataExportIpcDeps {
  db: AppDatabase
  userData: string
  workspaceRoots: () => string[]
  /** The database version openDatabase found before this start's migrations. */
  previousDbVersion: number
}

/**
 * FE-R0b's surface for the one-time export of the removed features' data (R0b). The window never passes a path:
 * open and reveal act on the newest export file, and do nothing when there is none. Returns the first-run export,
 * which the app starts after the window shows; the state waits for it, so the band never reads a half-done run.
 * OXE-358: the export module loads on first use (await import()), once per app run.
 */
export function registerDataExportIpc(deps: DataExportIpcDeps): () => Promise<void> {
  let module: Promise<RemovedFeaturesRun> | null = null
  const load = (): Promise<RemovedFeaturesRun> => (module ??= import('../services/data-export/removed-features-run'))
  let firstRun: Promise<void> | null = null
  const runOnce = (): Promise<void> => {
    firstRun ??= load().then(({ exportRemovedFeatures }) => exportRemovedFeatures(deps)).then(
      result => { if (result.error) log.warn('[data-export] the removed features\' data was not saved:', result.error) },
      (error: unknown) => { log.warn('[data-export] the export failed:', error) }
    )
    return firstRun
  }
  ipcMain.handle(IPC_CHANNELS.dataExport.state, async () => {
    await runOnce()
    return (await load()).removedFeaturesState(deps)
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.markNoticeShown, async () => {
    try { (await load()).markRemovedFeaturesNoticeShown(deps.userData) } catch (error) { log.warn('[data-export] could not record the notice:', error) }
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.exportAgain, async () => {
    await runOnce()
    const result = await (await load()).exportRemovedFeatures({ ...deps, force: true })
    return { file: result.path }
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.open, async () => {
    const file = (await load()).latestRemovedFeaturesExport(deps.userData)
    if (file) await shell.openPath(file)
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.reveal, async () => {
    const file = (await load()).latestRemovedFeaturesExport(deps.userData)
    if (file) shell.showItemInFolder(file)
  })
  return runOnce
}
