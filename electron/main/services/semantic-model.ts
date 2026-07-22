/**
 * Single source of truth for the semantic embedding model.
 *
 * Shared by the worker (which loads the model) and the service (which applies
 * the E5 instruction prefixes and stamps the model into each row's checksum so
 * switching models re-indexes automatically). Keep this dependency-free — the
 * worker bundle is a plain Node thread.
 *
 * `intfloat/multilingual-e5-base` (via Xenova ONNX): 768-dim, 512-token window,
 * ~100 languages — closes the cross-lingual gap (Portuguese queries against
 * English code) that the English-only all-MiniLM-L6-v2 left open. Upgraded from
 * e5-small (384-dim, ~120MB) to the base model (~280MB) for stronger PT→EN
 * retrieval; the extra ~160MB ships offline via scripts/fetch-semantic-model.mjs
 * for locked-down/corporate networks. Storage is dimension-agnostic (the per-row
 * `dim` column, migration 040), so switching just re-indexes automatically.
 *
 * E5 models REQUIRE asymmetric prefixes: the search text is embedded as
 * "query: …" and the indexed documents as "passage: …". Omitting them measurably
 * degrades retrieval, so every embed call must go through one of these.
 */
export const SEMANTIC_MODEL_ID = 'Xenova/multilingual-e5-base'
export const SEMANTIC_EMBED_DIM = 768
export const QUERY_PREFIX = 'query: '
export const PASSAGE_PREFIX = 'passage: '
