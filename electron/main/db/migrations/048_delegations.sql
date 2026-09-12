CREATE TABLE IF NOT EXISTS delegation_settings (project TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY, origin_execution TEXT NOT NULL, request_key TEXT NOT NULL,
  workspace_id TEXT NOT NULL, payload TEXT NOT NULL,
  UNIQUE(origin_execution, request_key)
);
CREATE TABLE IF NOT EXISTS delegation_events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES delegations(id),
  kind TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS delegation_events_task ON delegation_events(task_id, cursor);
PRAGMA user_version = 48;
