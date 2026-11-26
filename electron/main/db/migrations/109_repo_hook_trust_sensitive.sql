-- OXE-444: widens repo_hook_trust's kind CHECK to include 'sensitive-copy' for
-- explicit repository-level opt-in before copying sensitive files (.env*, *.pem,
-- *.key, *credentials*, *secret*, id_rsa*) into new worktrees. Preserves every
-- existing setup/archive approval row.
DROP TABLE IF EXISTS repo_hook_trust_new;
CREATE TABLE repo_hook_trust_new (
  root_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('setup', 'archive', 'sensitive-copy')),
  content_hash TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  PRIMARY KEY (root_path, kind)
);
INSERT INTO repo_hook_trust_new (root_path, kind, content_hash, approved_at)
  SELECT root_path, kind, content_hash, approved_at FROM repo_hook_trust;
DROP TABLE repo_hook_trust;
ALTER TABLE repo_hook_trust_new RENAME TO repo_hook_trust;

PRAGMA user_version = 109;
