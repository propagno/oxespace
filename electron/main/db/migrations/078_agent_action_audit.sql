-- Append-only trail of what AI agents asked the OXESpace MCP tools to do outside
-- OxeQuery (which keeps oxequery_audit): the tool and action, who asked, the
-- level (read, write, confirm), what a person decided and how it ended. Text is
-- what was shown for approval, clipped; the hash is of the full text.
CREATE TABLE IF NOT EXISTS agent_action_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  workspace_id TEXT,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  level TEXT NOT NULL,
  text_hash TEXT,
  text TEXT,
  decision TEXT NOT NULL,
  outcome TEXT NOT NULL,
  duration_ms INTEGER,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_action_audit_ts ON agent_action_audit(ts DESC);

CREATE TRIGGER IF NOT EXISTS agent_action_audit_no_update BEFORE UPDATE ON agent_action_audit
BEGIN SELECT RAISE(ABORT, 'agent_action_audit is append-only'); END;

PRAGMA user_version = 78;
