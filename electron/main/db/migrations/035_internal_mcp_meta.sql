-- Singleton row tracking the internal MCP server identity (port + token).
-- Survives across app restarts so already-spawned agent panes keep working
-- with the env they cached at spawn time. `server_row_id` is the FK back to
-- the row in mcp_servers (where workspace_id IS NULL AND name = 'oxespace').
CREATE TABLE IF NOT EXISTS internal_mcp_meta (
  id TEXT PRIMARY KEY,
  port INTEGER NOT NULL,
  token TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  server_row_id TEXT
);

PRAGMA user_version = 35;
