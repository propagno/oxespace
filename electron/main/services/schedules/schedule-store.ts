import { randomUUID } from 'node:crypto'
import {
  SCHEDULE_LIMITS,
  eventConfigOf,
  localDayStart,
  triggerKindOf,
  type ReviewQueueItem,
  type Schedule,
  type ScheduleEventConfig,
  type ScheduleInput,
  type ScheduleReviewStatus,
  type ScheduleRule,
  type ScheduleRun,
  type ScheduleRunOutcome,
  type ScheduleTokenUsage,
  type ScheduleTriggerKind
} from '../../../../shared/schedule'
import type { AppDatabase } from '../../db/index'

interface ScheduleRow {
  id: string
  name: string
  project_id: string
  root_path: string
  provider: Schedule['provider']
  model: string | null
  access: Schedule['access']
  prompt: string
  rule_json: string
  trigger_kind: ScheduleTriggerKind
  event_config_json: string | null
  timeout_ms: number
  enabled: number
  catch_up: number
  created_at: number
  updated_at: number
  next_run_at: number | null
  last_run_at: number | null
  failures: number
  paused_reason: Schedule['pausedReason']
}

interface RunRow {
  id: string
  schedule_id: string
  due_at: number
  at: number
  outcome: ScheduleRunOutcome
  thread_id: string | null
  detail: string | null
  worktree_path: string | null
  branch_name: string | null
  base_sha: string | null
  finished_at: number | null
  summary_md: string | null
  files_changed: number
  additions: number
  deletions: number
  pr_url: string | null
  error_code: string | null
  event_key: string | null
  token_usage_json: string | null
  review_status: ScheduleReviewStatus
}

interface ReviewJoinRow extends RunRow {
  schedule_name: string
  project_id: string
  root_path: string
  provider: Schedule['provider']
  access: Schedule['access']
}

function safeJsonParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function toSchedule(row: ScheduleRow): Schedule {
  const rule = JSON.parse(row.rule_json) as ScheduleRule
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    rootPath: row.root_path,
    provider: row.provider,
    model: row.model,
    access: row.access,
    prompt: row.prompt,
    rule,
    triggerKind: row.trigger_kind ?? triggerKindOf(rule),
    eventConfig: safeJsonParse<ScheduleEventConfig>(row.event_config_json) ?? eventConfigOf(rule),
    timeoutMs: row.timeout_ms ?? SCHEDULE_LIMITS.defaultTimeoutMs,
    enabled: row.enabled === 1,
    catchUp: row.catch_up === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    failures: row.failures,
    pausedReason: row.paused_reason
  }
}

function toRun(row: RunRow): ScheduleRun {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    dueAt: row.due_at,
    at: row.at,
    outcome: row.outcome,
    threadId: row.thread_id,
    detail: row.detail,
    worktreePath: row.worktree_path ?? null,
    branchName: row.branch_name ?? null,
    baseSha: row.base_sha ?? null,
    finishedAt: row.finished_at ?? null,
    summaryMd: row.summary_md ?? null,
    filesChanged: row.files_changed ?? 0,
    additions: row.additions ?? 0,
    deletions: row.deletions ?? 0,
    prUrl: row.pr_url ?? null,
    errorCode: row.error_code ?? null,
    eventKey: row.event_key ?? null,
    tokenUsage: safeJsonParse<ScheduleTokenUsage>(row.token_usage_json),
    reviewStatus: row.review_status ?? null
  }
}

const STARTED_OUTCOMES = "'started', 'queued', 'running', 'waiting_approval', 'needs_review', 'approved', 'merged', 'discarded', 'timed_out'"

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
    const triggerKind = triggerKindOf(input.rule)
    const eventConfig = eventConfigOf(input.rule)
    const timeoutMs = input.timeoutMs ?? SCHEDULE_LIMITS.defaultTimeoutMs
    this.db.prepare(`INSERT INTO schedules (
        id, name, project_id, root_path, provider, model, access, prompt, rule_json,
        trigger_kind, event_config_json, timeout_ms, enabled, catch_up, created_at, updated_at, next_run_at, failures, paused_reason
      )
      VALUES (
        @id, @name, @projectId, @rootPath, @provider, @model, @access, @prompt, @rule,
        @triggerKind, @eventConfigJson, @timeoutMs, @enabled, @catchUp, @now, @now, @nextRunAt, 0, NULL
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        project_id=excluded.project_id,
        root_path=excluded.root_path,
        provider=excluded.provider,
        model=excluded.model,
        access=excluded.access,
        prompt=excluded.prompt,
        rule_json=excluded.rule_json,
        trigger_kind=excluded.trigger_kind,
        event_config_json=excluded.event_config_json,
        timeout_ms=excluded.timeout_ms,
        enabled=excluded.enabled,
        catch_up=excluded.catch_up,
        updated_at=excluded.updated_at,
        next_run_at=excluded.next_run_at,
        failures=0,
        paused_reason=NULL`)
      .run({
        id,
        name: input.name.trim(),
        projectId: input.projectId,
        rootPath: input.rootPath,
        provider: input.provider,
        model: input.model?.trim() || null,
        access: input.access,
        prompt: input.prompt,
        rule: JSON.stringify(input.rule),
        triggerKind,
        eventConfigJson: eventConfig ? JSON.stringify(eventConfig) : null,
        timeoutMs,
        enabled,
        catchUp: input.catchUp ? 1 : 0,
        now,
        nextRunAt
      })
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

  record(run: Omit<ScheduleRun, 'id'> & { id?: string }): ScheduleRun {
    const id = run.id ?? randomUUID()
    const detail = run.detail ? run.detail.slice(0, 300) : null
    const summaryMd = run.summaryMd ?? null
    const filesChanged = run.filesChanged ?? 0
    const additions = run.additions ?? 0
    const deletions = run.deletions ?? 0
    const tokenUsageJson = run.tokenUsage ? JSON.stringify(run.tokenUsage) : null
    const reviewStatus: ScheduleReviewStatus = run.reviewStatus ?? (run.outcome === 'needs_review' ? 'pending' : null)
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO schedule_runs (
          id, schedule_id, due_at, at, outcome, thread_id, detail,
          worktree_path, branch_name, base_sha, finished_at, summary_md,
          files_changed, additions, deletions, pr_url, error_code, event_key, token_usage_json, review_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          run.scheduleId,
          run.dueAt,
          run.at,
          run.outcome,
          run.threadId,
          detail,
          run.worktreePath ?? null,
          run.branchName ?? null,
          run.baseSha ?? null,
          run.finishedAt ?? null,
          summaryMd,
          filesChanged,
          additions,
          deletions,
          run.prUrl ?? null,
          run.errorCode ?? null,
          run.eventKey ?? null,
          tokenUsageJson,
          reviewStatus
        )
      // Each schedule keeps its last runs, while never pruning active or pending-review runs.
      this.db.prepare(`DELETE FROM schedule_runs
        WHERE schedule_id = ?
          AND outcome NOT IN ('queued', 'running', 'waiting_approval', 'needs_review')
          AND COALESCE(review_status, '') != 'pending'
          AND id NOT IN (SELECT id FROM schedule_runs WHERE schedule_id = ? ORDER BY at DESC, rowid DESC LIMIT ?)`)
        .run(run.scheduleId, run.scheduleId, SCHEDULE_LIMITS.history)
    })()
    return this.getRun(id)!
  }

  getRun(runId: string): ScheduleRun | null {
    const row = this.db.prepare('SELECT * FROM schedule_runs WHERE id = ?').get(runId) as RunRow | undefined
    return row ? toRun(row) : null
  }

  updateRun(runId: string, patch: Partial<ScheduleRun>): ScheduleRun | null {
    const current = this.getRun(runId)
    if (!current) return null
    const next: ScheduleRun = {
      ...current,
      ...patch,
      id: current.id,
      scheduleId: current.scheduleId
    }
    this.db.prepare(`UPDATE schedule_runs SET
        outcome = ?,
        thread_id = ?,
        detail = ?,
        worktree_path = ?,
        branch_name = ?,
        base_sha = ?,
        finished_at = ?,
        summary_md = ?,
        files_changed = ?,
        additions = ?,
        deletions = ?,
        pr_url = ?,
        error_code = ?,
        event_key = ?,
        token_usage_json = ?,
        review_status = ?
      WHERE id = ?`)
      .run(
        next.outcome,
        next.threadId ?? null,
        next.detail ? next.detail.slice(0, 300) : null,
        next.worktreePath ?? null,
        next.branchName ?? null,
        next.baseSha ?? null,
        next.finishedAt ?? null,
        next.summaryMd ?? null,
        next.filesChanged ?? 0,
        next.additions ?? 0,
        next.deletions ?? 0,
        next.prUrl ?? null,
        next.errorCode ?? null,
        next.eventKey ?? null,
        next.tokenUsage ? JSON.stringify(next.tokenUsage) : null,
        next.reviewStatus ?? null,
        runId
      )
    return this.getRun(runId)
  }

  runs(scheduleId: string): ScheduleRun[] {
    return (this.db.prepare('SELECT * FROM schedule_runs WHERE schedule_id = ? ORDER BY at DESC, rowid DESC LIMIT ?').all(scheduleId, SCHEDULE_LIMITS.history) as RunRow[]).map(toRun)
  }

  /** The conversation the schedule's last run opened, if it opened one. */
  lastThread(scheduleId: string): string | null {
    return (this.db.prepare(`SELECT thread_id FROM schedule_runs WHERE schedule_id = ? AND outcome IN ('started', 'running', 'waiting_approval') ORDER BY at DESC, rowid DESC LIMIT 1`).get(scheduleId) as { thread_id: string | null } | undefined)?.thread_id ?? null
  }

  /** How many runs the schedule started in the local day `now` falls in. */
  startedToday(scheduleId: string, now: number): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM schedule_runs WHERE schedule_id = ? AND outcome IN (${STARTED_OUTCOMES}) AND at >= ?`).get(scheduleId, localDayStart(now)) as { n: number }).n
  }

  /** True if an event run with `(scheduleId, eventKey)` already exists (deduplication). */
  hasEventKey(scheduleId: string, eventKey: string): boolean {
    const row = this.db.prepare('SELECT 1 AS hit FROM schedule_runs WHERE schedule_id = ? AND event_key = ? LIMIT 1').get(scheduleId, eventKey) as { hit: number } | undefined
    return Boolean(row?.hit)
  }

  /** Timestamp of the most recent event-keyed run for cooldown enforcement. */
  lastEventRunAt(scheduleId: string): number | null {
    const row = this.db.prepare('SELECT at FROM schedule_runs WHERE schedule_id = ? AND event_key IS NOT NULL ORDER BY at DESC, rowid DESC LIMIT 1').get(scheduleId) as { at: number } | undefined
    return row?.at ?? null
  }

  /** All runs currently in `needs_review` (`review_status = 'pending'`), newest first. */
  listReviewQueue(): ReviewQueueItem[] {
    const rows = this.db.prepare(`SELECT r.*, s.name AS schedule_name, s.project_id, s.root_path, s.provider, s.access
      FROM schedule_runs r
      INNER JOIN schedules s ON s.id = r.schedule_id
      WHERE r.outcome = 'needs_review' AND r.review_status = 'pending'
      ORDER BY COALESCE(r.finished_at, r.at) DESC, r.rowid DESC`).all() as ReviewJoinRow[]
    return rows.map(row => ({
      run: toRun(row),
      scheduleName: row.schedule_name,
      projectId: row.project_id,
      rootPath: row.root_path,
      provider: row.provider,
      access: row.access
    }))
  }

  pendingReviewCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM schedule_runs WHERE outcome = 'needs_review' AND review_status = 'pending'").get() as { n: number }).n
  }

  paused(): boolean {
    return (this.db.prepare('SELECT paused FROM schedule_settings WHERE id = 1').get() as { paused: number } | undefined)?.paused === 1
  }

  setPaused(paused: boolean): void {
    this.db.prepare('INSERT INTO schedule_settings (id, paused) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET paused = excluded.paused').run(paused ? 1 : 0)
  }

  maxConcurrent(): number {
    const raw = (this.db.prepare('SELECT max_concurrent FROM schedule_settings WHERE id = 1').get() as { max_concurrent: number } | undefined)?.max_concurrent
    return typeof raw === 'number' && raw >= 1 ? raw : SCHEDULE_LIMITS.defaultMaxConcurrent
  }

  setMaxConcurrent(value: number): number {
    this.db.prepare('INSERT INTO schedule_settings (id, paused, max_concurrent) VALUES (1, 0, ?) ON CONFLICT(id) DO UPDATE SET max_concurrent = excluded.max_concurrent').run(value)
    return this.maxConcurrent()
  }
}
