CREATE TABLE IF NOT EXISTS conversation_threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_conversation_threads_workspace ON conversation_threads(workspace_id);
PRAGMA user_version = 53;
