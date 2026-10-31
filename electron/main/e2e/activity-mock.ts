/**
 * F30 · The activity center's entries for the E2E runs, kept in memory and checked and merged by the same shared code
 * as the main process (shared/activity.ts). Like the real store, a refused call changes nothing.
 */
import { ipcMain } from 'electron'
import { mergeActivityEntries, normalizeActivityEntries, normalizeActivitySeen } from '../../../shared/activity'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ActivityEntry, ActivityRecent, ActivityRecordResult, ActivitySeenResult } from '../../../shared/types/activity'

export function registerActivityMock(now: () => number = Date.now): void {
  let entries: ActivityEntry[] = []
  let lastSeenAt: number | null = null

  ipcMain.handle(IPC_CHANNELS.activity.recent, (): ActivityRecent => structuredClone({ entries, lastSeenAt }))
  ipcMain.handle(IPC_CHANNELS.activity.record, (_event, input: unknown): ActivityRecordResult => {
    const checked = normalizeActivityEntries(input, now())
    if (!checked.ok) return checked
    const merged = mergeActivityEntries(entries, structuredClone(checked.entries))
    entries = merged.entries
    return { ok: true, recorded: merged.recorded, ignored: merged.ignored }
  })
  ipcMain.handle(IPC_CHANNELS.activity.seen, (_event, at: unknown): ActivitySeenResult => {
    const checked = normalizeActivitySeen(at, now())
    if (!checked.ok) return checked
    lastSeenAt = Math.max(lastSeenAt ?? checked.at, checked.at)
    return { ok: true, lastSeenAt }
  })
}
