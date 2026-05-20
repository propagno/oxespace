CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  /** When workspace_id is null the server is global (available in all workspaces). */
  workspace_id TEXT,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('stdio', 'http', 'sse')),
  /** JSON: { command, args[], env{}, url, headers{} } depending on transport. */
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_workspace ON mcp_servers(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(COALESCE(workspace_id, ''), name);

PRAGMA user_version = 24;
