-- Stable event identity and an operation journal make reconnect/recovery decisions
-- explicit without changing the v1 event payload stored in conversation_events.
CREATE TABLE IF NOT EXISTS conversation_event_envelopes (
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  operation_id TEXT,
  turn_id TEXT,
  generation INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 2,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(thread_id, seq),
  UNIQUE(thread_id, event_id),
  FOREIGN KEY(thread_id, seq) REFERENCES conversation_events(thread_id, seq) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS conversation_event_envelopes_operation
  ON conversation_event_envelopes(thread_id, operation_id, seq);
CREATE TABLE IF NOT EXISTS conversation_operations (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  turn_id TEXT,
  generation INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('turn', 'queue', 'request', 'configuration', 'command', 'recovery')),
  state TEXT NOT NULL CHECK(state IN ('created', 'sent', 'acknowledged', 'running', 'completed', 'failed', 'cancelled', 'unknown')),
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversation_operations_thread_state
  ON conversation_operations(thread_id, state, updated_at DESC);
PRAGMA user_version = 55;
