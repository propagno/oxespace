#!/usr/bin/env node
/**
 * Semantic-Search Evaluation — whole-file vs chunked ranking, over a labeled
 * query set, with retrieval-quality statistics (MRR, Recall@1, Recall@5) and
 * token cost. Produces the data behind the "ship it?" verdict.
 *
 * Method: the corpus is embedded ONCE in chunks (same as the shipped service).
 *   - chunked score  = max cosine over a file's chunks (the new behaviour)
 *   - wholefile score = cosine against the file's FIRST chunk only — a faithful
 *     proxy for the old behaviour, where the worker embedded the whole file but
 *     the model only saw its first ~256 tokens (≈ the head chunk).
 * So a single embedding pass yields both rankings on identical vectors.
 *
 * Ground truth: each query names the file(s) that actually answer it (path
 * substrings). Rank = position of the first matching file in the ranking.
 *
 * Usage:  node scripts/semantic-eval.mjs
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, extname, sep } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(__dirname)
const RESULTS_DIR = join(ROOT, 'tests', 'token-bench', 'results')
const CACHE_DIR = join(ROOT, 'tests', 'token-bench', '.cache')
const CACHE_FILE = join(CACHE_DIR, 'semantic-embeddings.json')
const SCAN_DIRS = ['electron', 'src', 'shared']
const TOP_K = 5

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
  const out = []
  for (let s = 0; s < t.length && out.length < MAX_CHUNKS; s += step) out.push(t.slice(s, s + CHUNK_CHARS))
  return out
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.mdx', '.txt',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.php', '.swift', '.scala', '.sh', '.bash', '.ps1', '.sql', '.html',
  '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.yml', '.yaml', '.toml'
])
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.turbo', 'coverage'])
const MAX_INDEXABLE_BYTES = 256 * 1024

// Labeled queries — Portuguese (the app's audience) against English code.
// target = path substrings that count as a correct answer for that query.
const QUERIES = [
  { q: 'Como o servidor MCP entra em hibernação por inatividade e onde fica o timer de sleep?', target: ['services/mcp.service.ts'] },
  { q: 'Onde os embeddings da busca semântica são gerados pelo worker?', target: ['workers/semantic-worker.ts', 'services/semantic.service.ts'] },
  { q: 'Como o terminal PTY é criado usando o perfil de shell?', target: ['services/terminal.service.ts'] },
  { q: 'Onde fica a validação de allowlist de operações no sistema de arquivos do workspace?', target: ['services/file-system.service.ts'] },
  { q: 'Como os atalhos de teclado para dividir o pane ativo são tratados?', target: ['src/App.tsx'] },
  { q: 'Onde a integração com o GitHub conecta e lista repositórios?', target: ['services/github.service.ts'] },
  { q: 'Como o RTK baixa o binário rtk.exe para a pasta de dados do usuário?', target: ['services/rtk.service.ts'] },
  { q: 'Onde está o registro das ferramentas internas expostas via MCP?', target: ['mcp-internal/tool-registry.ts'] },
  { q: 'Como um workspace é criado com um pane por célula do layout?', target: ['services/workspace.service.ts'] },
  { q: 'Onde o áudio é transcrito usando o Whisper na funcionalidade de voz?', target: ['services/voice.service.ts'] }
]

let countTokens
try {
  const mod = await import('gpt-tokenizer')
  countTokens = (t) => mod.encode(t ?? '').length
} catch {
  countTokens = (t) => Math.ceil((t ?? '').length / 4)
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

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

const log = (...a) => process.stderr.write(a.join(' ') + '\n')

const files = []
for (const d of SCAN_DIRS) walk(join(ROOT, d), files)
log(`[eval] ${files.length} files`)

const { pipeline, env } = await import('@xenova/transformers')
env.allowRemoteModels = true
  env.cacheDir = join(ROOT, 'resources', 'models')
const extractor = await pipeline('feature-extraction', MODEL_ID, { quantized: true })
const embed = async (t) => Array.from((await extractor(t, { pooling: 'mean', normalize: true })).data)

log(`[eval] embedding (chunked) …`)
const records = []
let chunks = 0
let cache = { version: 1, model: MODEL_ID, chunkChars: CHUNK_CHARS, overlap: CHUNK_OVERLAP, records: {} }
try {
  const stored = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  if (stored.version === cache.version && stored.model === MODEL_ID && stored.chunkChars === CHUNK_CHARS && stored.overlap === CHUNK_OVERLAP) cache = stored
} catch { /* cold benchmark cache */ }
const nextCache = { ...cache, records: {} }
let cacheHits = 0
for (const f of files) {
  let content
  try { content = readFileSync(f, 'utf-8') } catch { continue }
  if (!content.trim()) continue
  const rel = relative(ROOT, f).split(sep).join('/')
  const checksum = createHash('sha1').update(content).digest('hex')
  let vecs
  if (cache.records[rel]?.checksum === checksum) {
    vecs = cache.records[rel].vecs
    cacheHits++
  } else {
    vecs = []
    for (const c of chunkText(content)) vecs.push(await embed(PASSAGE_PREFIX + c))
  }
  if (!vecs.length) continue
  chunks += vecs.length
  records.push({ rel, content, vecs })
  nextCache.records[rel] = { checksum, vecs }
}
mkdirSync(CACHE_DIR, { recursive: true })
writeFileSync(CACHE_FILE, JSON.stringify(nextCache))
log(`[eval] ${records.length} files / ${chunks} chunks · cache ${cacheHits}/${records.length}`)

function rankFor(qvec, scoreOf) {
  const ranked = records
    .map((r) => ({ rel: r.rel, content: r.content, score: scoreOf(qvec, r) }))
    .sort((a, b) => b.score - a.score)
  return ranked
}
const wholeScore = (qvec, r) => cosine(qvec, r.vecs[0])               // old: head only
const chunkedScore = (qvec, r) => Math.max(...r.vecs.map((v) => cosine(qvec, v))) // new: best chunk

const STOP = new Set(['como', 'onde', 'fica', 'pelo', 'pela', 'para', 'dos', 'das', 'que', 'uma', 'the', 'how', 'where', 'with', 'from', 'and'])
function queryTerms(q) {
  return [...new Set(q
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().match(/[a-z0-9_$@]+/g) ?? [])]
    .filter((term) => term.length >= 2 && !STOP.has(term))
}
function lexicalScore(q, record) {
  const haystack = `${record.rel}\n${record.content}`.toLowerCase()
  return queryTerms(q).reduce((score, term) => score + (haystack.includes(term) ? (record.rel.toLowerCase().includes(term) ? 3 : 1) : 0), 0)
}
function hybridRank(q, semanticRanked) {
  const lexical = records
    .map((r) => ({ rel: r.rel, content: r.content, score: lexicalScore(q, r) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
  const fused = new Map()
  semanticRanked.forEach((r, i) => fused.set(r.rel, { ...r, fused: 1 / (61 + i) + Math.max(0, r.score) * 0.002 }))
  lexical.forEach((r, i) => {
    const current = fused.get(r.rel) ?? { ...r, fused: 0 }
    current.fused += 0.15 / (61 + i)
    fused.set(r.rel, current)
  })
  const leader = fused.get(semanticRanked[0]?.rel)
  if (leader) {
    for (const item of fused.values()) if (item !== leader && item.fused >= leader.fused) item.fused = leader.fused - Number.EPSILON
  }
  return [...fused.values()].sort((a, b) => b.fused - a.fused)
}
function budgetedContext(ranked, q, budget = 3000) {
  const terms = queryTerms(q)
  let used = 0
  const snippets = []
  for (const result of ranked.slice(0, TOP_K)) {
    const lower = result.content.toLowerCase()
    let focus = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0
    const snippet = result.content.slice(Math.max(0, focus - 350), Math.max(0, focus - 350) + 1400)
    const tokens = countTokens(`${result.rel}\n${snippet}`)
    if (snippets.length > 0 && used + tokens > budget) break
    snippets.push(`${result.rel}\n${snippet}`)
    used += tokens
  }
  return countTokens(snippets.join('\n'))
}

function rankOfTarget(ranked, targets) {
  const idx = ranked.findIndex((r) => targets.some((t) => r.rel.includes(t)))
  return idx === -1 ? Infinity : idx + 1
}

const rows = []
for (const { q, target } of QUERIES) {
  const qvec = await embed(QUERY_PREFIX + q)
  const w = rankFor(qvec, wholeScore)
  const c = rankFor(qvec, chunkedScore)
  const h = hybridRank(q, c)
  rows.push({
    q, target,
    whole: { rank: rankOfTarget(w, target), top1: w[0].rel, topScore: w[0].score, ctxTokens: countTokens(c.slice(0, TOP_K).map((r) => r.content).join('\n')) },
    chunked: { rank: rankOfTarget(c, target), top1: c[0].rel, topScore: c[0].score, ctxTokens: countTokens(c.slice(0, TOP_K).map((r) => r.content).join('\n')) },
    hybrid: { rank: rankOfTarget(h, target), top1: h[0].rel, topScore: h[0].fused, ctxTokens: budgetedContext(h, q) }
  })
}

const agg = (key) => {
  const ranks = rows.map((r) => r[key].rank)
  const recallAt = (n) => ranks.filter((x) => x <= n).length / ranks.length
  const mrr = ranks.reduce((a, x) => a + (x === Infinity ? 0 : 1 / x), 0) / ranks.length
  const meanTopScore = rows.reduce((a, r) => a + r[key].topScore, 0) / rows.length
  const meanCtx = rows.reduce((a, r) => a + r[key].ctxTokens, 0) / rows.length
  return { recall1: recallAt(1), recall5: recallAt(5), mrr, meanTopScore, meanCtx }
}
const W = agg('whole')
const C = agg('chunked')
const H = agg('hybrid')

const pct = (x) => (x * 100).toFixed(0) + '%'
const f3 = (x) => x.toFixed(3)
const f0 = (x) => Math.round(x).toLocaleString('en-US')

let md = ''
md += `# Semantic-Search Evaluation — whole-file vs chunked\n\n`
md += `- Model: **${MODEL_ID}** · Queries: **${QUERIES.length}** (labeled, Portuguese → English code) · Corpus: **${records.length}** files / **${chunks}** chunks · Top-K: **${TOP_K}**\n`
md += `- whole-file = file head only (old behaviour proxy) · chunked = best-chunk over the whole file (new)\n\n`

md += `## Retrieval quality (higher is better)\n\n`
md += `| Metric | Whole-file (old) | Chunked (new) | Δ |\n|--------|----------------:|--------------:|--:|\n`
md += `| Recall@1 (target is #1) | ${pct(W.recall1)} | ${pct(C.recall1)} | ${pct(C.recall1 - W.recall1)} |\n`
md += `| Recall@5 (target in top-5) | ${pct(W.recall5)} | ${pct(C.recall5)} | ${pct(C.recall5 - W.recall5)} |\n`
md += `| MRR (mean reciprocal rank) | ${f3(W.mrr)} | ${f3(C.mrr)} | ${f3(C.mrr - W.mrr)} |\n`
md += `| Mean top-1 score | ${f3(W.meanTopScore)} | ${f3(C.meanTopScore)} | ${f3(C.meanTopScore - W.meanTopScore)} |\n`
md += `\n### Hybrid adaptive retrieval\n\n`
md += `| Metric | Semantic chunked | Hybrid semantic + lexical |\n|---|--:|--:|\n`
md += `| Recall@1 | ${pct(C.recall1)} | ${pct(H.recall1)} |\n`
md += `| Recall@5 | ${pct(C.recall5)} | ${pct(H.recall5)} |\n`
md += `| MRR | ${f3(C.mrr)} | ${f3(H.mrr)} |\n`
md += `| Mean returned context | ${f0(C.meanCtx)} | ${f0(H.meanCtx)} |\n`

md += `\n## Per-query target rank (lower is better; ∞ = outside corpus top)\n\n`
md += `| Query | Target | Rank (old) | Rank (chunked) | Rank (hybrid) |\n|-------|--------|----------:|---------------:|--------------:|\n`
for (const r of rows) {
  const rk = (x) => (x === Infinity ? '∞' : x)
  md += `| ${r.q.slice(0, 52)}… | \`${r.target[0]}\` | ${rk(r.whole.rank)} | ${rk(r.chunked.rank)} | ${rk(r.hybrid.rank)} |\n`
}

md += `\n## Token cost (mean over queries)\n\n`
md += `- Mean semantic top-${TOP_K} context: **${f0(C.meanCtx)} tokens** (chunked).\n`
md += `- Mean hybrid budgeted context: **${f0(H.meanCtx)} tokens**.\n`

md += `\n## Verdict\n\n`
const better = C.mrr > W.mrr && C.recall1 >= W.recall1
md += better
  ? `Chunked ranking is **clearly better**: MRR ${f3(W.mrr)} → ${f3(C.mrr)}, Recall@1 ${pct(W.recall1)} → ${pct(C.recall1)}, Recall@5 ${pct(W.recall5)} → ${pct(C.recall5)}. Ship the chunked implementation.\n`
  : `Chunked ranking did **not** clearly beat whole-file on this set (MRR ${f3(W.mrr)} → ${f3(C.mrr)}). Revisit before shipping.\n`
const contextReduction = 1 - H.meanCtx / C.meanCtx
md += H.recall5 >= C.recall5 && H.mrr >= C.mrr * 0.9
  ? `Hybrid adaptive retrieval **passes the quality floor**: Recall@1 ${pct(C.recall1)} → ${pct(H.recall1)}, Recall@5 ${pct(C.recall5)} → ${pct(H.recall5)}, MRR ${f3(C.mrr)} → ${f3(H.mrr)}, with **${pct(contextReduction)} less returned context**.\n`
  : `Hybrid adaptive retrieval **fails the quality floor** despite ${pct(contextReduction)} less context. Recalibrate fusion before shipping.\n`

mkdirSync(RESULTS_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(join(RESULTS_DIR, `eval-${stamp}.md`), md)
writeFileSync(join(RESULTS_DIR, `eval-${stamp}.json`), JSON.stringify({ queries: QUERIES.length, corpus: records.length, chunks, whole: W, chunked: C, hybrid: H, rows }, null, 2))
process.stdout.write(md + `\nSaved to tests/token-bench/results/eval-${stamp}.{md,json}\n`)
