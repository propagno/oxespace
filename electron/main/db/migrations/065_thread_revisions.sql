-- Incremental Thread reads: `revision` counts writes, `epoch` changes whenever
-- history is truncated or re-based so a client holding an older cursor resets.
ALTER TABLE conversation_threads ADD COLUMN epoch TEXT;
ALTER TABLE conversation_threads ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_events ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS conversation_events_rev ON conversation_events(thread_id, rev);

PRAGMA user_version = 65;
