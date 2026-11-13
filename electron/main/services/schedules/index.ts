import type { AppDatabase } from '../../db/index'
import { registerSchedulesIpc, scheduleChangeBroadcaster } from '../../ipc/schedules.ipc'
import { ScheduleStore } from './schedule-store'
import { Scheduler } from './scheduler'
import { scheduleThreadRunner, type ScheduleThreadHost } from './thread-runner'

/** How long after the app is up the first look at the clock is: the conversation service is still loading before. */
const FIRST_LOOK_MS = 10_000

/**
 * Schedules, from the database to the window: the person's requests sent at a set time, through the same calls
 * "New conversation" makes. Returns what stops the clock when the app quits.
 */
export function startSchedules(db: AppDatabase, host: ScheduleThreadHost): () => void {
  const scheduler = new Scheduler({ store: new ScheduleStore(db), ...scheduleThreadRunner(host), changed: scheduleChangeBroadcaster() })
  registerSchedulesIpc(scheduler)
  scheduler.start()
  const first = setTimeout(() => { void scheduler.tick() }, FIRST_LOOK_MS)
  first.unref?.()
  return () => { clearTimeout(first); scheduler.stop() }
}
