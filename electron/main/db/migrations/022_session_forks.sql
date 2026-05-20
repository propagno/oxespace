CREATE TABLE IF NOT EXISTS session_forks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  parent_session_id TEXT NOT NULL,
  fork_session_id TEXT NOT NULL,
  fork_point_message_index INTEGER NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_forks_workspace ON session_forks(workspace_id, created_at DESC);

PRAGMA user_version = 22;
