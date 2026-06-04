/**
 * Text chunking for semantic indexing.
 *
 * The embedding model (all-MiniLM-L6-v2) only processes ~256 tokens per call,
 * so embedding a whole file collapses to its first few hundred tokens — the
 * imports/header — and misses the logic deeper in the file. Splitting the file
 * into overlapping windows and embedding each one lets a query match the
 * relevant region wherever it lives; ranking then uses a file's best chunk.
 *
 * Sizes are in characters (the main process has no tokenizer). ~700 chars ≈ the
 * model's ~256-token window for source code; the overlap keeps a construct that
 * straddles a boundary intact in at least one chunk.
 */
export const CHUNK_CHARS = 800
export const CHUNK_OVERLAP = 100
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
