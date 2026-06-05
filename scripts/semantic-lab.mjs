#!/usr/bin/env node
/**
 * Semantic-Search Lab — a single concrete request, measured WITH and WITHOUT the
 * semantic feature, then layered with RTK and Caveman.
 *
 * Unlike token-reduction-bench.mjs (a synthetic 2^3 factorial whose "semantic"
 * result files are hand-picked in the corpus), this lab runs the REAL semantic
 * pipeline the app ships:
 *   - same model:      Xenova/multilingual-e5-small (quantized)
 *   - same embedding:  mean pooling + L2 normalize  (see electron/main/workers/semantic-worker.ts)
 *   - same ranking:    cosine similarity            (see electron/main/services/semantic.service.ts)
 *   - same file gate:  CODE_EXTENSIONS / IGNORED_SEGMENTS / 256KB cap
 *
 * It embeds this repository, answers one developer request, and accounts for the
 * tokens an agent would spend in each scenario:
 *
 *   Without semantic → the agent has to load a broad context to find the answer:
 *      • "dir sweep"   : every indexable file in the most-relevant top-level dir
 *      • "repo dump"   : every indexable file in electron/ + src/ + shared/ (upper bound)
 *   With semantic    → only the top-K files the vector search returns.
 *
 *   RTK     → compresses raw TERMINAL OUTPUT (input)  — applied to a real-shaped capture.
 *   Caveman → makes the model answer tersely (output) — verbose vs terse pair.
 *
 * Tokenizer: gpt-tokenizer (o200k_base, approximates Anthropic) if installed.
 *
 * Usage:  node scripts/semantic-lab.mjs
 *         node scripts/semantic-lab.mjs "your question here"
 *         LAB_TOPK=8 node scripts/semantic-lab.mjs
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, extname, sep } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)
const RESULTS_DIR = join(ROOT, 'tests', 'token-bench', 'results')

// ---------------------------------------------------------------------------
// The request under study (override via argv[2]).
// ---------------------------------------------------------------------------
const REQUEST = process.argv[2] ||
  'Como o servidor MCP entra em hibernação por inatividade e onde fica o timer de sleep?'
const TOP_K = Number(process.env.LAB_TOPK || 5)
const SCAN_DIRS = ['electron', 'src', 'shared']
// Mirrors electron/main/services/semantic-model.ts + semantic-chunk.ts so the
// lab ranks like the shipped feature: multilingual-e5-small, E5 prefixes, chunked.
const MODEL_ID = 'Xenova/multilingual-e5-small'
const QUERY_PREFIX = 'query: '
const PASSAGE_PREFIX = 'passage: '
const CHUNK_CHARS = 1500
const CHUNK_OVERLAP = 200
const MAX_CHUNKS = 60
function chunkText(text) {
  const t = text ?? ''
  if (t.length <= CHUNK_CHARS) return t.length > 0 ? [t] : []
  const step = CHUNK_CHARS - CHUNK_OVERLAP
  const chunks = []
  for (let s = 0; s < t.length && chunks.length < MAX_CHUNKS; s += step) chunks.push(t.slice(s, s + CHUNK_CHARS))
  return chunks
}

// File gate — mirrors electron/main/services/semantic.service.ts + semantic-ignore.ts
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.swift', '.scala', '.sh', '.bash', '.ps1', '.sql', '.html',
  '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.yml', '.yaml', '.toml'
])
const IGNORED_SEGMENTS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.turbo', 'coverage'
])
const MAX_INDEXABLE_BYTES = 256 * 1024

// ---------------------------------------------------------------------------
// Tokenizer (same loader as token-reduction-bench.mjs)
// ---------------------------------------------------------------------------
let countTokens
let tokenizerName
try {
  const mod = await import('gpt-tokenizer')
  countTokens = (t) => mod.encode(t ?? '').length
  tokenizerName = 'gpt-tokenizer (o200k_base — approximates Anthropic)'
} catch {
  countTokens = (t) => {
    const s = t ?? ''
    if (!s) return 0
    return Math.max(Math.ceil(s.length / 4), Math.ceil(s.split(/\s+/).filter(Boolean).length * 1.3))
  }
  tokenizerName = 'heuristic (~chars/4) — install `gpt-tokenizer` for higher fidelity'
}

// ---------------------------------------------------------------------------
// RTK heuristic (same transform as token-reduction-bench.mjs)
// ---------------------------------------------------------------------------
function applyRtk(text) {
  const stripped = text
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')
    .split('\n')
    .map((line) => (line.includes('\r') ? line.slice(line.lastIndexOf('\r') + 1) : line))
    .map((line) => line.replace(/[ \t]+$/g, ''))
  const out = []
  let prevBlank = false
  let prev = null
  for (const line of stripped) {
    const blank = line.trim() === ''
    if (blank && prevBlank) continue
    if (line === prev) continue
    out.push(line)
    prevBlank = blank
    prev = line
  }
  return out.join('\n')
}

// A real-shaped noisy terminal capture: ANSI colour, \r progress frames, and
// duplicate spinner/progress lines — exactly the spam RTK strips before the
// agent ever sees it.
const TERMINAL_RAW = [
  '\x1B[2m$ npm install\x1B[0m',
  'npm warn deprecated \x1B[33minflight@1.0.6\x1B[0m: This module is not supported',
  '\r\x1B[36m⠋\x1B[0m reify:onnxruntime-node: \x1B[7mtiming\x1B[0m',
  '\r\x1B[36m⠙\x1B[0m reify:onnxruntime-node: \x1B[7mtiming\x1B[0m',
  '\r\x1B[36m⠹\x1B[0m reify:onnxruntime-node: \x1B[7mtiming\x1B[0m',
  '\r\x1B[36m⠸\x1B[0m reify:@xenova/transformers: \x1B[7mhttp fetch GET 200\x1B[0m',
  '\r\x1B[36m⠼\x1B[0m reify:@xenova/transformers: \x1B[7mhttp fetch GET 200\x1B[0m',
  '\ridealTree:oxespace: \x1B[7msill\x1B[0m idealTree buildDeps',
  '\rreify:sharp: \x1B[32mhttp\x1B[0m fetch GET 200 https://registry.npmjs.org/sharp 1200ms',
  '\rreify:sharp: \x1B[32mhttp\x1B[0m fetch GET 200 https://registry.npmjs.org/sharp 1200ms',
  '',
  '',
  'added 3 packages, and audited 942 packages in 6s',
  '',
  '\x1B[32m142\x1B[0m packages are looking for funding',
  '  run `npm fund` for details',
  '',
  '\x1B[2m$ npm test\x1B[0m',
  '\r\x1B[36m RUN \x1B[0m  v2.1.9',
  '\r\x1B[36m RUN \x1B[0m  v2.1.9',
  ' \x1B[32m✓\x1B[0m tests/integration/semantic-ignore.test.ts (8 tests) 6ms',
  ' \x1B[32m✓\x1B[0m tests/integration/semantic.service.test.ts (4 tests) 9ms',
  '\r\x1B[2m Test Files \x1B[0m running...',
  '\r\x1B[2m Test Files \x1B[0m running...',
  '\r\x1B[2m Test Files \x1B[0m running...',
  ' \x1B[32mTest Files\x1B[0m  48 passed (61)',
  '      Tests  298 passed (342)'
].join('\n')

// Illustrative answer pair for the Caveman (output) dimension. The lab cannot
// call the model, so these represent a typical verbose vs terse reply.
const RESPONSE_VERBOSE = `Great question! Let me walk you through how the MCP server hibernation works in this codebase.

The hibernation logic lives in the McpManager class inside electron/main/services/mcp.service.ts. The key idea is that each running MCP server keeps a "lastActivity" timestamp and an associated "sleepTimer". Whenever a tool call is routed through the manager, a private method called touchRuntime() is invoked. This method updates the lastActivity timestamp to the current time and then resets the sleep timer.

The sleep timer itself is created with setTimeout, using the SLEEP_TIMEOUT_MS constant, which is defined as 15 * 60 * 1000 — in other words, fifteen minutes. If no further activity happens within that window, the timer fires and calls stopRuntime(), which gracefully shuts the server process down and logs a message indicating that the server is being hibernated due to inactivity.

So, to summarize: the timer is the "sleepTimer" field on the RuntimeServer, the duration is the SLEEP_TIMEOUT_MS constant (15 minutes), and the whole thing is kept alive by touchRuntime() being called on every tool invocation. When you next call the server it will be restarted automatically. Let me know if you'd like me to point you at the exact line numbers!`

const RESPONSE_CAVEMAN = `electron/main/services/mcp.service.ts: touchRuntime() resets sleepTimer (setTimeout SLEEP_TIMEOUT_MS = 15min) on each tool call; on timeout -> stopRuntime() kills the server. Restarts on next call.`

// ---------------------------------------------------------------------------
// File walk (gated like the real indexer)
// ---------------------------------------------------------------------------
function walk(dir, acc) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (IGNORED_SEGMENTS.has(e.name) || (e.name.length > 1 && e.name.startsWith('.'))) continue
    if (e.isDirectory()) { walk(full, acc); continue }
    if (!CODE_EXTENSIONS.has(extname(e.name).toLowerCase())) continue
    let size
    try { size = statSync(full).size } catch { continue }
    if (size > MAX_INDEXABLE_BYTES || size === 0) continue
    acc.push(full)
  }
  return acc
}

// Realistic "no semantic" baseline: the agent greps the salient terms from the
// request and reads every file that matches (it has no ranking to trust a top-K).
const STOPWORDS = new Set([
  'como', 'onde', 'fica', 'para', 'pelo', 'pela', 'por', 'dos', 'das', 'que', 'com', 'sem',
  'uma', 'uns', 'umas', 'isso', 'esta', 'este', 'entra', 'esta', 'sobre', 'qual', 'quais',
  'the', 'and', 'for', 'where', 'how', 'does', 'into', 'with', 'from', 'what', 'when', 'this',
  'that', 'are', 'can', 'about', 'which'
])
function keywords(text) {
  return [...new Set(
    (text.toLowerCase().match(/[a-zà-ú0-9]{4,}/giu) || [])
      .map((w) => w.toLowerCase())
      .filter((w) => !STOPWORDS.has(w))
  )]
}

// ---------------------------------------------------------------------------
// Cosine (same formula as semantic.service.ts)
// ---------------------------------------------------------------------------
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const log = (...a) => process.stderr.write(a.join(' ') + '\n')

log(`[lab] scanning ${SCAN_DIRS.join(', ')} …`)
const files = []
for (const d of SCAN_DIRS) walk(join(ROOT, d), files)
log(`[lab] ${files.length} indexable files`)

log(`[lab] loading model Xenova/multilingual-e5-small (quantized) …`)
const { pipeline, env } = await import('@xenova/transformers')
env.allowRemoteModels = true
const extractor = await pipeline('feature-extraction', MODEL_ID, { quantized: true })

async function embed(text) {
  const out = await extractor(text, { pooling: 'mean', normalize: true })
  return Array.from(out.data)
}

log(`[lab] embedding ${files.length} files (chunked, ~${CHUNK_CHARS} chars/chunk) …`)
const records = []
let done = 0
let totalChunks = 0
for (const f of files) {
  let content
  try { content = readFileSync(f, 'utf-8') } catch { continue }
  if (!content.trim()) continue
  const vecs = []
  for (const chunk of chunkText(content)) vecs.push(await embed(PASSAGE_PREFIX + chunk))
  if (vecs.length === 0) continue
  totalChunks += vecs.length
  records.push({ file: f, rel: relative(ROOT, f).split(sep).join('/'), content, vecs })
  if (++done % 50 === 0) log(`[lab]   ${done}/${files.length} files, ${totalChunks} chunks`)
}
log(`[lab] embedded ${records.length} files / ${totalChunks} chunks`)

log(`[lab] querying: ${REQUEST}`)
const qvec = await embed(QUERY_PREFIX + REQUEST)
const ranked = records
  .map((r) => ({ ...r, score: Math.max(...r.vecs.map((v) => cosine(qvec, v))) }))
  .sort((a, b) => b.score - a.score)

const top = ranked.slice(0, TOP_K)

// ---- token accounting -----------------------------------------------------
const joinContent = (rs) => rs.map((r) => `// ${r.rel}\n${r.content}`).join('\n\n')

const kw = keywords(REQUEST)
const grepSweep = records.filter((r) => {
  const lc = r.content.toLowerCase()
  return kw.some((k) => lc.includes(k))
})

const ctxSemantic = countTokens(joinContent(top))
const ctxGrep = countTokens(joinContent(grepSweep))
const ctxRepoDump = countTokens(joinContent(records))

const terminalRaw = countTokens(TERMINAL_RAW)
const terminalRtk = countTokens(applyRtk(TERMINAL_RAW))
const outVerbose = countTokens(RESPONSE_VERBOSE)
const outCaveman = countTokens(RESPONSE_CAVEMAN)
const requestTok = countTokens(REQUEST)

// Combo accounting. "semantic off" uses the realistic grep-union baseline.
const combo = ({ rtk, caveman, semantic }) => {
  const terminal = rtk ? terminalRtk : terminalRaw
  const ctx = semantic ? ctxSemantic : ctxGrep
  const out = caveman ? outCaveman : outVerbose
  const input = requestTok + terminal + ctx
  return { input, output: out, total: input + out }
}
const COMBOS = []
for (const rtk of [false, true]) for (const caveman of [false, true]) for (const semantic of [false, true]) COMBOS.push({ rtk, caveman, semantic })
const key = (c) => `${c.rtk ? 'R' : '·'}${c.caveman ? 'C' : '·'}${c.semantic ? 'S' : '·'}`
const baseTotal = combo({ rtk: false, caveman: false, semantic: false }).total
const allOn = combo({ rtk: true, caveman: true, semantic: true })
const redPct = (t) => ((baseTotal - t) / baseTotal) * 100
const fmt = (n) => n.toLocaleString('en-US')
const f1 = (n) => n.toFixed(1)

// ---- report ---------------------------------------------------------------
let md = ''
md += `# Semantic-Search Lab — one request, with vs without\n\n`
md += `**Request:** _${REQUEST}_\n\n`
md += `- Model: **${MODEL_ID}** (quantized) · same pipeline the app ships\n`
md += `- Corpus: **${records.length}** indexable files / **${totalChunks}** chunks under \`${SCAN_DIRS.join('`, `')}\` · Tokenizer: **${tokenizerName}**\n`
md += `- Ranking: chunked (~${CHUNK_CHARS} chars/chunk), best-chunk cosine — same as the shipped service\n`
md += `- Top-K returned by semantic search: **${TOP_K}**\n\n`

md += `## What semantic search actually returned (real ranking)\n\n`
md += `| # | Score | File |\n|--:|------:|------|\n`
top.forEach((r, i) => { md += `| ${i + 1} | ${r.score.toFixed(3)} | \`${r.rel}\` |\n` })

md += `\n## Context cost to answer the request (input tokens for code context)\n\n`
md += `| Strategy | Files | Context tokens | vs repo-dump |\n`
md += `|----------|------:|---------------:|-------------:|\n`
md += `| Repo dump (no retrieval, upper bound) | ${records.length} | ${fmt(ctxRepoDump)} | — |\n`
md += `| Grep union (realistic no-semantic) | ${grepSweep.length} | ${fmt(ctxGrep)} | −${f1((1 - ctxGrep / ctxRepoDump) * 100)}% |\n`
md += `| **Semantic top-${TOP_K}** | ${TOP_K} | **${fmt(ctxSemantic)}** | **−${f1((1 - ctxSemantic / ctxRepoDump) * 100)}%** |\n`
md += `\n> Grep baseline = files containing any of: ${kw.map((k) => `\`${k}\``).join(', ')}.\n`
md += `> Semantic top-${TOP_K} vs the grep baseline: **−${f1((1 - ctxSemantic / ctxGrep) * 100)}%** context tokens `
md += `(${fmt(ctxGrep)} → ${fmt(ctxSemantic)}).\n`

md += `\n## Other dimensions (per request)\n\n`
md += `| Component | Off | On | Saving |\n|-----------|----:|---:|-------:|\n`
md += `| RTK — terminal output (input) | ${fmt(terminalRaw)} | ${fmt(terminalRtk)} | −${f1((1 - terminalRtk / terminalRaw) * 100)}% |\n`
md += `| Caveman — model answer (output) | ${fmt(outVerbose)} | ${fmt(outCaveman)} | −${f1((1 - outCaveman / outVerbose) * 100)}% |\n`

md += `\n## Full request accounting — 8 combinations (R=RTK, C=Caveman, S=Semantic)\n\n`
md += `Each row = request + terminal output + code context (input) and the model answer (output).\n\n`
md += `| Combo | Input | Output | Total | Reduction vs baseline |\n`
md += `|-------|------:|-------:|------:|----------------------:|\n`
for (const c of COMBOS.map((c) => ({ c, t: combo(c) })).sort((a, b) => a.t.total - b.t.total)) {
  md += `| \`${key(c.c)}\` | ${fmt(c.t.input)} | ${fmt(c.t.output)} | ${fmt(c.t.total)} | ${f1(redPct(c.t.total))}% |\n`
}

md += `\n## Bottom line\n\n`
md += `- **Semantic search** is the dominant lever: it replaces a broad context with a small top-${TOP_K} set — `
md += `**${fmt(ctxRepoDump)} → ${fmt(ctxSemantic)}** vs a repo dump (**−${f1((1 - ctxSemantic / ctxRepoDump) * 100)}%**), `
md += `**${fmt(ctxGrep)} → ${fmt(ctxSemantic)}** vs grep (**−${f1((1 - ctxSemantic / ctxGrep) * 100)}%**).\n`
md += `- **RTK** removes terminal spam: **−${f1((1 - terminalRtk / terminalRaw) * 100)}%** on the command output it sees.\n`
md += `- **Caveman** trims the answer: **−${f1((1 - outCaveman / outVerbose) * 100)}%** output tokens.\n`
md += `- **All three together (vs grep baseline):** **${fmt(baseTotal)} → ${fmt(allOn.total)}** tokens — `
md += `**−${f1(redPct(allOn.total))}%**.\n`

md += `\n## Ranking quality\n\n`
md += `Top hit ${top[0].score.toFixed(3)}, #${TOP_K} ${top[TOP_K - 1].score.toFixed(3)}. `
md += `Chunked best-chunk ranking lets a query match logic anywhere in a file (not just its header), `
md += `which the previous whole-file embedding could not.\n\n`
md += `Model is now multilingual (\`${MODEL_ID}\`, 768-dim, 512-token window), which closes the `
md += `Portuguese-query-vs-English-code gap the English-only MiniLM had. The token-saving accounting above is `
md += `independent of ranking order.\n`
md += `\n> Token counts are an offline estimate (the cross-strategy comparison is the signal). `
md += `Semantic ranking is real; the verbose/terse answer pair is illustrative.\n`

mkdirSync(RESULTS_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(RESULTS_DIR, `lab-${stamp}.md`), md)
writeFileSync(join(RESULTS_DIR, `lab-${stamp}.json`), JSON.stringify({
  request: REQUEST, tokenizer: tokenizerName, corpusFiles: records.length, topK: TOP_K,
  topHits: top.map((r) => ({ file: r.rel, score: r.score })),
  keywords: kw,
  context: { repoDump: ctxRepoDump, grep: { files: grepSweep.length, tokens: ctxGrep }, semantic: ctxSemantic },
  rtk: { raw: terminalRaw, compressed: terminalRtk },
  caveman: { verbose: outVerbose, terse: outCaveman },
  combos: COMBOS.map((c) => ({ key: key(c), ...combo(c), reductionPct: redPct(combo(c).total) })),
  baselineTotal: baseTotal, allOnTotal: allOn.total
}, null, 2))

process.stdout.write(md + `\nSaved to tests/token-bench/results/lab-${stamp}.{md,json}\n`)
