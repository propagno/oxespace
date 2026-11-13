import { randomUUID } from 'node:crypto'
import { SCHEDULE_LIMITS, localDayStart, type Schedule, type ScheduleInput, type ScheduleRule, type ScheduleRun, type ScheduleRunOutcome } from '../../../../shared/schedule'
import type { AppDatabase } from '../../db/index'

interface ScheduleRow {
  id: string; name: string; project_id: string; root_path: string; provider: Schedule['provider']; model: string | null; access: Schedule['access']; prompt: string; rule_json: string
  enabled: number; catch_up: number; created_at: number; updated_at: number; next_run_at: number | null; last_run_at: number | null; failures: number; paused_reason: Schedule['pausedReason']
}
interface RunRow { id: string; schedule_id: string; due_at: number; at: number; outcome: ScheduleRunOutcome; thread_id: string | null; detail: string | null }

function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id, name: row.name, projectId: row.project_id, rootPath: row.root_path, provider: row.provider, model: row.model, access: row.access, prompt: row.prompt,
    rule: JSON.parse(row.rule_json) as ScheduleRule, enabled: row.enabled === 1, catchUp: row.catch_up === 1, createdAt: row.created_at, updatedAt: row.updated_at,
    nextRunAt: row.next_run_at, lastRunAt: row.last_run_at, failures: row.failures, pausedReason: row.paused_reason
  }
}
const toRun = (row: RunRow): ScheduleRun => ({ id: row.id, scheduleId: row.schedule_id, dueAt: row.due_at, at: row.at, outcome: row.outcome, threadId: row.thread_id, detail: row.detail })

/** What the person set up and what happened each time, in the app's database. No rule of when or whether to run is here. */
export class ScheduleStore {
  constructor(private readonly db: AppDatabase) {}

  list(): Schedule[] {
    return (this.db.prepare('SELECT * FROM schedules ORDER BY created_at ASC').all() as ScheduleRow[]).map(toSchedule)
  }

  get(id: string): Schedule | null {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined
    return row ? toSchedule(row) : null
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM schedules').get() as { n: number }).n
  }

  /** Writes a new schedule or the changes to one. `nextRunAt` is the caller's: the store does not know the rules. */
  save(input: ScheduleInput, now: number, nextRunAt: number | null): Schedule {
    const id = input.id ?? randomUUID()
    const enabled = input.enabled === false ? 0 : 1
    this.db.prepare(`INSERT INTO schedules (id, name, project_id, root_path, provider, model, access, prompt, rule_json, enabled, catch_up, created_at, updated_at, next_run_at, failures, paused_reason)
      VALUES (@id, @name, @projectId, @rootPath, @provider, @model, @access, @prompt, @rule, @enabled, @catchUp, @now, @now, @nextRunAt, 0, NULL)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, project_id=excluded.project_id, root_path=excluded.root_path, provider=excluded.provider, model=excluded.model, access=excluded.access,
        prompt=excluded.prompt, rule_json=excluded.rule_json, enabled=excluded.enabled, catch_up=excluded.catch_up, updated_at=excluded.updated_at, next_run_at=excluded.next_run_at, failures=0, paused_reason=NULL`)
      .run({ id, name: input.name.trim(), projectId: input.projectId, rootPath: input.rootPath, provider: input.provider, model: input.model?.trim() || null, access: input.access, prompt: input.prompt, rule: JSON.stringify(input.rule), enabled, catchUp: input.catchUp ? 1 : 0, now, nextRunAt })
    return this.get(id)!
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id).changes > 0
  }

  /** On or off by the person: turning it on clears a pause OXESpace made and starts the failure count again. */
  setEnabled(id: string, enabled: boolean, now: number, nextRunAt: number | null): void {
    this.db.prepare('UPDATE schedules SET enabled = ?, next_run_at = ?, updated_at = ?, failures = CASE WHEN ? = 1 THEN 0 ELSE failures END, paused_reason = CASE WHEN ? = 1 THEN NULL ELSE paused_reason END WHERE id = ?')
      .run(enabled ? 1 : 0, nextRunAt, now, enabled ? 1 : 0, enabled ? 1 : 0, id)
  }

  /** After a decision on a due schedule: when it is next due, and how the run it made (if any) went. */
  settle(id: string, change: { nextRunAt: number | null; lastRunAt?: number; failures?: number; off?: Schedule['pausedReason'] | 'done' }): void {
    const current = this.get(id)
    if (!current) return
    const off = change.off !== undefined
    this.db.prepare('UPDATE schedules SET next_run_at = ?, last_run_at = ?, failures = ?, enabled = ?, paused_reason = ? WHERE id = ?')
      .run(off ? null : change.nextRunAt, change.lastRunAt ?? current.lastRunAt, change.failures ?? current.failures, off ? 0 : (current.enabled ? 1 : 0), change.off === 'failures' ? 'failures' : current.pausedReason, id)
  }

  record(run: Omit<ScheduleRun, 'id'>): ScheduleRun {
    const id = randomUUID()
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO schedule_runs (id, schedule_id, due_at, at, outcome, thread_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, run.scheduleId, run.dueAt, run.at, run.outcome, run.threadId, run.detail?.slice(0, 300) ?? null)
      // Each schedule keeps its last runs only.
      this.db.prepare('DELETE FROM schedule_runs WHERE schedule_id = ? AND id NOT IN (SELECT id FROM schedule_runs WHERE schedule_id = ? ORDER BY at DESC, rowid DESC LIMIT ?)')
        .run(run.scheduleId, run.scheduleId, SCHEDULE_LIMITS.history)
    })()
    return { ...run, id }
  }

  runs(scheduleId: string): ScheduleRun[] {
    return (this.db.prepare('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY at DESC, rowid DESC LIMIT ?').all(scheduleId, SCHEDULE_LIMITS.history) as RunRow[]).map(toRun)
  }

  /** The conversation the schedule's last run opened, if it opened one. */
  lastThread(scheduleId: string): string | null {
    return (this.db.prepare("SELECT thread_id FROM schedule_runs WHERE schedule_id = ? AND outcome = 'started' ORDER BY at DESC, rowid DESC LIMIT 1").get(scheduleId) as { thread_id: string | null } | undefined)?.thread_id ?? null
  }

  /** How many runs the schedule started in the local day `now` falls in. */
  startedToday(scheduleId: string, now: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM schedule_runs WHERE schedule_id = ? AND outcome = 'started' AND at >= ?").get(scheduleId, localDayStart(now)) as { n: number }).n
  }

  paused(): boolean {
    return (this.db.prepare('SELECT paused FROM schedule_settings WHERE id = 1').get() as { paused: number } | undefined)?.paused === 1
  }

  setPaused(paused: boolean): void {
    this.db.prepare('INSERT INTO schedule_settings (id, paused) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET paused = excluded.paused').run(paused ? 1 : 0)
  }
}
