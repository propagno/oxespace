CREATE TABLE IF NOT EXISTS agent_team_deliveries (
  message_id TEXT PRIMARY KEY REFERENCES agent_team_messages(id),
  thread_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('dispatching','submitted','unknown')),
  updated_at INTEGER NOT NULL
);
PRAGMA user_version = 62;
