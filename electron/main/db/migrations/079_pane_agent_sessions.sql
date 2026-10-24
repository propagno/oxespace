-- The native session of the agent running in a Code pane (Claude Code or Codex),
-- reported by the agent's own hooks. After an app restart the pane can start the
-- agent again on that session (claude --resume <id>, codex resume <id>).
-- One row per pane; it goes with the pane and when the agent ends its session.
CREATE TABLE IF NOT EXISTS pane_agent_sessions (
  pane_id TEXT PRIMARY KEY REFERENCES panes(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK(agent IN ('claude', 'codex')),
  session_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 79;
