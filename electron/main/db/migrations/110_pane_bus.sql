-- OXE-445: Persistent cross-provider pane bus mailbox and durable helper-pane ownership.
CREATE TABLE IF NOT EXISTS pane_bus_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  from_pane_id TEXT NOT NULL,
  to_pane_id TEXT NOT NULL,
  from_actor TEXT NOT NULL,
  from_provider TEXT,
  topic TEXT NOT NULL,
  correlation_id TEXT,
  reply_to_id TEXT,
  payload_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  hops INTEGER NOT NULL DEFAULT 0 CHECK (hops >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  acked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_pane_bus_inbox ON pane_bus_messages(to_pane_id, acked_at, expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_pane_bus_correlation ON pane_bus_messages(correlation_id, created_at);

CREATE TABLE IF NOT EXISTS pane_agent_owners (
  pane_id TEXT PRIMARY KEY,
  owner_actor_key TEXT NOT NULL,
  owner_pane_id TEXT,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

PRAGMA user_version = 110;
