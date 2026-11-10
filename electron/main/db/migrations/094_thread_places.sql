-- F4 places (1.5.0 A13, ccr-t71-task-places.md §5): the places one conversation worked in, from evidence, with a
-- base captured at first touch. current is read on demand and never stored. Only adds tables.
CREATE TABLE IF NOT EXISTS thread_places (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('root', 'worktree', 'checkout', 'outside')),
  path TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  base_commit TEXT,
  base_branch TEXT,
  base_captured_at INTEGER,
  base_turn_id TEXT,
  writes INTEGER NOT NULL DEFAULT 0,
  drift_json TEXT,
  PRIMARY KEY (thread_id, id)
);

-- The newest write per place and path (relative to the place), at most 2000 per thread.
CREATE TABLE IF NOT EXISTS thread_place_writes (
  thread_id TEXT NOT NULL,
  place_id TEXT NOT NULL,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('add', 'update', 'delete', 'rename')),
  turn_id TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, place_id, path),
  FOREIGN KEY (thread_id, place_id) REFERENCES thread_places(thread_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_thread_place_writes_at ON thread_place_writes(thread_id, at DESC);

-- The cwd the provider reported last in each turn (the resolver's second step).
CREATE TABLE IF NOT EXISTS thread_turn_cwd (
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  PRIMARY KEY (thread_id, turn_id)
);

-- Refused evidence and the cap, per conversation.
CREATE TABLE IF NOT EXISTS thread_place_counters (
  thread_id TEXT PRIMARY KEY REFERENCES conversation_threads(id) ON DELETE CASCADE,
  refused INTEGER NOT NULL DEFAULT 0,
  capped INTEGER NOT NULL DEFAULT 0
);

-- SECURITY S5: append-only trail of what a person did from the window (never file content).
CREATE TABLE IF NOT EXISTS person_action_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('place-read', 'place-switch-back', 'place-undo', 'place-restore', 'place-discard', 'worktree-remove', 'branch-delete')),
  thread_id TEXT,
  place_id TEXT,
  target TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'error')),
  code TEXT
);
CREATE INDEX IF NOT EXISTS idx_person_action_audit_ts ON person_action_audit(ts DESC);

CREATE TRIGGER IF NOT EXISTS person_action_audit_no_update BEFORE UPDATE ON person_action_audit
BEGIN SELECT RAISE(ABORT, 'person_action_audit is append-only'); END;

PRAGMA user_version = 94;
