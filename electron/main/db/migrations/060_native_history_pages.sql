-- Earlier native messages live outside the live event journal. Prepending them
-- must never renumber operations or rewrite events produced by an active turn.
CREATE TABLE IF NOT EXISTS conversation_native_history (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq < 0),
  event_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (thread_id, seq),
  UNIQUE (thread_id, event_id)
);
PRAGMA user_version = 60;
