import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ActivityRecent, ActivityRecordResult, ActivityResolveResult, ActivitySeenResult } from '../../../shared/types/activity'
import type { ActivityStore } from '../services/activity-store'
import { requireAppFrame } from './ipc-guards'

interface Deps {
  db: AppDatabase
  /** Rejects calls that do not come from the application's main frame. */
  sender?(event: IpcMainInvokeEvent): void
}

/**
 * F30 · `activity:recent`, `activity:record`, `activity:seen` and `activity:resolve`. The store and its validator load on the first call,
 * so the main entry carries only these handlers.
 */
export function registerActivityIpc({ db, sender = event => requireAppFrame(event, 'Activity') }: Deps): void {
  let store: Promise<ActivityStore> | null = null
  const load = (): Promise<ActivityStore> => store ??= import('../services/activity-store').then(({ ActivityStore }) => new ActivityStore(db))

  ipcMain.handle(IPC_CHANNELS.activity.recent, async (event): Promise<ActivityRecent> => {
    sender(event)
    return (await load()).recent()
  })
  ipcMain.handle(IPC_CHANNELS.activity.record, async (event, entries: unknown): Promise<ActivityRecordResult> => {
    sender(event)
    return (await load()).record(entries)
  })
  ipcMain.handle(IPC_CHANNELS.activity.seen, async (event, at: unknown): Promise<ActivitySeenResult> => {
    sender(event)
    return (await load()).seen(at)
  })
  ipcMain.handle(IPC_CHANNELS.activity.resolve, async (event, input: unknown): Promise<ActivityResolveResult> => {
    sender(event)
    return (await load()).resolve(input)
  })
}
