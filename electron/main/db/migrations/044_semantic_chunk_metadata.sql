ALTER TABLE semantic_embeddings ADD COLUMN chunk_metadata_json TEXT NOT NULL DEFAULT '[]';

PRAGMA user_version = 44;
