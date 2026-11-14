#!/usr/bin/env node
/**
 * OXE-105 performance baseline table. Reads the artifacts of .github/workflows/perf-gate.yml, downloaded into one
 * folder (gh run download <run> -D <folder>: one subfolder per artifact, each with meta.json, build.log and
 * sample-<i>.log), and prints Markdown: every metric x (version, OS), median and p90 across samples, and n.
 *
 *   node scripts/perf-baseline-table.mjs <folder> [--mode packaged|mock|all]
 *
 * One value per metric per sample (one sample = one fresh Playwright run of the three benchmark specs):
 * - perf-benchmark.spec.ts: an interaction repeated inside the run gives its warm mean (the first, cold repeat left
 *   out, as the CI gate does), or the mean when it ran once; "[first]" rows are the first repeat (a first open).
 * - perceived-perf.spec.ts (one launch per sample): first content / first feedback / longest blank, cold and warm.
 * - memory-footprint.spec.ts: private MB per process type with four terminals of 20,000 lines (code only).
 * - build.log: bundle sizes (one build per job, so n = 1).
 * p90 is interpolated between the closest ranks (with 5 samples: the 4th value + 0.6 x (5th - 4th)).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const root = args.find(arg => !arg.startsWith('--'))
const modeArg = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'all'
if (!root || !existsSync(root)) {
  console.error('usage: node scripts/perf-baseline-table.mjs <folder with the perf-baseline-* artifacts> [--mode packaged|mock|all]')
  process.exit(2)
}

/** Gate metrics (OXE-105) and the metric that measures each. */
const GATE = [
  ['Boot to interactive (process start → first painted screen)', 'pb boot: process→interactive'],
  ['Boot: launch → start screen usable (Playwright view)', 'pb boot: firstWindow→interactive'],
  ['Mode switch Code→Thread', 'pb mode switch: Code→Thread'],
  ['Mode switch Thread→OxeQuery', 'pb mode switch: Thread→OxeQuery'],
  ['Mode switch OxeQuery→Code', 'pb mode switch: OxeQuery→Code'],
  ['Keystroke latency, no agent streaming (composer, 5k events)', 'pb thread 5k: keystroke→paint'],
  ['Keystroke latency, agent streaming (composer, 5k events)', 'pb thread 5k: keystroke→paint while streaming'],
  ['First open of a side panel: Files', 'pb panel open:  Files [first]'],
  ['First open of a side panel: Changes', 'pb panel open:  Changes [first]'],
  ['First open of a side panel: Commit & pull request', 'pb panel open:  Commit & pull request [first]'],
  ['First open of a side panel: Find in files', 'pb panel open:  Find in files [first]'],
  ['First open of a side panel: Worktrees', 'pb panel open:  Worktrees [first]'],
  ['First open of a side panel: Browser', 'pb panel open:  Browser [first]'],
  ['MCP servers modal open (first)', 'pb modal open:  MCP servers [first]'],
  ['MCP servers modal open (warm)', 'pb modal open:  MCP servers'],
  ['Command palette open (first)', 'pb shell: command menu open [first]'],
  ['Command palette open (warm)', 'pb shell: command menu open'],
  ['Settings open (first, click → settings tree)', 'pb modal open:  Agent Settings [first]'],
  ['Settings · Agents cold: first content', 'pp Settings · Agents cold: content'],
  ['OxeChat cold open: first content', 'pp OxeChat (Thread) cold: content'],
  ['OxeChat cold open: first feedback', 'pp OxeChat (Thread) cold: feedback'],
  ['Memory, 4 panes: main process working set MB', 'mf code only: main process working set MB'],
  ['Memory, 4 panes: window (renderer) working set MB', 'mf code only: renderer working set MB'],
  ['Memory, 4 panes: all processes working set MB', 'mf code only: total working set MB'],
  ['Memory, 4 panes: main process private MB (Windows only)', 'mf code only: main process private MB'],
  ['Memory, 4 panes: window (renderer) private MB (Windows only)', 'mf code only: renderer private MB'],
  ['Memory, 4 panes: main process RSS MB', 'mf code only: main RSS MB'],
  ['Renderer entry size kB', 'bundle renderer entry kB'],
  ['Renderer boot (entry + preloaded chunks) kB', 'bundle renderer boot kB']
]
const FIRST_ROWS = /^(panel open|modal open|shell: command menu open|shell: tools open)/

const num = value => (value === undefined || value === null || value === 'n/a' ? NaN : Number(value))

/** Metrics of one sample log: name → value. */
function parseSample(text) {
  const out = new Map()
  const put = (name, value) => { if (Number.isFinite(value)) out.set(name, value) }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '')
    const at = line.indexOf('[RESULT] ')
    const memAt = line.indexOf('[MEMORY] ')
    if (memAt >= 0) {
      const m = /^\[MEMORY\] (code only|thread open|thread scrolled) (\{.*\})\s*$/.exec(line.slice(memAt))
      if (!m) continue
      let data
      try { data = JSON.parse(m[2]) } catch { continue }
      const by = data.byType ?? {}
      put(`mf ${m[1]}: main process private MB`, by.Browser || NaN)
      put(`mf ${m[1]}: renderer private MB`, by.Tab || NaN)
      put(`mf ${m[1]}: GPU private MB`, by.GPU || NaN)
      put(`mf ${m[1]}: total private MB`, data.totalMb || NaN)
      const ws = data.workingSetByType ?? {}
      put(`mf ${m[1]}: main process working set MB`, ws.Browser)
      put(`mf ${m[1]}: renderer working set MB`, ws.Tab)
      put(`mf ${m[1]}: total working set MB`, data.workingSetTotalMb)
      put(`mf ${m[1]}: main RSS MB`, data.mainRssMb)
      put(`mf ${m[1]}: main heap MB`, data.mainHeapMb)
      put(`mf ${m[1]}: renderer heap MB`, data.rendererHeapMb)
      continue
    }
    if (at < 0) continue
    const body = line.slice(at + '[RESULT] '.length)
    let m
    // perf-benchmark: "<op> n=6 min=.. mean=.. p95=.. max=.. ms · warm mean=.. p95=.. first=.."
    if ((m = /^(.+?)\s+n=(\d+) min=([\d.]+) mean=([\d.]+) p95=[\d.]+ max=[\d.]+ ms(?: · warm mean=([\d.]+) p95=[\d.]+)?(?: first=([\d.]+))?/.exec(body))) {
      const op = m[1].trim()
      put(`pb ${op}`, num(m[5] ?? m[4]))
      if (Number(m[2]) > 1 && FIRST_ROWS.test(op)) put(`pb ${op} [first]`, num(m[6]))
      continue
    }
    if ((m = /^memory after workspace\s+processes=\d+ workingSet=([\d.]+)MB peak=([\d.]+)MB rendererHeap=([\d.]+)MB/.exec(body))) {
      put('pb memory after workspace: working set MB', num(m[1]))
      put('pb memory after workspace: renderer heap MB', num(m[3]))
      continue
    }
    if ((m = /^memory main process, 10 Threads open\s+rss=([\d.]+)MB heap=([\d.]+)MB/.exec(body))) {
      put('pb memory main, 10 Threads open: RSS MB', num(m[1]))
      put('pb memory main, 10 Threads open: heap MB', num(m[2]))
      continue
    }
    if ((m = /^thread 5k: scroll frames over 50 ms = (\d+)\/(\d+)/.exec(body))) { put('pb thread 5k: scroll frames over 50 ms (count)', num(m[1])); continue }
    // perceived-perf boot: "<key> median/max A/B ms"
    if ((m = /^(boot: .+?)\s+median\/max ([\d.]+|n\/a)/.exec(body))) { put(`pp ${m[1].trim()}`, num(m[2])); continue }
    // perceived-perf surface: "<name> <phase> feedback content blank sidebar-blank frames~.."
    if ((m = /^(.+?)\s+(cold|warm)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+frames~/.exec(body))) {
      const first = cell => num(cell.split('/')[0])
      put(`pp ${m[1].trim()} ${m[2]}: feedback`, first(m[3]))
      put(`pp ${m[1].trim()} ${m[2]}: content`, first(m[4]))
      put(`pp ${m[1].trim()} ${m[2]}: blank`, first(m[5]))
      continue
    }
  }
  return out
}

function parseBuild(text) {
  const out = new Map()
  let m
  if ((m = /\[bundle\] renderer entry: ([\d.]+) kB/.exec(text))) out.set('bundle renderer entry kB', Number(m[1]))
  if ((m = /\[bundle\] renderer boot \([^)]*\): ([\d.]+) kB/.exec(text))) out.set('bundle renderer boot kB', Number(m[1]))
  if ((m = /\[bundle\] main process entry: ([\d.]+) kB/.exec(text))) out.set('bundle main entry kB', Number(m[1]))
  return out
}

const quantile = (sorted, q) => {
  if (!sorted.length) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** column key → { meta, metrics: name → values[], samples: string[] } */
const columns = new Map()
const order = []
const seen = new Set()
for (const name of readdirSync(root).sort()) {
  const dir = join(root, name)
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'meta.json'))) continue
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))
  if (modeArg !== 'all' && meta.mode !== modeArg) continue
  const key = `${meta.version} ${meta.platform}${meta.mode === 'mock' ? ' (mock)' : ''}`
  const column = { meta, metrics: new Map(), status: existsSync(join(dir, 'samples.txt')) ? readFileSync(join(dir, 'samples.txt'), 'utf8').trim().split(/\r?\n/) : [] }
  const add = (metric, value) => {
    if (!seen.has(metric)) { seen.add(metric); order.push(metric) }
    if (!column.metrics.has(metric)) column.metrics.set(metric, [])
    column.metrics.get(metric).push(value)
  }
  if (existsSync(join(dir, 'build.log'))) for (const [metric, value] of parseBuild(readFileSync(join(dir, 'build.log'), 'utf8'))) add(metric, value)
  const logs = readdirSync(dir).filter(file => /^sample-\d+\.log$/.test(file)).sort((a, b) => parseInt(a.slice(7)) - parseInt(b.slice(7)))
  for (const file of logs) for (const [metric, value] of parseSample(readFileSync(join(dir, file), 'utf8'))) add(metric, value)
  columns.set(key, column)
}
if (!columns.size) { console.error(`no perf-baseline artifacts under ${root}`); process.exit(1) }

const platformRank = { windows: 0, linux: 1 }
const keys = [...columns.keys()].sort((a, b) => {
  const ma = columns.get(a).meta, mb = columns.get(b).meta
  return (ma.mode === mb.mode ? 0 : ma.mode === 'packaged' ? -1 : 1) || (platformRank[ma.platform] - platformRank[mb.platform]) || ma.version.localeCompare(mb.version, undefined, { numeric: true })
})

const fmt = (value, metric = '') => !Number.isFinite(value) ? '—' : Math.abs(value) >= 100 && !/kB/.test(metric) ? value.toFixed(0) : value.toFixed(1)
const cell = (key, metric) => {
  const values = columns.get(key).metrics.get(metric)
  if (!values?.length) return 'n/a'
  const sorted = [...values].sort((a, b) => a - b)
  return `${fmt(quantile(sorted, 0.5), metric)} / ${fmt(quantile(sorted, 0.9), metric)} (${values.length})`
}
const header = cols => [`| metric | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`]

console.log('Cells: median / p90 (n). Times in ms unless the metric says MB or kB. — = not measured; n/a = no sample.\n')
console.log('### Gate metrics\n')
for (const line of header(keys)) console.log(line)
for (const [label, metric] of GATE) console.log(`| ${label} | ${keys.map(key => cell(key, metric)).join(' | ')} |`)

console.log('\n### Every metric\n')
for (const line of header(keys)) console.log(line)
for (const metric of order) console.log(`| ${metric.replace(/\|/g, '\\|')} | ${keys.map(key => cell(key, metric)).join(' | ')} |`)

console.log('\n### Runs\n')
for (const key of keys) {
  const { meta, status } = columns.get(key)
  console.log(`- ${key}: app ${meta.sha?.slice(0, 9)} · bench ${meta.bench_sha?.slice(0, 9)} · ${meta.os} (${meta.image}) · run ${meta.run_id} · ${status.join('; ') || 'no samples.txt'}`)
}

// Runner noise: for every timing metric with 3+ samples, (p90 - median) / median; the median of that per column.
console.log('\n### Spread between samples (timing metrics, median over metrics of (p90 − median) / median)\n')
for (const key of keys) {
  const spreads = []
  for (const [metric, values] of columns.get(key).metrics) {
    if (values.length < 3 || /MB|kB|count/.test(metric)) continue
    const sorted = [...values].sort((a, b) => a - b)
    const median = quantile(sorted, 0.5)
    if (median > 0) spreads.push((quantile(sorted, 0.9) - median) / median)
  }
  spreads.sort((a, b) => a - b)
  console.log(`- ${key}: ${spreads.length ? `${(quantile(spreads, 0.5) * 100).toFixed(0)}% (worst ${(spreads.at(-1) * 100).toFixed(0)}%, ${spreads.length} metrics)` : 'n/a'}`)
}
