import type { AppDatabase } from '../../db/index'
import { registerSchedulesIpc, scheduleChangeBroadcaster } from '../../ipc/schedules.ipc'
import { createNativeAutomationNotifier } from './automation-notifier'
import { EventTriggerDispatcher, type EventPollProvider } from './event-triggers'
import { ScheduleStore } from './schedule-store'
import { Scheduler } from './scheduler'
import { scheduleThreadRunner, type ScheduleThreadHost } from './thread-runner'

/** How long after the app is up the first look at the clock is: the conversation service is still loading before. */
const FIRST_LOOK_MS = 10_000
/** How often event triggers poll GitHub workflows & review-requested PRs when enabled. */
const EVENT_POLL_MS = 60_000

export interface SchedulesRuntimeHost extends ScheduleThreadHost {
  events?: EventPollProvider
}

export interface SchedulesRuntimeHandle {
  stop: () => void
  scheduler: Scheduler
  dispatcher: EventTriggerDispatcher
}

/**
 * Schedules & Automations, from the database to the window: cron/time schedules and CI/PR/CLI event triggers,
 * isolated OXE-444 worktree execution, unified Review Queue, and guarded native notifications.
 */
export function startSchedules(db: AppDatabase, host: SchedulesRuntimeHost): SchedulesRuntimeHandle {
  const store = new ScheduleStore(db)
  const scheduler = new Scheduler({
    store,
    ...scheduleThreadRunner({ ...host, observeLifecycle: true }),
    lifecycle: 'managed',
    notify: createNativeAutomationNotifier(),
    changed: scheduleChangeBroadcaster()
  })
  const dispatcher = new EventTriggerDispatcher({
    store,
    scheduler,
    provider: host.events
  })

  registerSchedulesIpc(scheduler)
  scheduler.start()

  const first = setTimeout(() => {
    void scheduler.tick()
    void dispatcher.pollOnce()
  }, FIRST_LOOK_MS)
  first.unref?.()

  const pollTimer = host.events
    ? setInterval(() => {
        void dispatcher.pollOnce()
      }, EVENT_POLL_MS)
    : null
  pollTimer?.unref?.()

  return {
    scheduler,
    dispatcher,
    stop: () => {
      clearTimeout(first)
      if (pollTimer) clearInterval(pollTimer)
      scheduler.stop()
    }
  }
}
