-- Permission rules can name MCP tools: kind 'tool', pattern 'server/tool' or
-- 'server/*'. SQLite cannot widen a CHECK in place, so the table is rebuilt
-- with its rows.
CREATE TABLE permission_rules_next (
  id TEXT PRIMARY KEY,
  project_root TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('command', 'path', 'tool')),
  pattern TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allow', 'deny')),
  created_at INTEGER NOT NULL
);
INSERT INTO permission_rules_next (id, project_root, kind, pattern, decision, created_at)
  SELECT id, project_root, kind, pattern, decision, created_at FROM permission_rules;
DROP TABLE permission_rules;
ALTER TABLE permission_rules_next RENAME TO permission_rules;
CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_rules_unique
  ON permission_rules(COALESCE(project_root, ''), kind, pattern, decision);

PRAGMA user_version = 73;
