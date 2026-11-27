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

/** What happened, for the window to say: the automation's name and how its run went. Never the request's text. */
export function scheduleChangeBroadcaster(): (event?: {
  schedule: { id: string; name: string }
  run: ScheduleRun
  reviewPendingCount?: number
}) => void {
  return (event) => {
    const payload: ScheduleEvent | undefined = event
      ? {
          scheduleId: event.schedule.id,
          name: event.schedule.name,
          outcome: event.run.outcome,
          threadId: event.run.threadId,
          runId: event.run.id,
          ...(typeof event.reviewPendingCount === 'number' ? { reviewPendingCount: event.reviewPendingCount } : {})
        }
      : undefined
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.schedules.changed, payload)
    }
  }
}

/**
 * The person's own schedules, automations, and Review Queue. Strictly renderer-only: no MCP tool, phone command,
 * or agent entry reaches these channels, and privileged access modes are always refused.
 */
export function registerSchedulesIpc(scheduler: Scheduler): void {
  ipcMain.handle(IPC_CHANNELS.schedules.state, (): SchedulesState => scheduler.state())
  ipcMain.handle(IPC_CHANNELS.schedules.runs, (_event, id: unknown) => scheduler.runs(parseToken(id, 'Schedule', 80)))
  ipcMain.handle(IPC_CHANNELS.schedules.save, (_event, input: unknown) =>
    answer(() => scheduler.save(parseRecord(input, 'Schedule') as unknown as ScheduleInput))
  )
  ipcMain.handle(IPC_CHANNELS.schedules.remove, (_event, id: unknown) => {
    scheduler.remove(parseToken(id, 'Schedule', 80))
  })
  ipcMain.handle(IPC_CHANNELS.schedules.setEnabled, (_event, input: unknown) => {
    const value = parseRecord(input, 'Schedule')
    return answer(() => scheduler.setEnabled(parseToken(value.id, 'Schedule', 80), value.enabled === true))
  })
  ipcMain.handle(IPC_CHANNELS.schedules.setPaused, (_event, paused: unknown) => {
    scheduler.setPaused(paused === true)
  })
  ipcMain.handle(IPC_CHANNELS.schedules.setMaxConcurrent, (_event, maxConcurrent: unknown) =>
    answer(() => scheduler.setMaxConcurrent(typeof maxConcurrent === 'number' ? maxConcurrent : Number.NaN))
  )
  ipcMain.handle(IPC_CHANNELS.schedules.runNow, (_event, id: unknown) =>
    answer(() => scheduler.runNow(parseToken(id, 'Schedule', 80)))
  )
  ipcMain.handle(IPC_CHANNELS.schedules.reviewQueue, () => scheduler.reviewQueue())
  ipcMain.handle(IPC_CHANNELS.schedules.reviewDiff, (_event, runId: unknown) =>
    answer(() => scheduler.reviewDiff(parseToken(runId, 'Run', 80)))
  )
  ipcMain.handle(IPC_CHANNELS.schedules.createPrFromRun, (_event, runId: unknown) =>
    answer(() => scheduler.createPrFromRun(parseToken(runId, 'Run', 80)))
  )
  ipcMain.handle(IPC_CHANNELS.schedules.applyRunToCheckout, (_event, runId: unknown) =>
    answer(() => scheduler.applyRunToCheckout(parseToken(runId, 'Run', 80)))
  )
  ipcMain.handle(IPC_CHANNELS.schedules.discardRun, (_event, runId: unknown) =>
    answer(() => scheduler.discardRun(parseToken(runId, 'Run', 80)))
  )
}
