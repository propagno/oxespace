import { SCHEDULE_LIMITS, decideDue, nextRun, scheduleRefusal, type Schedule, type ScheduleInput, type ScheduleRun, type SchedulesState } from '../../../../shared/schedule'
import type { ScheduleStore } from './schedule-store'

/** How often the clock is looked at. A run is "on time" within SCHEDULE_LATE_MS, far more than this. */
export const SCHEDULE_TICK_MS = 30_000

export interface SchedulerDeps {
  store: ScheduleStore
  /** Opens a conversation for the schedule and sends its request; the conversation's id. Rejects with the reason. */
  start: (schedule: Schedule) => Promise<{ threadId: string }>
  /** Whether a conversation is still at work or waiting for the person: the next run of its schedule waits for it. */
  busy: (threadId: string) => Promise<boolean>
  /** Whether the project and its folder are still ones OxeChat knows; a schedule is never saved for another. */
  knownProject: (projectId: string, rootPath: string) => boolean
  /** Told after anything changed, with what happened when a run was decided. */
  changed?: (event?: { schedule: Schedule; run: ScheduleRun }) => void
  now?: () => number
}

export class ScheduleRefused extends Error {
  constructor(readonly code: string) { super(`Schedule refused: ${code}`) }
}

/**
 * Decides, at each look at the clock, which schedules are due and acts on them one at a time. All the rules of when
 * and whether are in shared/schedule.ts; this class holds the order of things and the bookkeeping.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking: Promise<void> | null = null
  private readonly now: () => number

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now
  }

  state(): SchedulesState {
    return { paused: this.deps.store.paused(), schedules: this.deps.store.list() }
  }

  runs(scheduleId: string): ScheduleRun[] {
    return this.deps.store.runs(scheduleId)
  }

  save(input: ScheduleInput): Schedule {
    const now = this.now()
    const refusal = scheduleRefusal(input, now)
    if (refusal) throw new ScheduleRefused(refusal)
    const existing = input.id ? this.deps.store.get(input.id) : null
    if (input.id && !existing) throw new ScheduleRefused('unknown')
    if (!existing && this.deps.store.count() >= SCHEDULE_LIMITS.count) throw new ScheduleRefused('tooMany')
    if (!this.deps.knownProject(input.projectId, input.rootPath)) throw new ScheduleRefused('project')
    // "Every N hours" counts from when it was saved unless it already had a starting point.
    const rule = input.rule.kind === 'hours' && existing?.rule.kind === 'hours' && existing.rule.every === input.rule.every ? { ...input.rule, anchor: existing.rule.anchor } : input.rule
    const enabled = input.enabled !== false
    const saved = this.deps.store.save({ ...input, rule, enabled }, now, enabled ? nextRun(rule, now) : null)
    this.deps.changed?.()
    return saved
  }

  remove(id: string): void {
    if (this.deps.store.remove(id)) this.deps.changed?.()
  }

  setEnabled(id: string, enabled: boolean): void {
    const schedule = this.deps.store.get(id)
    if (!schedule) throw new ScheduleRefused('unknown')
    const now = this.now()
    const next = enabled ? nextRun(schedule.rule, now) : null
    // A single time already past has nothing left to wait for: it cannot be turned on again as it is.
    if (enabled && next === null) throw new ScheduleRefused('past')
    this.deps.store.setEnabled(id, enabled, now, next)
    this.deps.changed?.()
  }

  setPaused(paused: boolean): void {
    this.deps.store.setPaused(paused)
    // Coming back from a pause is like coming back from the app being closed: each schedule decides once.
    this.deps.changed?.()
    if (!paused) void this.tick()
  }

  /** The person's "Run now": the same run as a due one, at this moment, without touching when it is next due. */
  async runNow(id: string): Promise<ScheduleRun> {
    const schedule = this.deps.store.get(id)
    if (!schedule) throw new ScheduleRefused('unknown')
    return this.run(schedule, this.now(), schedule.nextRunAt)
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.tick() }, SCHEDULE_TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One look at the clock. Looks never overlap: a second one asked for while the first runs is the first. */
  tick(): Promise<void> {
    this.ticking ??= this.look().finally(() => { this.ticking = null })
    return this.ticking
  }

  private async look(): Promise<void> {
    if (this.deps.store.paused()) return
    for (const listed of this.deps.store.list()) {
      // Read again: an earlier run in this look, or the person, may have changed it meanwhile.
      const schedule = this.deps.store.get(listed.id)
      if (!schedule?.enabled || this.deps.store.paused()) continue
      const now = this.now()
      if (schedule.nextRunAt === null || schedule.nextRunAt > now) continue
      const lastThread = this.deps.store.lastThread(schedule.id)
      const busy = lastThread ? await this.deps.busy(lastThread).catch(() => false) : false
      const decision = decideDue(schedule, now, { busy, startedToday: this.deps.store.startedToday(schedule.id, now) })
      if (!decision) continue
      // Whatever is decided, the next time is counted from now: what was due while the app was away is not queued.
      const next = nextRun(schedule.rule, now)
      if (decision.act === 'skip') {
        const run = this.deps.store.record({ scheduleId: schedule.id, dueAt: decision.dueAt, at: now, outcome: decision.outcome, threadId: null, detail: null })
        this.deps.store.settle(schedule.id, next === null ? { nextRunAt: null, off: 'done' } : { nextRunAt: next })
        this.deps.changed?.({ schedule: this.deps.store.get(schedule.id) ?? schedule, run })
        continue
      }
      await this.run(schedule, decision.dueAt, next)
    }
  }

  private async run(schedule: Schedule, dueAt: number, next: number | null): Promise<ScheduleRun> {
    const at = this.now()
    let run: ScheduleRun
    try {
      const { threadId } = await this.deps.start(schedule)
      run = this.deps.store.record({ scheduleId: schedule.id, dueAt, at, outcome: 'started', threadId, detail: null })
      this.deps.store.settle(schedule.id, next === null && schedule.rule.kind === 'once' ? { nextRunAt: null, lastRunAt: at, failures: 0, off: 'done' } : { nextRunAt: next, lastRunAt: at, failures: 0 })
    } catch (cause) {
      const failures = schedule.failures + 1
      run = this.deps.store.record({ scheduleId: schedule.id, dueAt, at, outcome: 'failed', threadId: null, detail: cause instanceof Error ? cause.message : String(cause) })
      // A schedule that keeps failing is turned off, and says why, instead of failing every hour unseen.
      this.deps.store.settle(schedule.id, failures >= SCHEDULE_LIMITS.failuresBeforePause ? { nextRunAt: null, lastRunAt: at, failures, off: 'failures' }
        : next === null && schedule.rule.kind === 'once' ? { nextRunAt: null, lastRunAt: at, failures, off: 'done' } : { nextRunAt: next, lastRunAt: at, failures })
    }
    this.deps.changed?.({ schedule: this.deps.store.get(schedule.id) ?? schedule, run })
    return run
  }
}
