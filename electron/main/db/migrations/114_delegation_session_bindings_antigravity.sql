-- OXE-490: widens delegation_session_bindings's provider CHECK to include antigravity alongside claude and codex,
-- preserving all existing rows, the delegations(id) cascade foreign key, the UNIQUE constraint, and its root index.
DROP TABLE IF EXISTS delegation_session_bindings_new;
CREATE TABLE delegation_session_bindings_new (
  task_id TEXT PRIMARY KEY REFERENCES delegations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex', 'antigravity')),
  native_session_id TEXT NOT NULL,
  canonical_root TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  resumable INTEGER NOT NULL DEFAULT 1 CHECK(resumable IN (0, 1)),
  observed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, native_session_id, canonical_root)
);
INSERT INTO delegation_session_bindings_new (
  task_id, provider, native_session_id, canonical_root, generation, resumable, observed_at, updated_at
)
SELECT
  task_id, provider, native_session_id, canonical_root, generation, resumable, observed_at, updated_at
FROM delegation_session_bindings;
DROP TABLE delegation_session_bindings;
ALTER TABLE delegation_session_bindings_new RENAME TO delegation_session_bindings;
CREATE INDEX IF NOT EXISTS delegation_session_root
  ON delegation_session_bindings(canonical_root, updated_at DESC);

PRAGMA user_version = 114;
