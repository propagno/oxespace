import type { Schedule, ScheduleInput, ScheduleRun, SchedulesState } from '../schedule'

/** What a call that can be refused answers: the result, or the reason in one word (`shared/schedule.ts` names them). */
export type ScheduleAnswer<T> = { ok: true; value: T } | { ok: false; refusal: string }

/** A run was decided: which schedule, and how it went. Never the request's text. */
export interface ScheduleEvent { scheduleId: string; name: string; outcome: ScheduleRun['outcome']; threadId: string | null }

/** `window.oxe.schedules`: the person's schedules. No agent, phone or command-bar entry reaches it. */
export interface SchedulesApi {
  state(): Promise<SchedulesState>
  runs(scheduleId: string): Promise<ScheduleRun[]>
  save(input: ScheduleInput): Promise<ScheduleAnswer<Schedule>>
  remove(scheduleId: string): Promise<void>
  setEnabled(input: { id: string; enabled: boolean }): Promise<ScheduleAnswer<void>>
  /** "Pause all": nothing runs while it is on. */
  setPaused(paused: boolean): Promise<void>
  runNow(scheduleId: string): Promise<ScheduleAnswer<ScheduleRun>>
  /** After anything changed; with an event when a run was decided. */
  onChanged(listener: (event?: ScheduleEvent) => void): () => void
}
