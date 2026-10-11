-- Approval of oxe.yaml hook scripts, keyed by the hash of the script text so
-- that editing a hook (e.g. via a pulled commit) requires approval again.
CREATE TABLE IF NOT EXISTS repo_hook_trust (
  root_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('setup', 'archive')),
  content_hash TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (root_path, kind)
);

PRAGMA user_version = 64;
