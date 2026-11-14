// Release gate table (OXE-105, .github/workflows/perf-gate.yml). Reads one OS's results folder:
//   heads.json                      [{ side: 'A', ref: 'v1.5.0', sha }, …], the sides in table order; B is the
//                                   baseline (the previous release), C the candidate
//   <side>-entry.json               the renderer entry chunk of that side's build ({ file, bytes, gzipBytes })
//   rounds/<side>-r<n>-boot.log     the boot probe's `[GATE-BOOT]` lines of round n (1 warm-up launch, then measured)
//   rounds/<side>-r<n>-bench.log    perf-benchmark, memory-footprint and perceived-perf output of round n
// Each metric has one value per side and round (a round's own median, its first open, …). Per metric the table shows
// each side's median over the rounds and Δ = C − B as the median of the paired round differences with a 95% bootstrap
// interval. Verdict: REGRESSES when the interval lies entirely above zero, IMPROVES when entirely below, else within
// noise. Fewer than 3 paired rounds: n/a.
// Usage: node perf-gate/summarize.mjs <results folder> <label> [--json <out.json>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, label = ''] = process.argv.slice(2)
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null
const heads = JSON.parse(readFileSync(join(dir, 'heads.json'), 'utf8'))
const sides = heads.map(h => h.side)
const BASE = 'B'
const CAND = 'C'

const median = xs => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN }
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; const pos = (s.length - 1) * q; const lo = Math.floor(pos); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo) }

/** `[RESULT] <op> n=… median=… first=…` lines of perf-benchmark's report(), by op (first occurrence wins). */
function resultLines(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('[RESULT] ')
    if (at < 0) continue
    const m = line.slice(at + 9).match(/^(.+?)\s+n=\d+ .*?median=(-?[\d.]+) first=(-?[\d.]+)/)
    if (m && !(m[1].trim() in out)) out[m[1].trim()] = { median: Number(m[2]), first: Number(m[3]) }
  }
  return out
}
/** perceived-perf's surface rows: `[RESULT] <surface> <phase> feedback content blank sidebar-blank` as median/max. */
function perceivedRow(text, surface, phase) {
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf('[RESULT] ')
    if (at < 0) continue
    const rest = line.slice(at + 9)
    if (!rest.startsWith(surface)) continue
    const cols = rest.slice(surface.length).trim().split(/\s+/)
    if (cols[0] !== phase) continue
    const med = s => (s && /^-?[\d.]+\//.test(s) ? Number(s.split('/')[0]) : NaN)
    return { feedback: med(cols[1]), content: med(cols[2]), blank: med(cols[3]), sidebarBlank: med(cols[4]) }
  }
  return null
}
function memoryLine(text, phase) {
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(`[MEMORY] ${phase} `)
    if (at < 0) continue
    try { return JSON.parse(line.slice(at + `[MEMORY] ${phase} `.length)) } catch { return null }
  }
  return null
}
function bootValues(text, field) {
  return text.split(/\r?\n/).filter(l => l.includes('[GATE-BOOT]') && l.includes('warmup=0'))
    .map(l => Number((l.match(new RegExp(`\\b${field}=(-?[\\d.]+)`)) || [])[1])).filter(Number.isFinite)
}

const bench = (key, field) => text => resultLines(text)[key]?.[field]
const METRICS = [
  { name: 'Boot: process → interactive', unit: 'ms', boot: 'interactive' },
  { name: 'Boot: window → first paint', unit: 'ms', boot: 'firstPaint' },
  { name: 'Mode switch Code → Thread', unit: 'ms', read: bench('mode switch: Code→Thread', 'median') },
  { name: 'Mode switch Thread → OxeQuery', unit: 'ms', read: bench('mode switch: Thread→OxeQuery', 'median') },
  { name: 'Mode switch OxeQuery → Code', unit: 'ms', read: bench('mode switch: OxeQuery→Code', 'median') },
  { name: 'Keystroke → paint, idle (5k-event Thread)', unit: 'ms', read: bench('thread 5k: keystroke→paint', 'median') },
  { name: 'Keystroke → paint, agent streaming', unit: 'ms', read: bench('thread 5k: keystroke→paint while streaming', 'median') },
  ...[['Files', 'Files'], ['Changes', 'Changes'], ['Commit & PR', 'Commit & pull request'], ['Find in files', 'Find in files'], ['Worktrees', 'Worktrees'], ['Browser', 'Browser']]
    .map(([name, label]) => ({ name: `Panel first open: ${name}`, unit: 'ms', read: bench(`panel open:  ${label}`, 'first') })),
  { name: 'MCP servers modal, first open', unit: 'ms', read: bench('modal open:  MCP servers', 'first') },
  { name: 'Command palette, first open', unit: 'ms', read: bench('shell: command menu open', 'first') },
  { name: 'Settings, first open', unit: 'ms', read: bench('modal open:  Agent Settings', 'first') },
  { name: 'OxeChat cold open: first content', unit: 'ms', read: text => perceivedRow(text, 'OxeChat (Thread)', 'cold')?.content },
  { name: 'OxeChat cold open: sidebar blank', unit: 'ms', read: text => perceivedRow(text, 'OxeChat (Thread)', 'cold')?.sidebarBlank },
  { name: 'Memory, 4 terminals (working set)', unit: 'MB', read: text => memoryLine(text, 'code only')?.workingSetTotalMb },
  { name: 'Memory, 4 terminals (private bytes)', unit: 'MB', read: text => { const v = memoryLine(text, 'code only')?.totalMb; return v > 0 ? v : undefined } },
  { name: 'Renderer entry chunk', unit: 'KB', entry: 'bytes' },
  { name: 'Renderer entry chunk (gzip)', unit: 'KB', entry: 'gzipBytes' }
]
const UNCOVERED = ['/resume and the context indicator on a big transcript: no spec measures them yet']

const roundsDir = join(dir, 'rounds')
const files = existsSync(roundsDir) ? readdirSync(roundsDir) : []
const rounds = [...new Set(files.map(f => Number((f.match(/-r(\d+)-/) || [])[1])).filter(Number.isFinite))].sort((a, b) => a - b)
const read = (side, round, kind) => { const f = join(roundsDir, `${side}-r${round}-${kind}.log`); return existsSync(f) ? readFileSync(f, 'utf8') : '' }
const entries = Object.fromEntries(sides.map(side => { const f = join(dir, `${side}-entry.json`); return [side, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null] }))

let seed = 42
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const fmt = (x, unit) => !Number.isFinite(x) ? 'n/a' : unit === 'KB' ? x.toFixed(2) : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)
const signed = (x, unit) => (Number.isFinite(x) && x > 0 ? '+' : '') + fmt(x, unit)

const rows = []
for (const metric of METRICS) {
  // values[side][round] = the round's value for that side
  const values = Object.fromEntries(sides.map(side => [side, {}]))
  for (const side of sides) {
    for (const round of rounds) {
      let v
      if (metric.boot) v = median(bootValues(read(side, round, 'boot'), metric.boot))
      else if (metric.entry) v = entries[side]?.[metric.entry] != null ? entries[side][metric.entry] / 1024 : NaN
      else { const t = read(side, round, 'bench'); v = t ? metric.read(t) : NaN }
      if (Number.isFinite(v)) values[side][round] = v
    }
  }
  const med = Object.fromEntries(sides.map(side => [side, median(Object.values(values[side]))]))
  const paired = rounds.filter(r => r in values[BASE] && r in values[CAND])
  const d = paired.map(r => values[CAND][r] - values[BASE][r])
  let lo = NaN, hi = NaN, delta = NaN, verdict = 'n/a'
  if (d.length >= 3) {
    const boots = []
    for (let k = 0; k < 5000; k++) boots.push(median(d.map(() => d[Math.floor(rand() * d.length)])))
    lo = quantile(boots, 0.025); hi = quantile(boots, 0.975); delta = median(d)
    verdict = lo > 0 ? '**REGRESSES**' : hi < 0 ? 'improves' : 'within noise'
  } else if (d.length) {
    delta = median(d); verdict = `n/a (${d.length} paired rounds)`
  }
  rows.push({ metric: metric.name, unit: metric.unit, medians: med, delta, ci: [lo, hi], paired: d.length, verdict, rounds: values })
}

const refName = side => heads.find(h => h.side === side)?.ref ?? side
const out = []
out.push(`### ${label}`, '')
out.push(`Refs: ${heads.map(h => `${h.side} = \`${h.ref}\` (${String(h.sha).slice(0, 9)})`).join(' · ')}. Rounds: ${rounds.length}, interleaved ${sides.join('')} ${[...sides].reverse().join('')}, packaged app, one runner.`, '')
out.push(`| Metric | ${sides.map(refName).join(' | ')} | Δ ${refName(CAND)} − ${refName(BASE)} (CI95) | Verdict |`)
out.push(`|---|${sides.map(() => '---:').join('|')}|---:|---|`)
for (const row of rows) {
  const ci = Number.isFinite(row.ci[0]) ? ` [${signed(row.ci[0], row.unit)}, ${signed(row.ci[1], row.unit)}]` : ''
  out.push(`| ${row.metric} (${row.unit}) | ${sides.map(side => fmt(row.medians[side], row.unit)).join(' | ')} | ${signed(row.delta, row.unit)}${ci} | ${row.verdict} |`)
}
const regress = rows.filter(r => r.verdict.includes('REGRESSES')).map(r => r.metric)
const improve = rows.filter(r => r.verdict === 'improves').map(r => r.metric)
const na = rows.filter(r => r.verdict.startsWith('n/a')).map(r => r.metric)
out.push('', `**${regress.length} regress** ${regress.length ? `(${regress.join('; ')}) ` : ''}· ${improve.length} improve · ${rows.length - regress.length - improve.length - na.length} within noise · ${na.length} n/a${na.length ? ` (${na.join('; ')})` : ''}.`)
out.push('', 'A metric regresses only if the 95% CI of (candidate − previous release) lies entirely above zero; it improves if entirely below. Medians are over the rounds; each round is one fresh run per ref (boot: the median of 3 launches after 1 warm-up; mode switch and keystrokes: the run\'s median; first open: the first open in a fresh launch).')
out.push('', `Uncovered: ${UNCOVERED.join('; ')}.`)
out.push('', '<details><summary>Per-round values</summary>', '')
for (const row of rows) out.push(`- ${row.metric}: ${sides.map(side => `${side} ${rounds.map(r => fmt(row.rounds[side][r], row.unit)).join(' ')}`).join(' · ')}`)
out.push('', '</details>')
console.log(out.join('\n'))
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ label, heads, rounds, rows }, null, 1))
