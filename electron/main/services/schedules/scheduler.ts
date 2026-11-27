import { randomUUID } from 'node:crypto'
import {
  SCHEDULE_LIMITS,
  decideDue,
  nextRun,
  scheduleRefusal,
  type ReviewActionResult,
  type ReviewQueueSummary,
  type ReviewRunDiff,
  type Schedule,
  type ScheduleInput,
  type ScheduleRun,
  type ScheduleTokenUsage,
  type SchedulesState
} from '../../../../shared/schedule'
import type { WorktreeProvisionReport } from '../../../../shared/types/repo-config'
import type { AutomationNotifier } from './automation-notifier'
import {
  applyAutomationRunToCheckout,
  collectAutomationDiff,
  createPrForAutomationRun,
  discardAutomationWorktree,
  type AutomationWorktreeHost
} from './automation-worktree'
import type { ScheduleStore } from './schedule-store'

/** How often the clock is looked at. A run is "on time" within SCHEDULE_LATE_MS, far more than this. */
export const SCHEDULE_TICK_MS = 30_000

export interface StartRunContext {
  runId: string
  eventKey?: string | null
  onWaitingApproval?: () => void
}

export interface RunCompletionResult {
  status?: 'completed' | 'failed' | 'waiting_approval'
  summaryMd?: string | null
  errorCode?: string | null
  detail?: string | null
  tokenUsage?: ScheduleTokenUsage | null
}

export interface StartRunResult {
  threadId: string
  worktreePath?: string | null
  branchName?: string | null
  baseSha?: string | null
  provisionReport?: WorktreeProvisionReport
  waitForCompletion?: Promise<RunCompletionResult>
}

export interface SchedulerDeps {
  store: ScheduleStore
  /** Opens a conversation for the schedule and sends its request; the conversation's id. Rejects with the reason. */
  start: (schedule: Schedule, context?: StartRunContext) => Promise<StartRunResult>
  /** Whether a conversation is still at work or waiting for the person: the next run of its schedule waits for it. */
  busy: (threadId: string) => Promise<boolean>
  /** Whether the project and its folder are still ones OxeChat knows; a schedule is never saved for another. */
  knownProject: (projectId: string, rootPath: string) => boolean
  /** Interrupts an actively running thread on timeout. */
  interrupt?: (threadId: string) => Promise<void>
  /** Optional worktree/PR host for Review Queue actions (`createPrFromRun`, `discardRun`). */
  worktrees?: AutomationWorktreeHost
  /** Optional native OS notification emitter for `needs_review`, `waiting_approval`, `failed`, `timed_out`. */
  notify?: AutomationNotifier
  /** When `'managed'`, enforces global `maxConcurrent` queueing and per-run timeouts even before `waitForCompletion`. */
  lifecycle?: 'legacy' | 'managed'
  /** Told after anything changed, with what happened when a run was decided. */
  changed?: (event?: { schedule: Schedule; run: ScheduleRun; reviewPendingCount?: number }) => void
  now?: () => number
}

export class ScheduleRefused extends Error {
  constructor(readonly code: string) {
    super(`Schedule refused: ${code}`)
  }
}

interface ActiveRunEntry {
  runId: string
  threadId: string
  schedule: Schedule
  timer: ReturnType<typeof setTimeout> | null
  timedOut: boolean
}

interface QueuedRunEntry {
  runId: string
  scheduleId: string
  dueAt: number
  next: number | null
  eventKey?: string | null
  detail?: string | null
}

/**
 * Decides, at each look at the clock or event trigger, which automations run, enforces global `maxConcurrent`
 * queueing and per-run timeouts, and manages the unified Review Queue lifecycle.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking: Promise<void> | null = null
  private draining = false
  private readonly activeRuns = new Map<string, ActiveRunEntry>()
  private readonly activePromises = new Set<Promise<unknown>>()
  private readonly queue: QueuedRunEntry[] = []
  private readonly now: () => number

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now
  }

  state(): SchedulesState {
    return {
      paused: this.deps.store.paused(),
      maxConcurrent: this.deps.store.maxConcurrent(),
      reviewPendingCount: this.deps.store.pendingReviewCount(),
      schedules: this.deps.store.list()
    }
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
    const rule =
      input.rule.kind === 'hours' && existing?.rule.kind === 'hours' && existing.rule.every === input.rule.every
        ? { ...input.rule, anchor: existing.rule.anchor }
        : input.rule
    const enabled = input.enabled !== false
    const saved = this.deps.store.save({ ...input, rule, enabled }, now, enabled ? nextRun(rule, now) : null)
    this.emitChanged()
    return saved
  }

  remove(id: string): void {
    if (this.deps.store.remove(id)) this.emitChanged()
  }

  setEnabled(id: string, enabled: boolean): void {
    const schedule = this.deps.store.get(id)
    if (!schedule) throw new ScheduleRefused('unknown')
    const now = this.now()
    const next = enabled ? nextRun(schedule.rule, now) : null
    // A single time already past has nothing left to wait for; event schedules naturally have `next === null`.
    if (enabled && schedule.rule.kind !== 'event' && next === null) throw new ScheduleRefused('past')
    this.deps.store.setEnabled(id, enabled, now, next)
    this.emitChanged()
  }

  setPaused(paused: boolean): void {
    this.deps.store.setPaused(paused)
    // Coming back from a pause is like coming back from the app being closed: each schedule decides once.
    this.emitChanged()
    if (!paused) {
      void this.tick()
      void this.drainQueue()
    }
  }

  setMaxConcurrent(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > SCHEDULE_LIMITS.maxConcurrentLimit) {
      throw new ScheduleRefused('maxConcurrent')
    }
    const updated = this.deps.store.setMaxConcurrent(value)
    this.emitChanged()
    void this.drainQueue()
    return updated
  }

  /** The person's "Run now": the same run as a due one, at this moment, without touching when it is next due. */
  async runNow(id: string): Promise<ScheduleRun> {
    const schedule = this.deps.store.get(id)
    if (!schedule) throw new ScheduleRefused('unknown')
    return this.run(schedule, this.now(), schedule.nextRunAt)
  }

  /** Triggers an automation run from an event dispatcher or local CLI trigger seam. */
  async triggerEventRun(
    scheduleId: string,
    options: { eventKey?: string | null; detail?: string | null; dueAt?: number } = {}
  ): Promise<ScheduleRun> {
    const schedule = this.deps.store.get(scheduleId)
    if (!schedule) throw new ScheduleRefused('unknown')
    const dueAt = options.dueAt ?? this.now()
    return this.run(schedule, dueAt, schedule.nextRunAt, {
      eventKey: options.eventKey ?? null,
      detail: options.detail ?? null
    })
  }

  /** Transitions a running/started automation run to `needs_review`, `waiting_approval`, or `failed`. */
  async completeRun(runId: string, result: RunCompletionResult = {}): Promise<ScheduleRun> {
    const current = this.deps.store.getRun(runId)
    if (!current) throw new ScheduleRefused('unknown')
    const schedule = this.deps.store.get(current.scheduleId)
    if (!schedule) throw new ScheduleRefused('unknown')

    const status = result.status ?? 'completed'
    if (status === 'waiting_approval') {
      const updated = this.deps.store.updateRun(runId, {
        outcome: 'waiting_approval',
        detail: result.detail ?? current.detail
      })!
      this.deps.notify?.({
        kind: 'waiting_approval',
        scheduleId: schedule.id,
        runId,
        title: schedule.name,
        body: result.detail || 'Waiting for approval'
      })
      this.emitChanged(schedule, updated)
      return updated
    }

    const active = this.activeRuns.get(runId)
    if (active) {
      if (active.timer) clearTimeout(active.timer)
      this.activeRuns.delete(runId)
    }

    const finishedAt = this.now()
    if (status === 'failed') {
      const updated = this.deps.store.updateRun(runId, {
        outcome: 'failed',
        finishedAt,
        errorCode: result.errorCode ?? 'EXECUTION_FAILED',
        detail: result.detail ?? current.detail,
        summaryMd: result.summaryMd ?? current.summaryMd,
        tokenUsage: result.tokenUsage ?? current.tokenUsage
      })!
      this.deps.notify?.({
        kind: 'failed',
        scheduleId: schedule.id,
        runId,
        title: schedule.name,
        body: updated.detail || 'Automation failed'
      })
      this.emitChanged(schedule, updated)
      void this.drainQueue()
      return updated
    }

    let filesChanged = current.filesChanged ?? 0
    let additions = current.additions ?? 0
    let deletions = current.deletions ?? 0
    if (current.worktreePath) {
      try {
        const diff = await collectAutomationDiff(current.worktreePath, current.baseSha)
        filesChanged = diff.filesChanged
        additions = diff.additions
        deletions = diff.deletions
      } catch {
        // Keep previously recorded stats if diff collection fails.
      }
    }

    const updated = this.deps.store.updateRun(runId, {
      outcome: 'needs_review',
      reviewStatus: 'pending',
      finishedAt,
      summaryMd: result.summaryMd ?? current.summaryMd,
      filesChanged,
      additions,
      deletions,
      tokenUsage: result.tokenUsage ?? current.tokenUsage
    })!

    this.deps.notify?.({
      kind: 'needs_review',
      scheduleId: schedule.id,
      runId,
      title: schedule.name,
      body: updated.summaryMd?.slice(0, 140) || `${filesChanged} file(s) changed (+${additions} / -${deletions})`
    })
    this.emitChanged(schedule, updated)
    void this.drainQueue()
    return updated
  }

  /** Lists all runs currently in `needs_review` state for the Review Queue. */
  reviewQueue(): ReviewQueueSummary {
    const items = this.deps.store.listReviewQueue()
    return { count: items.length, items }
  }

  /** Returns structured file list, stats, summary, and readable unified diff for a run. */
  async reviewDiff(runId: string): Promise<ReviewRunDiff> {
    const run = this.deps.store.getRun(runId)
    if (!run) throw new ScheduleRefused('unknown')
    const schedule = this.deps.store.get(run.scheduleId)
    if (!schedule) throw new ScheduleRefused('unknown')

    if (run.worktreePath) {
      try {
        const diff = await collectAutomationDiff(run.worktreePath, run.baseSha)
        return {
          runId: run.id,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          branchName: run.branchName ?? null,
          worktreePath: run.worktreePath,
          summaryMd: run.summaryMd ?? null,
          filesChanged: diff.filesChanged,
          additions: diff.additions,
          deletions: diff.deletions,
          files: diff.files,
          unifiedDiff: diff.unifiedDiff,
          prUrl: run.prUrl ?? null
        }
      } catch {
        // Fall through to stored metadata when worktree was removed.
      }
    }

    return {
      runId: run.id,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      branchName: run.branchName ?? null,
      worktreePath: run.worktreePath ?? null,
      summaryMd: run.summaryMd ?? null,
      filesChanged: run.filesChanged ?? 0,
      additions: run.additions ?? 0,
      deletions: run.deletions ?? 0,
      files: [],
      unifiedDiff: '',
      prUrl: run.prUrl ?? null
    }
  }

  /** Pushes the automation branch and creates a Pull Request, marking the run `approved`. */
  async createPrFromRun(runId: string): Promise<ReviewActionResult> {
    const run = this.deps.store.getRun(runId)
    if (!run) throw new ScheduleRefused('unknown')
    const schedule = this.deps.store.get(run.scheduleId)
    if (!schedule) throw new ScheduleRefused('unknown')
    if (!run.worktreePath || !run.branchName) throw new ScheduleRefused('notReviewable')
    if (!this.deps.worktrees) throw new ScheduleRefused('worktree')

    try {
      const { prUrl } = await createPrForAutomationRun(this.deps.worktrees, {
        projectRoot: schedule.rootPath,
        worktreePath: run.worktreePath,
        branchName: run.branchName,
        baseSha: run.baseSha,
        title: `chore(automation): ${schedule.name}`,
        body: run.summaryMd || `Automated run for "${schedule.name}" (${run.branchName}).`
      })
      const updated = this.deps.store.updateRun(runId, {
        outcome: 'approved',
        reviewStatus: 'approved',
        prUrl
      })!
      this.emitChanged(schedule, updated)
      return { run: updated, prUrl }
    } catch (cause) {
      if (cause instanceof ScheduleRefused) throw cause
      throw new ScheduleRefused('prFailed')
    }
  }

  /** Applies automation worktree changes cleanly into the main checkout, marking the run `merged`. */
  async applyRunToCheckout(runId: string): Promise<ReviewActionResult> {
    const run = this.deps.store.getRun(runId)
    if (!run) throw new ScheduleRefused('unknown')
    const schedule = this.deps.store.get(run.scheduleId)
    if (!schedule) throw new ScheduleRefused('unknown')
    if (!run.worktreePath || !run.branchName) throw new ScheduleRefused('notReviewable')

    try {
      await applyAutomationRunToCheckout({
        projectRoot: schedule.rootPath,
        worktreePath: run.worktreePath,
        branchName: run.branchName,
        baseSha: run.baseSha
      })
      const updated = this.deps.store.updateRun(runId, {
        outcome: 'merged',
        reviewStatus: 'merged'
      })!
      this.emitChanged(schedule, updated)
      return { run: updated }
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code
      if (code === 'DIRTY_CHECKOUT') throw new ScheduleRefused('dirtyCheckout')
      if (cause instanceof ScheduleRefused) throw cause
      throw new ScheduleRefused('worktree')
    }
  }

  /** Safely discards an automation run's worktree (`removeSharedLinks`) and local branch without touching main checkout. */
  async discardRun(runId: string): Promise<ReviewActionResult> {
    const run = this.deps.store.getRun(runId)
    if (!run) throw new ScheduleRefused('unknown')
    const schedule = this.deps.store.get(run.scheduleId)
    if (!schedule) throw new ScheduleRefused('unknown')

    if (run.worktreePath && this.deps.worktrees) {
      await discardAutomationWorktree(this.deps.worktrees, {
        projectRoot: schedule.rootPath,
        worktreePath: run.worktreePath,
        branchName: run.branchName ?? ''
      })
    }

    const updated = this.deps.store.updateRun(runId, {
      outcome: 'discarded',
      reviewStatus: 'discarded'
    })!
    this.emitChanged(schedule, updated)
    return { run: updated }
  }

  /** Waits until all tracked active runs and queued runs settle (used for deterministic testing & shutdown). */
  async waitForIdle(): Promise<void> {
    while (this.activePromises.size > 0 || this.queue.length > 0 || this.draining) {
      await Promise.allSettled([...this.activePromises])
      if (this.queue.length > 0) {
        await this.drainQueue()
      }
      if (this.activePromises.size === 0 && this.queue.length === 0 && !this.draining) break
      await Promise.resolve()
    }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, SCHEDULE_TICK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const active of this.activeRuns.values()) {
      if (active.timer) clearTimeout(active.timer)
    }
    this.activeRuns.clear()
    this.queue.length = 0
  }

  /** One look at the clock. Looks never overlap: a second one asked for while the first runs is the first. */
  tick(): Promise<void> {
    this.ticking ??= this.look().finally(() => {
      this.ticking = null
    })
    return this.ticking
  }

  private emitChanged(schedule?: Schedule, run?: ScheduleRun): void {
    if (!this.deps.changed) return
    if (schedule && run) {
      this.deps.changed({
        schedule: this.deps.store.get(schedule.id) ?? schedule,
        run,
        reviewPendingCount: this.deps.store.pendingReviewCount()
      })
    } else {
      this.deps.changed()
    }
  }

  private async look(): Promise<void> {
    if (this.deps.store.paused()) return
    for (const listed of this.deps.store.list()) {
      // Read again: an earlier run in this look, or the person, may have changed it meanwhile.
      const schedule = this.deps.store.get(listed.id)
      if (!schedule?.enabled || this.deps.store.paused()) continue
      if (schedule.rule.kind === 'event') continue
      const now = this.now()
      if (schedule.nextRunAt === null || schedule.nextRunAt > now) continue
      const lastThread = this.deps.store.lastThread(schedule.id)
      const busy = lastThread ? await this.deps.busy(lastThread).catch(() => false) : false
      const decision = decideDue(schedule, now, { busy, startedToday: this.deps.store.startedToday(schedule.id, now) })
      if (!decision) continue
      // Whatever is decided, the next time is counted from now: what was due while the app was away is not queued.
      const next = nextRun(schedule.rule, now)
      if (decision.act === 'skip') {
        const run = this.deps.store.record({
          scheduleId: schedule.id,
          dueAt: decision.dueAt,
          at: now,
          outcome: decision.outcome,
          threadId: null,
          detail: null
        })
        this.deps.store.settle(schedule.id, next === null ? { nextRunAt: null, off: 'done' } : { nextRunAt: next })
        this.emitChanged(schedule, run)
        continue
      }
      await this.run(schedule, decision.dueAt, next)
    }
  }

  private async run(
    schedule: Schedule,
    dueAt: number,
    next: number | null,
    options?: { eventKey?: string | null; detail?: string | null }
  ): Promise<ScheduleRun> {
    const runId = randomUUID()
    const maxConcurrent = this.deps.store.maxConcurrent()
    if (this.activeRuns.size >= maxConcurrent) {
      const at = this.now()
      const queuedRun = this.deps.store.record({
        id: runId,
        scheduleId: schedule.id,
        dueAt,
        at,
        outcome: 'queued',
        threadId: null,
        detail: options?.detail ?? null,
        eventKey: options?.eventKey ?? null
      })
      this.queue.push({
        runId,
        scheduleId: schedule.id,
        dueAt,
        next,
        eventKey: options?.eventKey ?? null,
        detail: options?.detail ?? null
      })
      this.emitChanged(schedule, queuedRun)
      return queuedRun
    }

    return this.launchRun(runId, schedule, dueAt, next, false, options)
  }

  private async launchRun(
    runId: string,
    schedule: Schedule,
    dueAt: number,
    next: number | null,
    fromQueue: boolean,
    options?: { eventKey?: string | null; detail?: string | null }
  ): Promise<ScheduleRun> {
    const at = this.now()
    const managed = this.deps.lifecycle === 'managed'
    // Reserve concurrency slot synchronously before awaiting `start()` so parallel triggers respect `maxConcurrent`.
    const placeholder: ActiveRunEntry | null = managed
      ? { runId, threadId: '', schedule, timer: null, timedOut: false }
      : null
    if (placeholder) this.activeRuns.set(runId, placeholder)

    let run: ScheduleRun
    try {
      const started = await this.deps.start(schedule, {
        runId,
        eventKey: options?.eventKey ?? null,
        onWaitingApproval: () => {
          void this.completeRun(runId, { status: 'waiting_approval' }).catch(() => undefined)
        }
      })

      const isTracked = managed || Boolean(started.waitForCompletion)
      const outcome = isTracked ? 'running' : 'started'

      if (fromQueue) {
        run = this.deps.store.updateRun(runId, {
          outcome,
          threadId: started.threadId,
          worktreePath: started.worktreePath ?? null,
          branchName: started.branchName ?? null,
          baseSha: started.baseSha ?? null
        })!
      } else {
        run = this.deps.store.record({
          id: runId,
          scheduleId: schedule.id,
          dueAt,
          at,
          outcome,
          threadId: started.threadId,
          detail: options?.detail ?? null,
          worktreePath: started.worktreePath ?? null,
          branchName: started.branchName ?? null,
          baseSha: started.baseSha ?? null,
          eventKey: options?.eventKey ?? null
        })
      }

      this.deps.store.settle(
        schedule.id,
        next === null && schedule.rule.kind === 'once'
          ? { nextRunAt: null, lastRunAt: at, failures: 0, off: 'done' }
          : { nextRunAt: next, lastRunAt: at, failures: 0 }
      )

      if (isTracked) {
        const entry: ActiveRunEntry = placeholder ?? { runId, threadId: started.threadId, schedule, timer: null, timedOut: false }
        entry.threadId = started.threadId
        this.activeRuns.set(runId, entry)

        const timeoutMs = schedule.timeoutMs ?? SCHEDULE_LIMITS.defaultTimeoutMs
        const timeoutPromise = new Promise<void>((resolve) => {
          entry.timer = setTimeout(() => {
            if (!this.activeRuns.has(runId) || entry.timedOut) {
              resolve()
              return
            }
            entry.timedOut = true
            this.activeRuns.delete(runId)
            void (async () => {
              await this.deps.interrupt?.(started.threadId).catch(() => undefined)
              const timedOutRun = this.deps.store.updateRun(runId, {
                outcome: 'timed_out',
                errorCode: 'TIMEOUT',
                finishedAt: this.now(),
                detail: 'Automation run timed out and was interrupted.'
              })
              if (timedOutRun) {
                this.deps.notify?.({
                  kind: 'timed_out',
                  scheduleId: schedule.id,
                  runId,
                  title: schedule.name,
                  body: timedOutRun.detail ?? 'Timed out'
                })
                this.emitChanged(schedule, timedOutRun)
              }
              void this.drainQueue()
              resolve()
            })()
          }, timeoutMs)
          entry.timer.unref?.()
        })

        if (started.waitForCompletion) {
          const tracked = started.waitForCompletion
            .then(async (completion) => {
              if (entry.timedOut || !this.activeRuns.has(runId)) return
              await this.completeRun(runId, completion)
            })
            .catch(async (cause) => {
              if (entry.timedOut || !this.activeRuns.has(runId)) return
              await this.completeRun(runId, {
                status: 'failed',
                detail: cause instanceof Error ? cause.message : String(cause)
              })
            })
          const combined = Promise.race([tracked, timeoutPromise])
          this.activePromises.add(combined)
          void combined.finally(() => this.activePromises.delete(combined))
        } else {
          this.activePromises.add(timeoutPromise)
          void timeoutPromise.finally(() => this.activePromises.delete(timeoutPromise))
        }
      }
    } catch (cause) {
      if (placeholder) this.activeRuns.delete(runId)
      const failures = schedule.failures + 1
      const message = cause instanceof Error ? cause.message : String(cause)
      if (fromQueue) {
        run = this.deps.store.updateRun(runId, {
          outcome: 'failed',
          finishedAt: this.now(),
          errorCode: 'START_FAILED',
          detail: message
        })!
      } else {
        run = this.deps.store.record({
          id: runId,
          scheduleId: schedule.id,
          dueAt,
          at,
          outcome: 'failed',
          threadId: null,
          detail: message,
          errorCode: 'START_FAILED',
          eventKey: options?.eventKey ?? null
        })
      }
      // A schedule that keeps failing is turned off, and says why, instead of failing every hour unseen.
      this.deps.store.settle(
        schedule.id,
        failures >= SCHEDULE_LIMITS.failuresBeforePause
          ? { nextRunAt: null, lastRunAt: at, failures, off: 'failures' }
          : next === null && schedule.rule.kind === 'once'
            ? { nextRunAt: null, lastRunAt: at, failures, off: 'done' }
            : { nextRunAt: next, lastRunAt: at, failures }
      )
      this.deps.notify?.({
        kind: 'failed',
        scheduleId: schedule.id,
        runId: run.id,
        title: schedule.name,
        body: message
      })
      void this.drainQueue()
    }

    this.emitChanged(schedule, run)
    return run
  }

  private async drainQueue(): Promise<void> {
    if (this.draining || this.deps.store.paused()) return
    this.draining = true
    try {
      while (this.queue.length > 0 && this.activeRuns.size < this.deps.store.maxConcurrent()) {
        const nextItem = this.queue.shift()!
        const schedule = this.deps.store.get(nextItem.scheduleId)
        if (!schedule || !schedule.enabled) {
          this.deps.store.updateRun(nextItem.runId, {
            outcome: 'failed',
            finishedAt: this.now(),
            errorCode: 'CANCELLED',
            detail: 'Automation disabled or removed while queued.'
          })
          continue
        }
        await this.launchRun(nextItem.runId, schedule, nextItem.dueAt, nextItem.next, true, {
          eventKey: nextItem.eventKey,
          detail: nextItem.detail
        })
      }
    } finally {
      this.draining = false
    }
  }
}
