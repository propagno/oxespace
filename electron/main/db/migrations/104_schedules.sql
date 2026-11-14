-- Schedules (1.5.0, the user's request of 12/11): a request to an agent sent at a set time or on repeat, while the app
-- is open. `schedules` holds what the person set up; `schedule_runs` what happened each time one was due (kept short:
-- the service trims each schedule's history); `schedule_settings` is the single "pause all" switch.
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex', 'antigravity')),
  model TEXT,
  -- Never 'full-access': a schedule runs with no one watching.
  access TEXT NOT NULL CHECK (access IN ('read-only', 'workspace-write')),
  prompt TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  catch_up INTEGER NOT NULL DEFAULT 0 CHECK (catch_up IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  next_run_at INTEGER,
  last_run_at INTEGER,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  paused_reason TEXT CHECK (paused_reason IS NULL OR paused_reason IN ('failures'))
);

CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS schedule_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL,
  at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'failed', 'missed', 'skipped-busy', 'skipped-limit')),
  thread_id TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_schedule_runs_schedule ON schedule_runs(schedule_id, at DESC);

CREATE TABLE IF NOT EXISTS schedule_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1))
);

PRAGMA user_version = 104;
