// TEMPORARY (OXE-105 round 2, ci/perf-bisect-oxe-105 only): one row per merge from the bisect jobs' perf-gate.json.
// Usage: node perf-gate/bisect-table.mjs <folder with bisect-* artifacts> <merges.txt from git log --first-parent --merges>
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, mergesFile] = process.argv.slice(2)
const merges = readFileSync(mergesFile, 'utf8').trim().split('\n').filter(Boolean).reverse()
  .map(line => { const [sha, ...rest] = line.split(' '); return { sha, pr: (rest.join(' ').match(/#(\d+)/) || [])[1] || '?' } })
const bySha = {}
for (const name of existsSync(dir) ? readdirSync(dir) : []) {
  const file = join(dir, name, 'perf-gate.json')
  if (!existsSync(file)) continue
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const c = data.heads.find(h => h.side === 'C')
  if (c) bySha[c.sha] = data
}
const METRICS = [
  ['Boot: window → first paint', 'first paint ms'],
  ['Memory, 4 terminals (working set)', 'working set MB'],
  ['Memory, 4 terminals (private bytes)', 'private MB'],
  ['Renderer entry chunk', 'entry KB'],
  ['Boot: process → interactive', 'interactive ms'],
  ['Panel first open: Files', 'Files 1st open ms'],
  ['MCP servers modal, first open', 'MCP 1st open ms']
]
const f = x => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)) : 'n/a')
const s = x => (Number.isFinite(x) && x > 0 ? '+' : '') + f(x)
const out = ['## Bisect vs v1.5.1 (Windows, same runner per merge, 7 rounds BC CB)', '',
  'Each cell: the merge\'s median · Δ merge − v1.5.1 [CI95] · ▲ regresses / ▼ improves (CI entirely above / below 0). Entry KB is exact; "step" is the change from the previous merge.', '',
  `| PR | merge | ${METRICS.map(m => m[1]).join(' | ')} | entry step (bytes) |`, `|---|---|${METRICS.map(() => '---').join('|')}|---:|`]
let prevEntry = null
for (const { sha, pr } of merges) {
  const data = bySha[sha]
  if (!data) { out.push(`| #${pr} | ${sha.slice(0, 9)} | ${METRICS.map(() => 'no data').join(' | ')} | |`); continue }
  const cells = METRICS.map(([name]) => {
    const row = data.rows.find(r => r.metric === name)
    if (!row) return 'n/a'
    const mark = row.verdict.includes('REGRESSES') ? ' ▲' : row.verdict === 'improves' ? ' ▼' : ''
    const ci = Number.isFinite(row.ci[0]) ? ` [${s(row.ci[0])}, ${s(row.ci[1])}]` : ''
    return `${f(row.medians.C)} · ${s(row.delta)}${ci}${mark}`
  })
  const entryRow = data.rows.find(r => r.metric === 'Renderer entry chunk')
  const entry = entryRow?.medians.C
  if (prevEntry == null && Number.isFinite(entryRow?.medians.B)) prevEntry = entryRow.medians.B
  const step = prevEntry != null && Number.isFinite(entry) ? Math.round((entry - prevEntry) * 1024) : ''
  if (Number.isFinite(entry)) prevEntry = entry
  out.push(`| #${pr} | ${sha.slice(0, 9)} | ${cells.join(' | ')} | ${step === '' ? '' : (step > 0 ? '+' : '') + step} |`)
}
console.log(out.join('\n'))
