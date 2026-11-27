-- OXE-467: widens pane_agent_sessions's agent CHECK to include antigravity alongside claude and codex,
-- preserving all existing rows, the panes(id) cascade foreign key, and the permission_mode constraint.
DROP TABLE IF EXISTS pane_agent_sessions_new;
CREATE TABLE pane_agent_sessions_new (
  pane_id TEXT PRIMARY KEY REFERENCES panes(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK(agent IN ('claude', 'codex', 'antigravity')),
  session_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  permission_mode TEXT CHECK (permission_mode IS NULL OR permission_mode IN ('default', 'acceptEdits', 'plan', 'bypassPermissions'))
);
INSERT INTO pane_agent_sessions_new (pane_id, agent, session_id, updated_at, permission_mode)
  SELECT pane_id, agent, session_id, updated_at, permission_mode FROM pane_agent_sessions;
DROP TABLE pane_agent_sessions;
ALTER TABLE pane_agent_sessions_new RENAME TO pane_agent_sessions;

PRAGMA user_version = 113;
