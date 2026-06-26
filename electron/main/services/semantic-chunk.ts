/**
 * Text chunking for semantic indexing.
 *
 * The embedding model only processes a few hundred tokens per call, so embedding
 * a whole file collapses to its first chunk — the imports/header — and misses
 * the logic deeper in the file. Splitting the file into overlapping windows and
 * embedding each one lets a query match the relevant region wherever it lives;
 * ranking then uses a file's best chunk.
 *
 * Sizes are in characters (the main process has no tokenizer). ~1500 chars stays
 * within multilingual-e5-base's 512-token window for source code; the overlap
 * keeps a construct that straddles a boundary intact in at least one chunk.
 */
export const EMBED_DIM_DEFAULT = 384
export const CHUNK_CHARS = 1500
export const CHUNK_OVERLAP = 200
export const MAX_CHUNKS = 60

export function chunkText(text: string): string[] {
  const trimmed = text ?? ''
  if (trimmed.length <= CHUNK_CHARS) return trimmed.length > 0 ? [trimmed] : []
  const step = CHUNK_CHARS - CHUNK_OVERLAP
  const chunks: string[] = []
  for (let start = 0; start < trimmed.length && chunks.length < MAX_CHUNKS; start += step) {
    chunks.push(trimmed.slice(start, start + CHUNK_CHARS))
  }
  return chunks
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 for a
 * zero-magnitude vector. Shared by the service query and the offline lab so they
 * rank identically.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Best (max) cosine of a query vector against a file's chunk embeddings.
 * Accepts the new `number[][]` (per-chunk) format and the legacy `number[]`
 * (single whole-file vector) format so existing rows keep working.
 */
export function bestChunkScore(queryEmbedding: number[], stored: unknown): number | null {
  if (!Array.isArray(stored) || stored.length === 0) return null
  const chunks: number[][] = Array.isArray(stored[0])
    ? (stored as number[][])
    : typeof stored[0] === 'number'
      ? [stored as number[]]
      : []
  let best = -Infinity
  for (const emb of chunks) {
    if (!Array.isArray(emb) || emb.length !== queryEmbedding.length) continue
    const score = cosineSimilarity(queryEmbedding, emb)
    if (score > best) best = score
  }
  return best === -Infinity ? null : best
}

// ─── Binary (Float32) storage ───────────────────────────────────────────────
// number[][] (nChunks × dim) ⇄ a single Float32 buffer. Removes JSON.parse from
// the query hot path and scores via typed arrays (much faster than number[]).

/** Pack per-chunk embeddings into a Float32 Buffer (chunks concatenated). */
export function encodeEmbeddings(embeddings: number[][]): { blob: Buffer; dim: number } {
  const dim = embeddings[0]?.length ?? 0
  const flat = new Float32Array(embeddings.length * dim)
  for (let c = 0; c < embeddings.length; c++) {
    const v = embeddings[c]
    for (let i = 0; i < dim; i++) flat[c * dim + i] = v[i]
  }
  return { blob: Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength), dim }
}

/**
 * Best (max) cosine of a query vector against a packed Float32 blob, without
 * materializing arrays. `dim` splits the blob into chunk vectors. Mirrors
 * bestChunkScore's ranking so blob and legacy-JSON rows stay comparable.
 */
export function bestChunkScoreBlob(query: Float32Array, blob: Buffer, dim: number): number | null {
  if (!dim || blob.length < dim * 4) return null
  // View the BLOB's bytes as Float32 (copy to guarantee 4-byte alignment).
  const floats = new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))
  if (floats.length % dim !== 0 || query.length !== dim) return null
  let qNorm = 0
  for (let i = 0; i < dim; i++) qNorm += query[i] * query[i]
  qNorm = Math.sqrt(qNorm)
  if (qNorm === 0) return null
  let best = -Infinity
  for (let off = 0; off + dim <= floats.length; off += dim) {
    let dot = 0
    let n = 0
    for (let i = 0; i < dim; i++) { const e = floats[off + i]; dot += query[i] * e; n += e * e }
    if (n === 0) continue
    const score = dot / (qNorm * Math.sqrt(n))
    if (score > best) best = score
  }
  return best === -Infinity ? null : best
}
