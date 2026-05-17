CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  label TEXT NOT NULL,
  command TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  exit_code INTEGER,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_background_jobs_workspace ON background_jobs(workspace_id, started_at DESC);

PRAGMA user_version = 20;
