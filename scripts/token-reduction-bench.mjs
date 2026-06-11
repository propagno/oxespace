#!/usr/bin/env node
/**
 * Token-reduction benchmark — RTK × Caveman × Semantic (2^3 full factorial).
 *
 * Goal: measure, offline and without any API cost, how much each feature (and
 * each combination of features) reduces the number of tokens that would be sent
 * to / produced by the model on a fixed suite of representative tasks.
 *
 * Where the savings come from:
 *   - RTK      → compresses raw TERMINAL OUTPUT before it reaches the agent (input).
 *   - Semantic → replaces a broad "read these files" context with a small top-K
 *                set of relevant files/snippets (input).
 *   - Caveman  → makes the model answer tersely (output).
 *
 * Each corpus task (tests/token-bench/corpus/*.json) carries real-ish paired
 * samples so the transforms are applied to concrete text, not guessed:
 *   {
 *     id, title,
 *     terminalOutputRaw: string,        // raw command output
 *     baselineFiles:     string[],      // files the agent reads WITHOUT semantic
 *     semanticResultFiles: string[],    // top-K returned WITH semantic
 *     responseVerbose:   string,        // model answer WITHOUT caveman
 *     responseCaveman:   string         // model answer WITH caveman
 *   }
 *
 * Tokenizer: uses `gpt-tokenizer` if installed (a close approximation of the
 * Anthropic tokenizer — documented as an estimate), otherwise falls back to a
 * deterministic ~chars/4 heuristic. Either way the harness measures the RELATIVE
 * effect between combinations, not an exact bill.
 *
 * Usage:  node scripts/token-reduction-bench.mjs
 *         RTK_BENCH_BIN=/path/to/rtk node scripts/token-reduction-bench.mjs
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)
const CORPUS_DIR = join(ROOT, 'tests', 'token-bench', 'corpus')
const RESULTS_DIR = join(ROOT, 'tests', 'token-bench', 'results')

// ---------------------------------------------------------------------------
// Tokenizer (pluggable, offline)
// ---------------------------------------------------------------------------
let countTokens
let tokenizerName
try {
  const mod = await import('gpt-tokenizer')
  countTokens = (text) => mod.encode(text ?? '').length
  tokenizerName = 'gpt-tokenizer (o200k_base — approximates Anthropic)'
} catch {
  // Classic ~4 chars/token heuristic, blended with a word-count floor so very
  // dense text isn't underestimated. Deterministic and dependency-free.
  countTokens = (text) => {
    const s = text ?? ''
    if (!s) return 0
    const byChars = Math.ceil(s.length / 4)
    const byWords = Math.ceil((s.split(/\s+/).filter(Boolean).length) * 1.3)
    return Math.max(byChars, byWords)
  }
  tokenizerName = 'heuristic (~chars/4) — install `gpt-tokenizer` for higher fidelity'
}

// ---------------------------------------------------------------------------
// RTK transform: real binary if provided, else a documented heuristic that
// mirrors what RTK does to terminal output (strip ANSI, drop progress/carriage
// spam, collapse duplicate/blank lines, trim trailing whitespace).
// ---------------------------------------------------------------------------
function applyRtk(text) {
  const bin = process.env.RTK_BENCH_BIN
  if (bin) {
    try {
      const res = spawnSync(bin, [], { input: text, encoding: 'utf-8' })
      if (res.status === 0 && typeof res.stdout === 'string') {
        return { text: res.stdout, mode: 'binary' }
      }
    } catch {
      /* fall through to heuristic */
    }
  }
  const stripped = text
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '') // ANSI escape codes
    .split('\n')
    .map((line) => (line.includes('\r') ? line.slice(line.lastIndexOf('\r') + 1) : line)) // keep last carriage frame
    .map((line) => line.replace(/[ \t]+$/g, '')) // trailing whitespace
  const out = []
  let prevBlank = false
  let prev = null
  for (const line of stripped) {
    const blank = line.trim() === ''
    if (blank && prevBlank) continue // collapse blank runs
    if (line === prev) continue // drop consecutive duplicate lines (progress spam)
    out.push(line)
    prevBlank = blank
    prev = line
  }
  return { text: out.join('\n'), mode: 'heuristic' }
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------
function loadCorpus() {
  if (!existsSync(CORPUS_DIR)) {
    throw new Error(`Corpus directory not found: ${CORPUS_DIR}`)
  }
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.json'))
  if (files.length === 0) throw new Error(`No corpus tasks (*.json) in ${CORPUS_DIR}`)
  return files.map((f) => {
    const task = JSON.parse(readFileSync(join(CORPUS_DIR, f), 'utf-8'))
    task._file = f
    return task
  })
}

// ---------------------------------------------------------------------------
// Per-task segment token counts (the building blocks of every combination)
// ---------------------------------------------------------------------------
function measureTask(task) {
  const rtk = applyRtk(task.terminalOutputRaw ?? '')
  const join = (arr) => (Array.isArray(arr) ? arr.join('\n\n') : (arr ?? ''))
  return {
    rtkMode: rtk.mode,
    terminalRaw: countTokens(task.terminalOutputRaw ?? ''),
    terminalRtk: countTokens(rtk.text),
    ctxBaseline: countTokens(join(task.baselineFiles)),
    ctxSemantic: countTokens(join(task.semanticResultFiles)),
    outVerbose: countTokens(task.responseVerbose ?? ''),
    outCaveman: countTokens(task.responseCaveman ?? '')
  }
}

// total tokens for a given on/off setting of [rtk, caveman, semantic]
function comboTotal(seg, { rtk, caveman, semantic }) {
  const terminal = rtk ? seg.terminalRtk : seg.terminalRaw
  const ctx = semantic ? seg.ctxSemantic : seg.ctxBaseline
  const out = caveman ? seg.outCaveman : seg.outVerbose
  return { input: terminal + ctx, output: out, total: terminal + ctx + out }
}

const COMBOS = []
for (const rtk of [false, true]) {
  for (const caveman of [false, true]) {
    for (const semantic of [false, true]) {
      COMBOS.push({ rtk, caveman, semantic })
    }
  }
}
const comboKey = (c) => `${c.rtk ? 'R' : '·'}${c.caveman ? 'C' : '·'}${c.semantic ? 'S' : '·'}`

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length }
function std(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const corpus = loadCorpus()
const segments = corpus.map(measureTask)

// Per-combo totals across all tasks
const perCombo = COMBOS.map((c) => {
  const totals = segments.map((s) => comboTotal(s, c).total)
  const inputs = segments.map((s) => comboTotal(s, c).input)
  const outputs = segments.map((s) => comboTotal(s, c).output)
  return { combo: c, key: comboKey(c), totals, meanTotal: mean(totals), stdTotal: std(totals), meanInput: mean(inputs), meanOutput: mean(outputs) }
})

const baseline = perCombo.find((p) => p.key === '···') // all features off
const baselineMean = baseline.meanTotal

// Main effect of a flag = mean reduction (%) when the flag is ON vs OFF,
// averaged over all tasks and over the other flags' settings.
function mainEffect(flag) {
  const deltas = []
  for (const s of segments) {
    for (const other1 of [false, true]) {
      for (const other2 of [false, true]) {
        const off = { rtk: false, caveman: false, semantic: false }
        const on = { rtk: false, caveman: false, semantic: false }
        if (flag === 'rtk') { off.caveman = on.caveman = other1; off.semantic = on.semantic = other2; on.rtk = true }
        if (flag === 'caveman') { off.rtk = on.rtk = other1; off.semantic = on.semantic = other2; on.caveman = true }
        if (flag === 'semantic') { off.rtk = on.rtk = other1; off.caveman = on.caveman = other2; on.semantic = true }
        const tOff = comboTotal(s, off).total
        const tOn = comboTotal(s, on).total
        deltas.push(tOff === 0 ? 0 : (tOff - tOn) / tOff)
      }
    }
  }
  return { meanPct: mean(deltas) * 100, stdPct: std(deltas) * 100 }
}

const effects = {
  rtk: mainEffect('rtk'),
  caveman: mainEffect('caveman'),
  semantic: mainEffect('semantic')
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pct = (mean) => ((baselineMean - mean) / baselineMean) * 100
const fmt = (n) => n.toFixed(1)

let md = ''
md += `# Token-Reduction Benchmark — RTK × Caveman × Semantic\n\n`
md += `- Tasks: **${corpus.length}**  |  Tokenizer: **${tokenizerName}**\n`
md += `- RTK transform mode: **${segments[0]?.rtkMode ?? 'n/a'}** (set \`RTK_BENCH_BIN\` to use the real binary)\n`
md += `- Baseline (all features off) mean total: **${fmt(baselineMean)} tokens/task**\n\n`

md += `## 8 combinations (R=RTK, C=Caveman, S=Semantic)\n\n`
md += `| Combo | Mean input | Mean output | Mean total | ± std | Reduction vs baseline |\n`
md += `|-------|-----------:|------------:|-----------:|------:|----------------------:|\n`
for (const p of [...perCombo].sort((a, b) => a.meanTotal - b.meanTotal)) {
  md += `| \`${p.key}\` | ${fmt(p.meanInput)} | ${fmt(p.meanOutput)} | ${fmt(p.meanTotal)} | ${fmt(p.stdTotal)} | ${fmt(pct(p.meanTotal))}% |\n`
}

md += `\n## Main effects (average % reduction when a flag is turned ON)\n\n`
md += `| Feature | Mean reduction | ± std | Consistent? |\n`
md += `|---------|---------------:|------:|:-----------:|\n`
for (const [name, e] of Object.entries(effects)) {
  const consistent = e.meanPct - e.stdPct > 0 ? 'yes' : 'noisy'
  md += `| ${name} | ${fmt(e.meanPct)}% | ${fmt(e.stdPct)}% | ${consistent} |\n`
}

md += `\n## Conclusion\n\n`
for (const [name, e] of Object.entries(effects)) {
  const verdict = e.meanPct <= 0
    ? `does **not** reduce tokens in this corpus (${fmt(e.meanPct)}%)`
    : e.meanPct - e.stdPct > 0
      ? `**consistently reduces** tokens (~${fmt(e.meanPct)}% ± ${fmt(e.stdPct)})`
      : `reduces tokens on average (~${fmt(e.meanPct)}%) but with high variance (± ${fmt(e.stdPct)}) — depends on the task`
  md += `- **${name}**: ${verdict}.\n`
}
const allOn = perCombo.find((p) => p.key === 'RCS')
md += `\n- All three together: **${fmt(pct(allOn.meanTotal))}%** fewer tokens than baseline (${fmt(baselineMean)} → ${fmt(allOn.meanTotal)} tokens/task).\n`
md += `\n> Note: token counts are an offline estimate; the comparison between combinations is the signal, not the absolute figure.\n`

mkdirSync(RESULTS_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(RESULTS_DIR, `bench-${stamp}.md`), md)
writeFileSync(join(RESULTS_DIR, `bench-${stamp}.json`), JSON.stringify({
  tokenizer: tokenizerName,
  tasks: corpus.length,
  baselineMean,
  perCombo: perCombo.map((p) => ({ key: p.key, meanTotal: p.meanTotal, stdTotal: p.stdTotal, reductionPct: pct(p.meanTotal) })),
  effects
}, null, 2))

process.stdout.write(md + `\nSaved to tests/token-bench/results/bench-${stamp}.{md,json}\n`)
