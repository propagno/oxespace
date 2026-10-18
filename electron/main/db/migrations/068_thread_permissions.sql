-- Thread permission rules and the audit trail of permission decisions.
--
-- permission_rules: what OXESpace answers on its own when a Thread agent asks
-- to run a command or touch a file. project_root NULL means every project.
-- A rule never widens what the provider CLI itself allows; it only answers the
-- approval prompts the CLI raises.
CREATE TABLE IF NOT EXISTS permission_rules (
  id TEXT PRIMARY KEY,
  project_root TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('command', 'path')),
  pattern TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allow', 'deny')),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_rules_unique
  ON permission_rules(COALESCE(project_root, ''), kind, pattern, decision);

-- thread_audit: who decided what, and when. Rows are pruned after 180 days.
CREATE TABLE IF NOT EXISTS thread_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT,
  project_root TEXT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL CHECK(actor IN ('user', 'policy', 'system')),
  summary TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_thread_audit_at ON thread_audit(at);
CREATE INDEX IF NOT EXISTS idx_thread_audit_thread ON thread_audit(thread_id, at);

PRAGMA user_version = 68;
