PRAGMA foreign_keys = ON;

ALTER TABLE workspaces ADD COLUMN agents_panel_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN agents_panel_expanded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN agents_panel_width_percent INTEGER NOT NULL DEFAULT 36;

CREATE TABLE IF NOT EXISTS workspace_agent_role_bindings (
  workspace_id      TEXT NOT NULL,
  role              TEXT NOT NULL,
  agent_profile_id  TEXT,
  shell_profile_id  TEXT,
  model             TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, role),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(agent_profile_id) ON DELETE SET NULL,
  FOREIGN KEY (shell_profile_id) REFERENCES shell_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agent_workflow_runs (
  id          TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id   TEXT,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_workflow_steps (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  role             TEXT NOT NULL,
  agent_profile_id TEXT,
  shell_profile_id TEXT,
  status           TEXT NOT NULL,
  prompt           TEXT NOT NULL DEFAULT '',
  output           TEXT NOT NULL DEFAULT '',
  error            TEXT,
  started_at       INTEGER,
  completed_at     INTEGER,
  FOREIGN KEY (run_id) REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_profile_id) REFERENCES agent_profiles(agent_profile_id) ON DELETE SET NULL,
  FOREIGN KEY (shell_profile_id) REFERENCES shell_profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agent_workflow_artifacts (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL,
  step_id    TEXT,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (step_id) REFERENCES agent_workflow_steps(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_runs_workspace ON agent_workflow_runs(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_workflow_steps_run ON agent_workflow_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_workflow_artifacts_run ON agent_workflow_artifacts(run_id, created_at ASC);

PRAGMA user_version = 9;
