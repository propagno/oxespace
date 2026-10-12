-- Legacy JSON is imported lazily and transactionally on first read.
ALTER TABLE conversation_threads ADD COLUMN history_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS conversation_events (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  turn_id TEXT,
  data_json TEXT NOT NULL,
  PRIMARY KEY(thread_id, seq)
);
CREATE INDEX IF NOT EXISTS conversation_events_turn ON conversation_events(thread_id, turn_id, seq);
CREATE TABLE IF NOT EXISTS conversation_turns (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY(thread_id, id)
);
CREATE TABLE IF NOT EXISTS conversation_artifacts (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  truncated INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY(thread_id, id)
);
PRAGMA user_version = 54;
