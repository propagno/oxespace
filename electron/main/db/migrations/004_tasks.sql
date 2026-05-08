PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  verify_command TEXT NOT NULL DEFAULT '',
  allowed_files_json TEXT NOT NULL DEFAULT '[]',
  column_name TEXT NOT NULL DEFAULT 'backlog',
  run_status TEXT NOT NULL DEFAULT 'idle',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  agent_profile_id TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  output TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(agent_profile_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_column ON tasks(workspace_id, column_name, position);
CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON task_executions(task_id, started_at DESC);

PRAGMA user_version = 4;
