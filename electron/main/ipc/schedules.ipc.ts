import { BrowserWindow, ipcMain } from 'electron'
import type { ScheduleInput, ScheduleRun, SchedulesState } from '../../../shared/schedule'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ScheduleAnswer, ScheduleEvent } from '../../../shared/types/schedules-api'
import { ScheduleRefused, type Scheduler } from '../services/schedules/scheduler'
import { parseRecord, parseToken } from './ipc-guards'

async function answer<T>(run: () => T | Promise<T>): Promise<ScheduleAnswer<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (cause) {
    if (cause instanceof ScheduleRefused) return { ok: false, refusal: cause.code }
    throw cause
  }
}

/** What happened, for the window to say: the schedule's name and how its run went. Never the request's text. */
export function scheduleChangeBroadcaster(): (event?: { schedule: { id: string; name: string }; run: ScheduleRun }) => void {
  return event => {
    const payload: ScheduleEvent | undefined = event ? { scheduleId: event.schedule.id, name: event.schedule.name, outcome: event.run.outcome, threadId: event.run.threadId } : undefined
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.schedules.changed, payload)
  }
}

/**
 * The person's own schedules. No MCP tool, phone command or command-bar entry reaches these channels: an agent never
 * schedules itself.
 */
export function registerSchedulesIpc(scheduler: Scheduler): void {
  ipcMain.handle(IPC_CHANNELS.schedules.state, (): SchedulesState => scheduler.state())
  ipcMain.handle(IPC_CHANNELS.schedules.runs, (_event, id: unknown) => scheduler.runs(parseToken(id, 'Schedule', 80)))
  ipcMain.handle(IPC_CHANNELS.schedules.save, (_event, input: unknown) => answer(() => scheduler.save(parseRecord(input, 'Schedule') as unknown as ScheduleInput)))
  ipcMain.handle(IPC_CHANNELS.schedules.remove, (_event, id: unknown) => { scheduler.remove(parseToken(id, 'Schedule', 80)) })
  ipcMain.handle(IPC_CHANNELS.schedules.setEnabled, (_event, input: unknown) => {
    const value = parseRecord(input, 'Schedule')
    return answer(() => scheduler.setEnabled(parseToken(value.id, 'Schedule', 80), value.enabled === true))
  })
  ipcMain.handle(IPC_CHANNELS.schedules.setPaused, (_event, paused: unknown) => { scheduler.setPaused(paused === true) })
  ipcMain.handle(IPC_CHANNELS.schedules.runNow, (_event, id: unknown) => answer(() => scheduler.runNow(parseToken(id, 'Schedule', 80))))
}
