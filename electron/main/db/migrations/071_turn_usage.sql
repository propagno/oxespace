-- Thread usage ledger: one row per finished provider turn.
--
-- Claude reports the API-equivalent cost and tokens in its `result` frame
-- (usd_source 'reported'). Codex reports tokens only, so usd stays NULL.
-- thread_id is kept as text without a foreign key so deleting a conversation
-- does not rewrite the history of what was spent.
CREATE TABLE IF NOT EXISTS turn_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  project_root TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  at INTEGER NOT NULL,
  usd REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER
);
CREATE INDEX IF NOT EXISTS idx_turn_usage_at ON turn_usage(at);
CREATE INDEX IF NOT EXISTS idx_turn_usage_project ON turn_usage(project_root, at);
CREATE INDEX IF NOT EXISTS idx_turn_usage_thread ON turn_usage(thread_id, at);

PRAGMA user_version = 71;
