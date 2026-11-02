import { ipcMain } from 'electron'
import type { AppDatabase } from '../db'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ActivityRecent, ActivityRecordResult, ActivityResolveResult, ActivitySeenResult } from '../../../shared/types/activity'
import type { ActivityStore } from '../services/activity-store'

interface Deps {
  db: AppDatabase
}

/**
 * F30 · `activity:recent`, `activity:record`, `activity:seen` and `activity:resolve`. The store and its validator load on the first call,
 * so the main entry carries only these handlers.
 */
export function registerActivityIpc({ db }: Deps): void {
  let store: Promise<ActivityStore> | null = null
  const load = (): Promise<ActivityStore> => store ??= import('../services/activity-store').then(({ ActivityStore }) => new ActivityStore(db))

  ipcMain.handle(IPC_CHANNELS.activity.recent, async (): Promise<ActivityRecent> => {
    return (await load()).recent()
  })
  ipcMain.handle(IPC_CHANNELS.activity.record, async (_event, entries: unknown): Promise<ActivityRecordResult> => {
    return (await load()).record(entries)
  })
  ipcMain.handle(IPC_CHANNELS.activity.seen, async (_event, at: unknown): Promise<ActivitySeenResult> => {
    return (await load()).seen(at)
  })
  ipcMain.handle(IPC_CHANNELS.activity.resolve, async (_event, input: unknown): Promise<ActivityResolveResult> => {
    return (await load()).resolve(input)
  })
}
