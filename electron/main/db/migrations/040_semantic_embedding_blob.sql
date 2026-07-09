-- Binary embedding storage for semantic search.
--
-- The query path used to SELECT every row's embedding_json and JSON.parse it on
-- the main thread (≈28ms scoring + heavy parse for a 10k-file repo). Float32 BLOB
-- storage removes the JSON.parse entirely, is ~4× smaller, and scores via typed
-- arrays. Additive columns (nullable) so existing JSON rows keep working and
-- migrate to BLOB lazily as files re-index.
--
-- embedding_blob: concatenated Float32 vectors (nChunks × dim floats).
-- dim:            vector dimension, so the blob can be split back into chunks.
ALTER TABLE semantic_embeddings ADD COLUMN embedding_blob BLOB;
ALTER TABLE semantic_embeddings ADD COLUMN dim INTEGER;

PRAGMA user_version = 40;
