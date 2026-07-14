-- Persistent local lexical index used alongside vector embeddings. The content
-- table owns lifecycle/FK semantics; the external-content FTS5 table stores the
-- compact inverted index and stays synchronized through triggers.
CREATE TABLE IF NOT EXISTS semantic_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_id, file_path),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_documents_workspace
  ON semantic_documents(workspace_id);

CREATE VIRTUAL TABLE IF NOT EXISTS semantic_documents_fts USING fts5(
  workspace_id UNINDEXED,
  file_path UNINDEXED,
  content,
  content='semantic_documents',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS semantic_documents_ai AFTER INSERT ON semantic_documents BEGIN
  INSERT INTO semantic_documents_fts(rowid, workspace_id, file_path, content)
  VALUES (new.id, new.workspace_id, new.file_path, new.content);
END;

CREATE TRIGGER IF NOT EXISTS semantic_documents_ad AFTER DELETE ON semantic_documents BEGIN
  INSERT INTO semantic_documents_fts(semantic_documents_fts, rowid, workspace_id, file_path, content)
  VALUES ('delete', old.id, old.workspace_id, old.file_path, old.content);
END;

CREATE TRIGGER IF NOT EXISTS semantic_documents_au AFTER UPDATE ON semantic_documents BEGIN
  INSERT INTO semantic_documents_fts(semantic_documents_fts, rowid, workspace_id, file_path, content)
  VALUES ('delete', old.id, old.workspace_id, old.file_path, old.content);
  INSERT INTO semantic_documents_fts(rowid, workspace_id, file_path, content)
  VALUES (new.id, new.workspace_id, new.file_path, new.content);
END;

PRAGMA user_version = 43;

