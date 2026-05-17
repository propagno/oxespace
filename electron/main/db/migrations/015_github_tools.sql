ALTER TABLE workspaces ADD COLUMN github_panel_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN github_panel_expanded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN github_panel_width_percent INTEGER NOT NULL DEFAULT 40;
ALTER TABLE workspaces ADD COLUMN github_active_tab TEXT NOT NULL DEFAULT 'status';

CREATE TABLE IF NOT EXISTS github_connected_repositories (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  full_name    TEXT NOT NULL,
  url          TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE(workspace_id, full_name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS github_checkpoints (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  branch          TEXT,
  base_commit     TEXT,
  patch           TEXT NOT NULL,
  untracked_files TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_github_checkpoints_workspace ON github_checkpoints(workspace_id, created_at DESC);

PRAGMA user_version = 15;
