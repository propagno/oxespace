CREATE TABLE IF NOT EXISTS integration_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  active_workspace_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (active_workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS integration_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  pane_id TEXT,
  root_path TEXT,
  role TEXT NOT NULL,
  alias TEXT NOT NULL,
  last_intent TEXT,
  last_result TEXT,
  blockers TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES integration_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (pane_id) REFERENCES panes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_integration_members_group ON integration_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_integration_members_workspace ON integration_group_members(workspace_id);

CREATE TABLE IF NOT EXISTS integration_group_sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  session_id TEXT NOT NULL,
  label TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES integration_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES integration_group_members(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_sessions_member_provider
  ON integration_group_sessions(member_id, provider);

CREATE TABLE IF NOT EXISTS integration_handoffs (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  from_member_id TEXT NOT NULL,
  to_member_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES integration_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (from_member_id) REFERENCES integration_group_members(id) ON DELETE CASCADE,
  FOREIGN KEY (to_member_id) REFERENCES integration_group_members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_integration_handoffs_group ON integration_handoffs(group_id, created_at DESC);

PRAGMA user_version = 32;
