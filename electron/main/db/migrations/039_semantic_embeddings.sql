CREATE TABLE IF NOT EXISTS semantic_embeddings (
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, file_path),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_embeddings_workspace_id ON semantic_embeddings(workspace_id);

PRAGMA user_version = 39;
