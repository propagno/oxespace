import { describe, expect, it } from 'vitest'
import { bestChunkScore, bestChunkScoreBlob, cosineSimilarity, encodeEmbeddings } from '../../electron/main/services/semantic-chunk'

const DIM = 8
function vec(seed: number): number[] {
  let x = (seed * 2654435761) >>> 0
  return Array.from({ length: DIM }, () => { x = (x * 1103515245 + 12345) >>> 0; return (x / 0xffffffff) * 2 - 1 })
}

describe('binary embedding storage round-trip', () => {
  it('encode/decode scores identically to JSON path (within float32 tolerance)', () => {
    const query = vec(1)
    const queryF32 = Float32Array.from(query)
    for (const nChunks of [1, 3, 7]) {
      const embeddings = Array.from({ length: nChunks }, (_, k) => vec(k + 2))
      const { blob, dim } = encodeEmbeddings(embeddings)
      expect(dim).toBe(DIM)
      expect(blob.length).toBe(nChunks * DIM * 4)
      const jsonScore = bestChunkScore(query, embeddings)
      const blobScore = bestChunkScoreBlob(queryF32, blob, dim)
      expect(jsonScore).not.toBeNull()
      expect(blobScore).not.toBeNull()
      // Float32 rounding vs number[] (float64): tiny tolerance.
      expect(Math.abs((blobScore as number) - (jsonScore as number))).toBeLessThan(1e-4)
    }
  })

  it('blob best score equals the max single-chunk cosine', () => {
    const query = vec(42)
    const embeddings = [vec(10), vec(11), vec(12)]
    const { blob, dim } = encodeEmbeddings(embeddings)
    const expected = Math.max(...embeddings.map((e) => cosineSimilarity(query, e)))
    const got = bestChunkScoreBlob(Float32Array.from(query), blob, dim) as number
    expect(Math.abs(got - expected)).toBeLessThan(1e-4)
  })

  it('returns null for malformed/empty blobs', () => {
    expect(bestChunkScoreBlob(Float32Array.from(vec(1)), Buffer.alloc(0), DIM)).toBeNull()
    expect(bestChunkScoreBlob(Float32Array.from(vec(1)), Buffer.alloc(DIM * 4), 0)).toBeNull()
  })
})
