CREATE TABLE IF NOT EXISTS mcp_thread_handoffs (
  origin_thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  destination_thread_id TEXT NOT NULL UNIQUE REFERENCES conversation_threads(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (origin_thread_id, request_key)
);

CREATE TABLE IF NOT EXISTS mcp_thread_handoff_sends (
  destination_thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('started', 'submitted', 'unknown')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (destination_thread_id, request_key)
);

PRAGMA user_version = 63;
