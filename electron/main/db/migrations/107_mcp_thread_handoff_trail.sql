-- OXE-298 (CA-4): every step of an MCP handoff between Threads, kept for audit after the fact. Append-only: a row is
-- never rewritten (the trigger below); rows go with their destination Thread when it is deleted.
CREATE TABLE IF NOT EXISTS mcp_thread_handoff_trail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  destination_thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK(step IN ('create', 'send')),
  author_thread_id TEXT NOT NULL,
  author_native_session_id TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  state TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_thread_handoff_trail_destination ON mcp_thread_handoff_trail(destination_thread_id, id);

CREATE TRIGGER IF NOT EXISTS mcp_thread_handoff_trail_append_only
BEFORE UPDATE ON mcp_thread_handoff_trail
BEGIN
  SELECT RAISE(ABORT, 'mcp_thread_handoff_trail is append-only');
END;

PRAGMA user_version = 107;
