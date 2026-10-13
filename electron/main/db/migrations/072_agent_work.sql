-- Agent Work: a supervising Thread plans tasks, each task runs in its own
-- worker Thread, and the supervisor hears back when work fails, blocks or ends.
--
-- Thread ids are plain text: a deleted conversation leaves its record of work.
CREATE TABLE IF NOT EXISTS work_runs (
  id TEXT PRIMARY KEY,
  supervisor_thread_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_root TEXT NOT NULL,
  request_key TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'blocked', 'cancelled')),
  depth INTEGER NOT NULL DEFAULT 1 CHECK(depth BETWEEN 1 AND 2),
  budget_usd REAL,
  budget_turns INTEGER,
  auto_wake INTEGER NOT NULL DEFAULT 1 CHECK(auto_wake IN (0, 1)),
  wakes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(supervisor_thread_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_work_runs_supervisor ON work_runs(supervisor_thread_id, created_at);

CREATE TABLE IF NOT EXISTS work_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES work_runs(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
  access TEXT NOT NULL CHECK(access IN ('read-only', 'workspace-write')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'ready', 'running', 'blocked', 'succeeded', 'failed', 'cancelled')),
  thread_id TEXT,
  -- Turns the worker had when the current assignment was sent; later turns are this assignment's.
  turn_base INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  result_json TEXT,
  position INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  UNIQUE(run_id, key)
);
CREATE INDEX IF NOT EXISTS idx_work_tasks_thread ON work_tasks(thread_id);
CREATE INDEX IF NOT EXISTS idx_work_tasks_status ON work_tasks(status);

CREATE TABLE IF NOT EXISTS work_edges (
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on)
);

CREATE TABLE IF NOT EXISTS work_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES work_runs(id) ON DELETE CASCADE,
  task_id TEXT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_events_run ON work_events(run_id, id);

PRAGMA user_version = 72;
