import { describe, expect, test } from 'vitest'
import {
  CHUNK_CHARS,
  CHUNK_OVERLAP,
  MAX_CHUNKS,
  bestChunkScore,
  chunkSourceText,
  chunkText,
  cosineSimilarity
} from '../../electron/main/services/semantic-chunk'

describe('chunkText', () => {
  test('short text yields a single chunk', () => {
    expect(chunkText('hello world')).toEqual(['hello world'])
  })

  test('empty/whitespace text yields no chunks', () => {
    expect(chunkText('')).toEqual([])
  })

  test('long text is split into overlapping windows that cover everything', () => {
    const text = 'x'.repeat(CHUNK_CHARS * 3)
    const chunks = chunkText(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS)
    // Consecutive chunks overlap by CHUNK_OVERLAP, so the union covers the text.
    const step = CHUNK_CHARS - CHUNK_OVERLAP
    expect(chunks.length).toBe(Math.ceil((text.length - CHUNK_OVERLAP) / step))
  })

  test('preserves content across the boundary via overlap', () => {
    // A marker straddling a chunk boundary must survive intact in some chunk.
    const marker = 'NEEDLE_TOKEN_42'
    const text = 'a'.repeat(CHUNK_CHARS - 5) + marker + 'b'.repeat(CHUNK_CHARS)
    const chunks = chunkText(text)
    expect(chunks.some((c) => c.includes(marker))).toBe(true)
  })

  test('caps the number of chunks for very large files', () => {
    const text = 'y'.repeat(CHUNK_CHARS * (MAX_CHUNKS + 50))
    expect(chunkText(text).length).toBe(MAX_CHUNKS)
  })
})

describe('chunkSourceText', () => {
  test('aligns TypeScript chunks to named declarations with exact offsets', () => {
    const source = [
      "import path from 'node:path'",
      '',
      'export function firstFeature() {',
      "  return 'first'",
      '}',
      '',
      'export class SecondFeature {',
      '  run() { return true }',
      '}'
    ].join('\n')
    const chunks = chunkSourceText('src/features.ts', source)
    expect(chunks.map((chunk) => chunk.name)).toEqual(['preamble', 'firstFeature', 'SecondFeature'])
    const second = chunks[2]
    expect(second.kind).toBe('symbol')
    expect(second.lineStart).toBe(7)
    expect(source.slice(second.start, second.end)).toBe(second.text)
  })

  test('windows oversized symbols while retaining structural identity', () => {
    const source = `export function hugeFeature() {\n${'x'.repeat(CHUNK_CHARS * 2)}\n}`
    const chunks = chunkSourceText('huge.ts', source)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.name === 'hugeFeature' && chunk.kind === 'symbol')).toBe(true)
    expect(chunks.every((chunk) => chunk.text.length <= CHUNK_CHARS)).toBe(true)
  })

  test('falls back to legacy-equivalent windows for unstructured text', () => {
    const source = 'z'.repeat(CHUNK_CHARS * 2)
    expect(chunkSourceText('notes.txt', source).map((chunk) => chunk.text)).toEqual(chunkText(source))
  })

  test('preserves the legacy coverage floor when tiny symbols exceed the cap', () => {
    const source = Array.from({ length: MAX_CHUNKS + 20 }, (_, index) => `export function f${index}x() { return ${index} }`).join('\n')
    const chunks = chunkSourceText('many.ts', source)
    expect(chunks.map((chunk) => chunk.text)).toEqual(chunkText(source))
    expect(chunks.every((chunk) => chunk.kind === 'window')).toBe(true)
  })
})

describe('cosineSimilarity', () => {
  test('identical vectors score 1, orthogonal score 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  test('zero-magnitude vector scores 0', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('bestChunkScore', () => {
  const query = [1, 0]

  test('new number[][] format: returns the best matching chunk', () => {
    const stored = [
      [0, 1],   // orthogonal -> 0
      [1, 0],   // identical  -> 1
      [0.7, 0.7] // partial
    ]
    expect(bestChunkScore(query, stored)).toBeCloseTo(1)
  })

  test('legacy number[] format still works (single whole-file vector)', () => {
    expect(bestChunkScore(query, [0, 1])).toBeCloseTo(0)
    expect(bestChunkScore(query, [1, 0])).toBeCloseTo(1)
  })

  test('skips dimension-mismatched chunks', () => {
    const stored = [
      [1, 0, 0], // wrong dim -> skipped
      [0.6, 0.8] // valid
    ]
    expect(bestChunkScore(query, stored)).toBeCloseTo(0.6)
  })

  test('returns null for empty or malformed input', () => {
    expect(bestChunkScore(query, [])).toBeNull()
    expect(bestChunkScore(query, null)).toBeNull()
    expect(bestChunkScore(query, [[1, 2, 3]])).toBeNull() // all mismatched
  })
})
