PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shell_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  executable TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  layout TEXT NOT NULL,
  default_shell_profile_id TEXT NOT NULL,
  auto_start INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (default_shell_profile_id) REFERENCES shell_profiles(id)
);

CREATE TABLE IF NOT EXISTS panes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'terminal',
  row_index INTEGER NOT NULL,
  column_index INTEGER NOT NULL,
  shell_profile_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (shell_profile_id) REFERENCES shell_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_panes_workspace_id ON panes(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_panes_workspace_position ON panes(workspace_id, row_index, column_index);

INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES
  ('builtin-claude', 'claude', 'claude', '[]', 1),
  ('builtin-copilot', 'copilot', 'copilot', '[]', 1);

PRAGMA user_version = 2;
