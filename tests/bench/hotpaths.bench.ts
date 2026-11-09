/**
 * Performance benchmark for OXESpace's CPU-bound hot paths.
 *
 * Scope: pure functions that run on the high-frequency / heavy paths flagged by
 * the perf analysis — the per-PTY-chunk terminal text processing.
 * These are the only places OXESpace itself spends
 * meaningful CPU (PTY I/O, DB, parsing live in native/WASM). GUI render timing
 * and DB latency are measured separately (see the boot-timing harness / DevTools).
 *
 * Run: npx vitest bench --run tests/bench/hotpaths.bench.ts
 */
import { bench, describe } from 'vitest'
import { stripTerminalControl, sanitizeTerminalPreview } from '../../src/utils/paneDisplay'

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
