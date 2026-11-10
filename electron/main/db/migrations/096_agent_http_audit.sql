-- Append-only trail of HTTP calls made by AI agents via shell tools (hook or Codex rollout).
-- Header values, query values, request bodies and response stdout are never stored.
CREATE TABLE IF NOT EXISTS agent_http_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  session_id TEXT,
  source TEXT NOT NULL,
  tool_use_id TEXT NOT NULL,
  call_index INTEGER NOT NULL,
  tool TEXT NOT NULL,
  method TEXT NOT NULL,
  scheme TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  path_template TEXT NOT NULL,
  query_keys_json TEXT NOT NULL,
  header_names_json TEXT NOT NULL,
  has_body INTEGER NOT NULL DEFAULT 0,
  body_bytes INTEGER,
  status INTEGER,
  duration_ms INTEGER,
  insecure INTEGER NOT NULL DEFAULT 0,
  plain_http_external INTEGER NOT NULL DEFAULT 0,
  command_redacted TEXT NOT NULL,
  output_truncated INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tool_use_id, call_index)
);

CREATE INDEX IF NOT EXISTS idx_agent_http_audit_ts ON agent_http_audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_http_audit_workspace ON agent_http_audit(workspace_id, ts DESC);

CREATE TRIGGER IF NOT EXISTS agent_http_audit_no_update BEFORE UPDATE ON agent_http_audit
BEGIN SELECT RAISE(ABORT, 'agent_http_audit is append-only'); END;

-- H1-6 (TECH LEAD G-b): nullable file edit columns on agent_action_audit.
ALTER TABLE agent_action_audit ADD COLUMN path TEXT;
ALTER TABLE agent_action_audit ADD COLUMN line INTEGER;
ALTER TABLE agent_action_audit ADD COLUMN added INTEGER;
ALTER TABLE agent_action_audit ADD COLUMN removed INTEGER;

PRAGMA user_version = 96;
