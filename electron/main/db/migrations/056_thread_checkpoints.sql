-- File checkpoints are intentionally independent from Git's index. They keep
-- the exact pre/post images needed for a conflict-aware restore without reset,
-- checkout or clean.
CREATE TABLE IF NOT EXISTS conversation_checkpoints (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  turn_id TEXT,
  root_path TEXT NOT NULL,
  base_commit TEXT,
  label TEXT,
  state TEXT NOT NULL CHECK(state IN ('open', 'ready', 'restored', 'conflict', 'failed')),
  before_paths_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  finalized_at INTEGER,
  restored_at INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS conversation_checkpoints_thread
  ON conversation_checkpoints(thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_checkpoint_files (
  checkpoint_id TEXT NOT NULL REFERENCES conversation_checkpoints(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  pre_exists INTEGER NOT NULL,
  pre_content BLOB,
  pre_hash TEXT,
  post_exists INTEGER NOT NULL,
  post_hash TEXT,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(checkpoint_id, path)
);

PRAGMA user_version = 56;
