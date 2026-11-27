import type {
  ReviewActionResult,
  ReviewQueueSummary,
  ReviewRunDiff,
  Schedule,
  ScheduleInput,
  ScheduleRun,
  SchedulesState
} from '../schedule'

/** What a call that can be refused answers: the result, or the reason in one word (`shared/schedule.ts` names them). */
export type ScheduleAnswer<T> = { ok: true; value: T } | { ok: false; refusal: string }

/** A run was decided or transitioned: which schedule, and how it went. Never the request's text. */
export interface ScheduleEvent {
  scheduleId: string
  name: string
  outcome: ScheduleRun['outcome']
  threadId: string | null
  runId?: string
  reviewPendingCount?: number
}

/** `window.oxe.schedules`: the person's schedules & Review Queue. No agent, phone or command-bar entry reaches it. */
export interface SchedulesApi {
  state(): Promise<SchedulesState>
  runs(scheduleId: string): Promise<ScheduleRun[]>
  save(input: ScheduleInput): Promise<ScheduleAnswer<Schedule>>
  remove(scheduleId: string): Promise<void>
  setEnabled(input: { id: string; enabled: boolean }): Promise<ScheduleAnswer<void>>
  /** "Pause all": nothing runs while it is on. */
  setPaused(paused: boolean): Promise<void>
  /** Global concurrency cap (1..10, default 2). */
  setMaxConcurrent?(maxConcurrent: number): Promise<ScheduleAnswer<number>>
  runNow(scheduleId: string): Promise<ScheduleAnswer<ScheduleRun>>
  /** Unified Review Queue listing runs in needs_review state and pending count. */
  reviewQueue?(): Promise<ReviewQueueSummary>
  /** Structured file list + unified diff for a specific automation run. */
  reviewDiff?(runId: string): Promise<ScheduleAnswer<ReviewRunDiff>>
  /** Push automation branch and open a Pull Request, transitioning run to approved. */
  createPrFromRun?(runId: string): Promise<ScheduleAnswer<ReviewActionResult>>
  /** Apply automation changes into a clean main checkout, transitioning run to merged. */
  applyRunToCheckout?(runId: string): Promise<ScheduleAnswer<ReviewActionResult>>
  /** Unlink shared dirs, delete isolated worktree + local automation branch without touching main checkout. */
  discardRun?(runId: string): Promise<ScheduleAnswer<ReviewActionResult>>
  /** After anything changed; with an event when a run was decided or updated. */
  onChanged(listener: (event?: ScheduleEvent) => void): () => void
}
