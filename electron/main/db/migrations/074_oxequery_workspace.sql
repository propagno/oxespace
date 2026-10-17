-- OxeQuery workspace per connection: the open query tabs (title and SQL) and which one was
-- active, so closing the app or the connection does not lose what was being written.
-- Results are never stored. Deleting a connection removes its workspace.
CREATE TABLE IF NOT EXISTS oxequery_workspaces (
  connection_id TEXT PRIMARY KEY REFERENCES oxequery_connections(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 74;
