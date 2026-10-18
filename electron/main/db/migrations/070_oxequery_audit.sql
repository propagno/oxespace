-- Append-only trail of what AI agents asked OxeQuery to do and what was decided.
-- Statement text is stored with string literals replaced (see agent-output.ts);
-- the hash is of the exact text that was approved. Rows are never updated.
CREATE TABLE IF NOT EXISTS oxequery_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  connection_id TEXT,
  connection_name TEXT,
  engine TEXT,
  environment TEXT,
  tool TEXT NOT NULL,
  text_hash TEXT,
  text TEXT,
  decision TEXT NOT NULL,
  outcome TEXT NOT NULL,
  row_count INTEGER,
  duration_ms INTEGER,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_oxequery_audit_ts ON oxequery_audit(ts DESC);
CREATE INDEX IF NOT EXISTS idx_oxequery_audit_connection ON oxequery_audit(connection_id, ts DESC);

CREATE TRIGGER IF NOT EXISTS oxequery_audit_no_update BEFORE UPDATE ON oxequery_audit
BEGIN SELECT RAISE(ABORT, 'oxequery_audit is append-only'); END;

PRAGMA user_version = 70;
