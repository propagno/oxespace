-- OxeQuery saved queries and run history, per connection. Deleting a connection
-- removes both. History keeps one row per distinct statement (the newest run).
CREATE TABLE IF NOT EXISTS oxequery_saved_queries (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES oxequery_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sql TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oxequery_saved_connection ON oxequery_saved_queries(connection_id, name);

CREATE TABLE IF NOT EXISTS oxequery_query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL REFERENCES oxequery_connections(id) ON DELETE CASCADE,
  sql TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  duration_ms INTEGER,
  row_count INTEGER,
  ok INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_oxequery_history_connection ON oxequery_query_history(connection_id, ran_at DESC);

PRAGMA user_version = 69;
