/**
 * Performance benchmark for OXESpace's CPU-bound hot paths.
 *
 * Scope: pure functions that run on the high-frequency / heavy paths flagged by
 * the perf analysis — the per-PTY-chunk terminal text processing and the
 * semantic-search scoring loop. These are the only places OXESpace itself spends
 * meaningful CPU (PTY I/O, DB, parsing live in native/WASM). GUI render timing
 * and DB latency are measured separately (see the boot-timing harness / DevTools).
 *
 * Run: npx vitest bench --run tests/bench/hotpaths.bench.ts
 */
import { bench, describe } from 'vitest'
import { stripTerminalControl, sanitizeTerminalPreview } from '../../src/utils/paneDisplay'
import { bestChunkScore, chunkText, cosineSimilarity } from '../../electron/main/services/semantic-chunk'

// ─── Terminal hot path fixtures ─────────────────────────────────────────────
// Realistic agent (Claude Code) PTY output: OSC title, SGR colors, line erase,
// cursor hide/show, box-drawing — the stuff stripTerminalControl must strip on
// EVERY chunk during streaming.
const ESC = '\x1b'
function makeAnsiChunk(lines: number): string {
  let s = `${ESC}]0;Claude Code\x07`
  for (let i = 0; i < lines; i++) {
    s +=
      `${ESC}[2K${ESC}[38;5;42m⏺${ESC}[0m ${ESC}[1mBuilding${ESC}[0m ` +
      `module ${i} ${ESC}[38;5;240m(${i * 13}ms)${ESC}[0m ${ESC}[32m✓${ESC}[0m\r\n`
  }
  s += `${ESC}[?25l${ESC}[38;5;213m✱${ESC}[0m Thinking…${ESC}[?25h`
  return s
}
const ansi2k = makeAnsiChunk(20)
const ansi16k = makeAnsiChunk(160)
const plain2k = 'building module abcdefg '.repeat(85)

// eslint-disable-next-line no-console
console.log(`[fixtures] ansi2k=${ansi2k.length}B  ansi16k=${ansi16k.length}B  plain2k=${plain2k.length}B`)

describe('terminal hot path — runs per PTY chunk (10s-100s/sec during streaming)', () => {
  bench('stripTerminalControl — 2KB ANSI chunk', () => { stripTerminalControl(ansi2k) })
  bench('stripTerminalControl — 16KB ANSI chunk', () => { stripTerminalControl(ansi16k) })
  bench('stripTerminalControl — 2KB plain (no ANSI)', () => { stripTerminalControl(plain2k) })
  bench('sanitizeTerminalPreview — 2KB ANSI chunk', () => { sanitizeTerminalPreview(ansi2k) })
  bench('sanitizeTerminalPreview — 16KB ANSI chunk', () => { sanitizeTerminalPreview(ansi16k) })
})

// ─── Semantic scoring fixtures ──────────────────────────────────────────────
const DIM = 384 // multilingual-e5-small
function randVec(seed: number): number[] {
  // Deterministic LCG so runs are comparable.
  let x = (seed * 1103515245 + 12345) & 0x7fffffff
  const v = new Array<number>(DIM)
  for (let i = 0; i < DIM; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    v[i] = (x / 0x7fffffff) * 2 - 1
  }
  return v
}
const query = randVec(1)
const file5 = Array.from({ length: 5 }, (_, k) => randVec(k + 2)) // number[][]
const fileVecA = randVec(7)
const fileVecB = randVec(8)

// A whole-workspace corpus: this mirrors semantic.service query(), which loads
// EVERY file's embeddings and scores them all to return the top-K. Quantifies
// the "load all + score all" cost on a large repo.
const FILES = 10_000
const corpus: number[][][] = Array.from({ length: FILES }, (_, k) =>
  Array.from({ length: 1 + (k % 8) }, (_, c) => randVec(k * 8 + c))
)

describe('semantic scoring — runs per query', () => {
  bench('cosineSimilarity — 384-dim pair', () => { cosineSimilarity(fileVecA, fileVecB) })
  bench('bestChunkScore — file with 5 chunks', () => { bestChunkScore(query, file5) })
  bench('query scan — score 10k files (whole-workspace)', () => {
    let best = -Infinity
    for (let i = 0; i < corpus.length; i++) {
      const s = bestChunkScore(query, corpus[i])
      if (s !== null && s > best) best = s
    }
  })
})

// ─── Chunking fixtures ──────────────────────────────────────────────────────
const srcSmall = 'const x = 1;\n'.repeat(320) // ~4KB source file
const srcLarge = 'function f(){ return 42 }\n'.repeat(3200) // ~80KB file

describe('semantic chunking — runs per indexed file', () => {
  bench('chunkText — 4KB source', () => { chunkText(srcSmall) })
  bench('chunkText — 80KB source', () => { chunkText(srcLarge) })
})
