import { ipcMain, shell } from 'electron'
import log from 'electron-log/main.js'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AppDatabase } from '../db/index'
import {
  exportRemovedFeatures,
  latestRemovedFeaturesExport,
  markRemovedFeaturesNoticeShown,
  removedFeaturesState
} from '../services/data-export/removed-features-export'

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
 */
export function registerDataExportIpc(deps: DataExportIpcDeps): () => Promise<void> {
  let firstRun: Promise<void> | null = null
  const runOnce = (): Promise<void> => {
    firstRun ??= exportRemovedFeatures(deps).then(
      result => { if (result.error) log.warn('[data-export] the removed features\' data was not saved:', result.error) },
      (error: unknown) => { log.warn('[data-export] the export failed:', error) }
    )
    return firstRun
  }
  ipcMain.handle(IPC_CHANNELS.dataExport.state, async () => {
    await runOnce()
    return removedFeaturesState(deps)
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.markNoticeShown, () => {
    try { markRemovedFeaturesNoticeShown(deps.userData) } catch (error) { log.warn('[data-export] could not record the notice:', error) }
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.exportAgain, async () => {
    await runOnce()
    const result = await exportRemovedFeatures({ ...deps, force: true })
    return { file: result.path }
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.open, async () => {
    const file = latestRemovedFeaturesExport(deps.userData)
    if (file) await shell.openPath(file)
  })
  ipcMain.handle(IPC_CHANNELS.dataExport.reveal, () => {
    const file = latestRemovedFeaturesExport(deps.userData)
    if (file) shell.showItemInFolder(file)
  })
  return runOnce
}
