// Release gate table (OXE-105, .github/workflows/manual-ops.yml operation=perf-gate). Reads one OS's results folder:
//   heads.json                      [{ side: 'A', ref: 'v1.5.0', sha }, …], the sides in table order; B is the
//                                   baseline (the previous release), C the candidate
//   <side>-entry.json               the renderer entry chunk of that side's build ({ file, bytes, gzipBytes })
//   rounds/<side>-r<n>-boot.log     the boot probe's `[GATE-BOOT]` lines of round n (1 warm-up launch, then measured)
//   rounds/<side>-r<n>-bench.log    perf-benchmark, memory-footprint and perceived-perf output of round n
// Each metric has one value per side and round (a round's own median, its first open, …). Per metric the table shows
// each side's median over the rounds and Δ = C − B as the median of the paired round differences with a 95% bootstrap
// interval. Verdict: REGRESSES when the interval lies entirely above zero, IMPROVES when entirely below, else within
// noise. Fewer than 3 paired rounds: n/a.
// Boot metrics (OXE-163): with at least 5 rounds, each side's single worst round is dropped before its median and the
// interval, and the table and the JSON say which values were dropped. The method line names the launch order, the
// trim, the rounds and the CI run ids (GITHUB_RUN_ID, plus --run-ids a,b for runs measured elsewhere).
// Usage: node perf-gate/summarize.mjs <results folder> <label> [--json <out.json>] [--run-ids <id,id>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchOrder, median, methodLine, pairedDelta, seeded, trimWorst, trimmedNote } from './stats.mjs'

const [dir, label = ''] = process.argv.slice(2)
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null
const jsonOut = option('--json')
const runIds = [process.env.GITHUB_RUN_ID, ...String(option('--run-ids') ?? '').split(',')].map(id => (id ?? '').trim()).filter(Boolean)
const heads = JSON.parse(readFileSync(join(dir, 'heads.json'), 'utf8'))
const sides = heads.map(h => h.side)
const BASE = 'B'
const CAND = 'C'

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
  { name: 'Workspace: launch → grid (in-window)', unit: 'ms', read: bench('workspace: launch→grid (in-window)', 'first') },
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
  { name: '/resume: session list, cold (13 sessions, 320 MB)', unit: 'ms', read: bench('/resume: session list (cold)', 'first') },
  { name: '/resume: session list, main-process stall', unit: 'ms', read: bench('/resume: session list (cold), main stall', 'first') },
  { name: '/resume: session list, second open', unit: 'ms', read: bench('/resume: session list (again)', 'first') },
  { name: '/resume: second open, main-process stall', unit: 'ms', read: bench('/resume: session list (again), main stall', 'first') },
  { name: '/resume: import the 200 MB session', unit: 'ms', read: bench('/resume: import big session', 'first') },
  { name: '/resume: import, main-process stall', unit: 'ms', read: bench('/resume: import big session, main stall', 'first') },
  { name: '/resume: open the resumed conversation', unit: 'ms', read: bench('/resume: open resumed thread', 'first') },
  { name: 'Context indicator: first read (after /resume listed it)', unit: 'ms', read: bench('context indicator: first read', 'first') },
  { name: 'Context indicator: update after a turn', unit: 'ms', read: bench('context indicator: update', 'first') },
  { name: 'Context indicator: update, main-process stall', unit: 'ms', read: bench('context indicator: update, main stall', 'first') },
  { name: 'Context indicator: resumed conversation', unit: 'ms', read: bench('context indicator: resumed conversation', 'first') },
  { name: 'Memory, 4 terminals (working set)', unit: 'MB', read: text => memoryLine(text, 'code only')?.workingSetTotalMb },
  { name: 'Memory, 4 terminals (private bytes)', unit: 'MB', read: text => { const v = memoryLine(text, 'code only')?.totalMb; return v > 0 ? v : undefined } },
  { name: 'Renderer entry chunk', unit: 'KB', entry: 'bytes' },
  { name: 'Renderer entry chunk (gzip)', unit: 'KB', entry: 'gzipBytes' }
]
/** Rows printed under the table whatever their verdict (coordination, 14/11). */
const WATCH = ['Boot: process → interactive']

const roundsDir = join(dir, 'rounds')
const files = existsSync(roundsDir) ? readdirSync(roundsDir) : []
const rounds = [...new Set(files.map(f => Number((f.match(/-r(\d+)-/) || [])[1])).filter(Number.isFinite))].sort((a, b) => a - b)
const read = (side, round, kind) => { const f = join(roundsDir, `${side}-r${round}-${kind}.log`); return existsSync(f) ? readFileSync(f, 'utf8') : '' }
const entries = Object.fromEntries(sides.map(side => { const f = join(dir, `${side}-entry.json`); return [side, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null] }))

const rand = seeded(42)
const fmt = (x, unit) => !Number.isFinite(x) ? 'n/a' : unit === 'KB' ? x.toFixed(2) : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)
const signed = (x, unit) => (Number.isFinite(x) && x > 0 ? '+' : '') + fmt(x, unit)
const refName = side => heads.find(h => h.side === side)?.ref ?? side
const bootRounds = rounds.filter(round => sides.some(side => read(side, round, 'boot')))
const benchRounds = rounds.filter(round => sides.some(side => read(side, round, 'bench')))

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
  // Boot (OXE-163): each side's worst round is dropped before its median and before the paired interval.
  const trim = Boolean(metric.boot)
  const kept = Object.fromEntries(sides.map(side => [side, trim ? trimWorst(values[side]) : { kept: values[side], trimmed: [] }]))
  const med = Object.fromEntries(sides.map(side => [side, median(Object.values(kept[side].kept))]))
  const stats = pairedDelta(values[CAND], values[BASE], { trim, rand })
  const trimmed = Object.fromEntries(sides.map(side => [side, kept[side].trimmed]).filter(([, list]) => list.length))
  rows.push({ metric: metric.name, unit: metric.unit, medians: med, delta: stats.delta, ci: stats.ci, paired: stats.paired, verdict: stats.verdict, rounds: values, ...(trim ? { trimmed } : {}) })
}

const order = round => launchOrder(round, { candidate: CAND, base: BASE, others: sides }).join('')
const method = methodLine({ bootRounds: bootRounds.length, rounds: benchRounds.length, runIds })
const out = []
out.push(`### ${label}`, '')
out.push(`Refs: ${heads.map(h => `${h.side} = \`${h.ref}\` (${String(h.sha).slice(0, 9)})`).join(' · ')}. Rounds: ${bootRounds.length} boot, ${benchRounds.length} other; launch order ${order(1)} on odd rounds, ${order(2)} on even ones; packaged app, one runner.`, '')
out.push(method, '')
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
out.push('', 'A metric regresses only if the 95% CI of (candidate − previous release) lies entirely above zero; it improves if entirely below. Medians are over the rounds; each round is one fresh run per ref (boot: the median of 3 launches after 1 warm-up, with the worst round of each side dropped; mode switch and keystrokes: the run\'s median; first open: the first open in a fresh launch).')
out.push('', 'Trimmed boot rounds (worst round per side, dropped before the median and the CI95):')
for (const row of rows.filter(r => r.trimmed)) out.push(`- ${row.metric}: ${trimmedNote(row.trimmed, refName)}`)
for (const name of WATCH) {
  const row = rows.find(r => r.metric === name)
  if (row) out.push('', `Watch: ${name} ${signed(row.delta, row.unit)} ${row.unit}${Number.isFinite(row.ci[0]) ? ` [${signed(row.ci[0], row.unit)}, ${signed(row.ci[1], row.unit)}]` : ''} → ${row.verdict}.`)
}
out.push('', '<details><summary>Per-round values</summary>', '')
for (const row of rows) out.push(`- ${row.metric}: ${sides.map(side => `${side} ${rounds.map(r => fmt(row.rounds[side][r], row.unit)).join(' ')}`).join(' · ')}`)
out.push('', '</details>')
console.log(out.join('\n'))
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    label, heads, rounds,
    method: { name: 'alternating order + worst boot round dropped per side + N boot rounds', bootRounds: bootRounds.length, rounds: benchRounds.length, trimMax: 1, order: { odd: order(1), even: order(2) }, runIds, text: method },
    rows
  }, null, 1))
}
