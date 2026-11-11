-- F7 · A26 / S3: Provenance of Always allow rules OXESpace added to <project>/.claude/settings.local.json,
-- so list and revoke only touch rules OXESpace wrote and never delete a hand-written rule.
CREATE TABLE IF NOT EXISTS always_allow_rules (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  rule TEXT NOT NULL,
  file TEXT NOT NULL,
  project TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  thread_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_always_allow_rules_project ON always_allow_rules(project);

PRAGMA user_version = 98;
