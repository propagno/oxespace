/**
 * Persistence for automations and their runs.
 *
 * Kept in its own SQLite file rather than the main application database: the
 * data is self-contained, so it needs no cross-table migration and cannot
 * collide with schema work happening elsewhere in the app.
 */
import Database from 'better-sqlite3'
import type { Database as DatabaseHandle } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  Automation,
  AutomationInput,
  AutomationRun,
  AutomationRunStatus,
  AutomationSchedule
} from '../../../../shared/types/automation'

const SCHEMA_VERSION = 1
const RUNS_KEPT_PER_AUTOMATION = 100

interface AutomationRow {
  id: string; name: string; prompt: string; root_path: string; agent: string; base_branch: string | null
  schedule_json: string; precheck: string | null; extra_args: string; timeout_minutes: number
  grace_minutes: number; enabled: number; created_at: number; last_run_at: number | null; next_run_at: number | null
}

interface RunRow {
  id: string; automation_id: string; scheduled_for: number; status: string; started_at: number | null
  finished_at: number | null; worktree_path: string | null; branch: string | null; exit_code: number | null
  output_tail: string; message: string | null
}

const toAutomation = (r: AutomationRow): Automation => ({
  id: r.id,
  name: r.name,
  prompt: r.prompt,
  rootPath: r.root_path,
  agent: r.agent === 'codex' ? 'codex' : 'claude',
  baseBranch: r.base_branch,
  schedule: JSON.parse(r.schedule_json) as AutomationSchedule,
  precheck: r.precheck,
  extraArgs: r.extra_args,
  timeoutMinutes: r.timeout_minutes,
  graceMinutes: r.grace_minutes,
  enabled: r.enabled === 1,
  createdAt: r.created_at,
  lastRunAt: r.last_run_at,
  nextRunAt: r.next_run_at
})

const toRun = (r: RunRow): AutomationRun => ({
  id: r.id,
  automationId: r.automation_id,
  scheduledFor: r.scheduled_for,
  status: r.status as AutomationRunStatus,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  worktreePath: r.worktree_path,
  branch: r.branch,
  exitCode: r.exit_code,
  outputTail: r.output_tail,
  message: r.message
})

export class AutomationStore {
  private readonly db: DatabaseHandle

  constructor(filePath: string) {
    this.db = new Database(filePath)
    this.db.pragma('journal_mode = WAL')
    if ((this.db.pragma('user_version', { simple: true }) as number) < SCHEMA_VERSION) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS automations (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, root_path TEXT NOT NULL,
          agent TEXT NOT NULL, base_branch TEXT, schedule_json TEXT NOT NULL, precheck TEXT,
          extra_args TEXT NOT NULL DEFAULT '', timeout_minutes INTEGER NOT NULL DEFAULT 30,
          grace_minutes INTEGER NOT NULL DEFAULT 15, enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL, last_run_at INTEGER, next_run_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS automation_runs (
          id TEXT PRIMARY KEY,
          automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
          scheduled_for INTEGER NOT NULL, status TEXT NOT NULL, started_at INTEGER, finished_at INTEGER,
          worktree_path TEXT, branch TEXT, exit_code INTEGER, output_tail TEXT NOT NULL DEFAULT '', message TEXT,
          UNIQUE (automation_id, scheduled_for)
        );
        CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs(automation_id, scheduled_for DESC);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `)
    }
    this.db.pragma('foreign_keys = ON')
  }

  close(): void {
    this.db.close()
  }

  list(): Automation[] {
    return (this.db.prepare('SELECT * FROM automations ORDER BY created_at').all() as AutomationRow[]).map(toAutomation)
  }

  get(id: string): Automation | null {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as AutomationRow | undefined
    return row ? toAutomation(row) : null
  }

  create(input: AutomationInput, nextRunAt: number | null, now: number): Automation {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO automations (id, name, prompt, root_path, agent, base_branch, schedule_json, precheck, extra_args,
           timeout_minutes, grace_minutes, enabled, created_at, next_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id, input.name, input.prompt, input.rootPath, input.agent, input.baseBranch ?? null,
        JSON.stringify(input.schedule), input.precheck ?? null, input.extraArgs ?? '',
        input.timeoutMinutes ?? 30, input.graceMinutes ?? 15, input.enabled === false ? 0 : 1, now, nextRunAt
      )
    return this.get(id)!
  }

  setEnabled(id: string, enabled: boolean, nextRunAt: number | null): void {
    this.db.prepare('UPDATE automations SET enabled = ?, next_run_at = ? WHERE id = ?').run(enabled ? 1 : 0, nextRunAt, id)
  }

  setNextRun(id: string, nextRunAt: number | null): void {
    this.db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?').run(nextRunAt, id)
  }

  touchLastRun(id: string, at: number): void {
    this.db.prepare('UPDATE automations SET last_run_at = ? WHERE id = ?').run(at, id)
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(id)
  }

  /** Inserts a run unless one already exists for that occurrence; returns null when it does. */
  createRun(automationId: string, scheduledFor: number, status: AutomationRunStatus, message: string | null = null): AutomationRun | null {
    const id = randomUUID()
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO automation_runs (id, automation_id, scheduled_for, status, message, finished_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, automationId, scheduledFor, status, message, status === 'pending' ? null : Date.now())
    if (result.changes === 0) return null
    this.prune(automationId)
    return this.getRun(id)
  }

  getRun(id: string): AutomationRun | null {
    const row = this.db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as RunRow | undefined
    return row ? toRun(row) : null
  }

  updateRun(
    id: string,
    patch: Partial<Pick<AutomationRun, 'status' | 'startedAt' | 'finishedAt' | 'worktreePath' | 'branch' | 'exitCode' | 'outputTail' | 'message'>>
  ): AutomationRun | null {
    const columns: Record<string, string> = {
      status: 'status', startedAt: 'started_at', finishedAt: 'finished_at', worktreePath: 'worktree_path',
      branch: 'branch', exitCode: 'exit_code', outputTail: 'output_tail', message: 'message'
    }
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, column] of Object.entries(columns)) {
      if (key in patch) {
        sets.push(`${column} = ?`)
        values.push((patch as Record<string, unknown>)[key])
      }
    }
    if (sets.length > 0) this.db.prepare(`UPDATE automation_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    return this.getRun(id)
  }

  listRuns(automationId: string, limit = 20): AutomationRun[] {
    return (
      this.db
        .prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY scheduled_for DESC LIMIT ?')
        .all(automationId, limit) as RunRow[]
    ).map(toRun)
  }

  hasActiveRun(automationId: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM automation_runs WHERE automation_id = ? AND status IN ('pending','running') LIMIT 1")
      .get(automationId)
  }

  /** A run left in flight by a previous process can never finish; mark it so. */
  failInterruptedRuns(now: number): number {
    return this.db
      .prepare(
        "UPDATE automation_runs SET status = 'failed', finished_at = ?, message = 'Interrupted: the application was closed.' WHERE status IN ('pending','running')"
      )
      .run(now).changes
  }

  private prune(automationId: string): void {
    this.db
      .prepare(
        `DELETE FROM automation_runs WHERE automation_id = ? AND status NOT IN ('pending','running') AND id NOT IN (
           SELECT id FROM automation_runs WHERE automation_id = ? ORDER BY scheduled_for DESC LIMIT ?)`
      )
      .run(automationId, automationId, RUNS_KEPT_PER_AUTOMATION)
  }
}
