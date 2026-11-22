// @vitest-environment node
// Frozen acceptance test for 1.5.2 Desempenho (program 152perf, Jira OXE-126 part 2, A5). Written by the
// planner; the executor must not edit it. Red on main 8388aa419: docs/perf/terminal-renderer.md does not exist.
// Contract: each measurement is a report in docs/perf/ with its measured table (before, after, delta), the CI run ids
// that produced each number, and one explicit decision. A number with no run id is not evidence.
// - docs/perf/react-compiler.md (OXE-124): babel-plugin-react-compiler version, compiled and bailed-out component counts,
//   build time and renderer chunk deltas, the OXE-105 perf-gate table, and "Decisão: adotar" or "Decisão: descartar"
//   (adopt only with >= 10% render gain, no OXE-105 regression and build time +20% at most).
// - docs/perf/terminal-renderer.md (OXE-126 part 2): xterm.js against libghostty WASM on the three loads (10 MB ANSI stream,
//   10 000-line 256-colour table, 200-key echo): MB/s, p95 ms and MB, the parity matrix (selection, clipboard, a11y, IME)
//   on Windows and Linux, and "Recomendação: manter xterm.js" or "Recomendação: planejar migração". The harness is
//   scripts/bench-terminal-renderer.mjs, and its --self-test runs without a display and without libghostty installed.
// - docs/perf/compile-cache.md (OXE-126 part 1): boot process→ready-to-show and process→interactive with and without
//   the V8 compile cache, on Windows and Linux, and "Decisão: manter ligado" or "Decisão: desligado". When it stays on,
//   electron/main/compile-cache.ts enables it before the app's main module is loaded.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = process.cwd()
const read = (rel: string): string => {
  const file = join(root, rel)
  expect(existsSync(file), `${rel} exists`).toBe(true)
  return readFileSync(file, 'utf8')
}
/** GitHub Actions run ids (8+ digits) cited by the report. */
const runIds = (text: string): string[] => [...text.matchAll(/actions\/runs\/(\d{8,})|\brun\s+(\d{8,})/gi)].map(m => m[1] ?? m[2])
/** Rows of a Markdown table whose first cell matches. */
const row = (text: string, label: RegExp): string | undefined => text.split(/\r?\n/).find(line => line.trim().startsWith('|') && label.test(line))

describe('OXE-126 · a measured report with a decision', () => {
  test('OXE-126: the terminal renderer benchmark report compares xterm.js and libghostty and recommends', () => {
    const text = read('docs/perf/terminal-renderer.md')
    for (const load of [/10\s?MB/i, /10[ .]?000/, /200 (teclas|keys)/i]) expect(row(text, load), String(load)).toBeTruthy()
    expect(text).toMatch(/MB\/s/)
    expect(text).toMatch(/p95/)
    for (const feature of [/sele[çc][ãa]o|selection/i, /clipboard|área de transferência/i, /a11y|acessibilidade/i, /IME/]) expect(text, String(feature)).toMatch(feature)
    expect(text).toMatch(/Windows/)
    expect(text).toMatch(/Linux/)
    expect(text).toMatch(/Recomenda[çc][ãa]o:\s*\**\s*(manter xterm\.js|planejar migra[çc][ãa]o)/i)
    expect(runIds(text).length).toBeGreaterThanOrEqual(1)
    const out = execFileSync(process.execPath, [join(root, 'scripts/bench-terminal-renderer.mjs'), '--self-test'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, timeout: 60_000 })
    expect(out).toMatch(/self-test ok/i)
  })
})
