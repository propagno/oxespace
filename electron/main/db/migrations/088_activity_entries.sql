-- F30 · The activity center's entries, kept by the main process so the list survives a restart (UX-03).
-- One row per subject and kind (source, id, kind); `position` is the row's place in the newest-first list, 0 first.
-- Every write replaces the whole list (at most 200 rows) in one transaction.
CREATE TABLE IF NOT EXISTS activity_entries (
  source TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_json TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL CHECK (at >= 0),
  position INTEGER NOT NULL UNIQUE CHECK (position >= 0),
  PRIMARY KEY (source, id, kind)
);

-- The time the person last looked at the list; one row, created on the first `activity:seen`.
CREATE TABLE IF NOT EXISTS activity_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0)
);

PRAGMA user_version = 88;
