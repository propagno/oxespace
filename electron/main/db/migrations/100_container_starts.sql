-- Person-initiated container and compose stack starts recorded by OXESpace (F9 A34).
-- Stores only engine, target identifier or stack working_dir, target kind, and timestamp.
CREATE TABLE IF NOT EXISTS container_starts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine TEXT NOT NULL,
  target TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('container', 'stack')),
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_container_starts_at ON container_starts(at DESC);

PRAGMA user_version = 100;
