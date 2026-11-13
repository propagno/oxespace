import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks'

/**
 * The performance journal (1.5.1): how long the app made the person wait, measured on this computer while they work,
 * to find what 1.5.2 should make faster. It keeps durations and names only, never content:
 *  - `ipc:<channel>`: a window request to the main process, from the call to its answer (channel names are the app's
 *    own constants, never an argument);
 *  - `main:loop`: the main process's event-loop delay, every 20 ms tick of `monitorEventLoopDelay`;
 *  - `renderer:frame:<view>` and `renderer:block:<view>`: animation frames over 50 ms and the part of them that
 *    blocked input, per view (code, thread, data, settings, and `:dialog` while one is open);
 *  - `renderer:input:<event>:<view>`: from an input (click, keydown…) to the next painted frame, 16 ms and over.
 * Samples go into fixed buckets; one line per five-minute window is written next to the runtime log, bounded like it
 * (three files of 512 KiB, seven days). Nothing is sent anywhere: the person exports it with the diagnostics bundle.
 */
export const PERF_BUCKETS_MS = [16, 33, 50, 100, 200, 500, 1000, 2000] as const
const SLOTS = PERF_BUCKETS_MS.length + 1
const WINDOW_MS = 5 * 60_000
const FILE_BYTES = 512 * 1024
const RETENTION_MS = 7 * 86400_000
/** Keys whose slowest sample stayed under one frame are counted in `ipc:all` only, to keep each line small. */
const WRITE_FLOOR_MS = 16
const MAX_KEYS = 400
const IPC_KEY = /^ipc:[a-z0-9][a-z0-9:._-]{0,79}$/i
const VIEW = '(?:code|thread|data|settings)(?::dialog)?'
const RENDERER_KEY = new RegExp(`^(?:frame|block|input:[a-z]{1,16}):${VIEW}$`)

export interface PerfStat { n: number; sum: number; max: number; b: number[] }

export function emptyStat(): PerfStat { return { n: 0, sum: 0, max: 0, b: new Array(SLOTS).fill(0) } }

export function addSample(stat: PerfStat, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return
  stat.n++; stat.sum += ms; if (ms > stat.max) stat.max = ms
  let slot = PERF_BUCKETS_MS.findIndex(bound => ms < bound)
  if (slot < 0) slot = PERF_BUCKETS_MS.length
  stat.b[slot]++
}

export function mergeStat(into: PerfStat, from: PerfStat): void {
  into.n += from.n; into.sum += from.sum; into.max = Math.max(into.max, from.max)
  for (let i = 0; i < SLOTS; i++) into.b[i] += from.b[i] ?? 0
}

/** The bucket bound under which a share `q` of the samples fell (the maximum for the last, open bucket). */
export function quantile(stat: PerfStat, q: number): number {
  if (!stat.n) return 0
  const target = Math.ceil(stat.n * q)
  let seen = 0
  for (let i = 0; i < SLOTS; i++) {
    seen += stat.b[i]
    if (seen >= target) return i < PERF_BUCKETS_MS.length ? Math.min(PERF_BUCKETS_MS[i], Math.ceil(stat.max)) : Math.ceil(stat.max)
  }
  return Math.ceil(stat.max)
}

/** A stat sent by the window: whole counts that add up, finite non-negative times. Anything else is dropped. */
function validStat(value: unknown): PerfStat | null {
  if (!value || typeof value !== 'object') return null
  const { n, sum, max, b } = value as Partial<PerfStat>
  if (!Number.isSafeInteger(n) || n! < 1 || n! > 1_000_000) return null
  if (typeof sum !== 'number' || typeof max !== 'number' || !Number.isFinite(sum) || !Number.isFinite(max) || sum < 0 || max < 0 || max > 600_000 || sum > 600_000 * n!) return null
  if (!Array.isArray(b) || b.length !== SLOTS || !b.every(count => Number.isSafeInteger(count) && count >= 0)) return null
  if (b.reduce((total, count) => total + count, 0) !== n) return null
  return { n: n!, sum, max, b: [...b] }
}

interface Line { at: number; run: string; from: number; stats: Record<string, PerfStat> }

export class PerfJournal {
  private stats = new Map<string, PerfStat>()
  private windowStart: number
  private readonly run = randomUUID().slice(0, 8)
  private disabled = false

  constructor(private readonly directory: string, private readonly now = Date.now, private readonly fileBytes = FILE_BYTES,
    /** The main process's event-loop delay since the last window, read when a window is written. */
    private readonly loop: () => PerfStat | null = () => null) {
    this.windowStart = now()
    try { mkdirSync(directory, { recursive: true, mode: 0o700 }); this.prune() } catch { this.disabled = true }
  }

  private path(index: number): string { return join(this.directory, `performance.${index}.jsonl`) }

  add(key: string, ms: number): void {
    if (this.disabled) return
    if (this.now() - this.windowStart >= WINDOW_MS) this.flush()
    let stat = this.stats.get(key)
    if (!stat) {
      if (this.stats.size >= MAX_KEYS) return
      stat = emptyStat(); this.stats.set(key, stat)
    }
    addSample(stat, ms)
  }

  /** One IPC request answered: per channel, and in the `ipc:all` total. */
  ipc(channel: string, ms: number): void {
    const key = `ipc:${channel}`
    if (!IPC_KEY.test(key)) return
    this.add('ipc:all', ms)
    this.add(key, ms)
  }

  /** What the window measured since its last report: `{ stats: { 'frame:code': PerfStat, … } }`. Returns the keys kept. */
  addBatch(input: unknown): number {
    if (this.disabled || !input || typeof input !== 'object') return 0
    const entries = Object.entries((input as { stats?: unknown }).stats ?? {})
    if (entries.length > 64) return 0
    let kept = 0
    for (const [name, value] of entries) {
      const stat = RENDERER_KEY.test(name) ? validStat(value) : null
      if (!stat) continue
      const key = `renderer:${name}`
      const existing = this.stats.get(key)
      if (existing) mergeStat(existing, stat)
      else if (this.stats.size < MAX_KEYS) this.stats.set(key, stat)
      else continue
      kept++
    }
    return kept
  }

  flush(): void {
    const loop = (() => { try { return this.loop() } catch { return null } })()
    if (loop) this.stats.set('main:loop', loop)
    const stats: Record<string, PerfStat> = {}
    for (const [key, stat] of this.stats) {
      if (key.startsWith('ipc:') && key !== 'ipc:all' && stat.max < WRITE_FLOOR_MS) continue
      stats[key] = { n: stat.n, sum: Math.round(stat.sum), max: Math.round(stat.max), b: stat.b }
    }
    const from = this.windowStart
    this.stats.clear(); this.windowStart = this.now()
    if (!Object.keys(stats).length) return
    this.write({ at: this.now(), run: this.run, from, stats })
    try { this.prune() } catch { this.disabled = true }
  }

  private prune(): void {
    for (let i = 0; i < 3; i++) if (existsSync(this.path(i))) {
      const stat = statSync(this.path(i))
      if (stat.size > this.fileBytes || this.now() - stat.mtimeMs > RETENTION_MS) { rmSync(this.path(i)); continue }
      const original = readFileSync(this.path(i), 'utf8')
      const retained = original.split('\n').filter(line => {
        try { return Number(JSON.parse(line).at) >= this.now() - RETENTION_MS } catch { return false }
      }).join('\n')
      if (!retained) rmSync(this.path(i))
      else if (retained + '\n' !== original) writeFileSync(this.path(i), retained + '\n', { mode: 0o600 })
    }
  }

  private write(value: Line): void {
    if (this.disabled) return
    try {
      const line = JSON.stringify(value) + '\n'
      if ((existsSync(this.path(0)) ? statSync(this.path(0)).size : 0) + Buffer.byteLength(line) > this.fileBytes) {
        rmSync(this.path(2), { force: true })
        if (existsSync(this.path(1))) renameSync(this.path(1), this.path(2))
        if (existsSync(this.path(0))) renameSync(this.path(0), this.path(1))
      }
      appendFileSync(this.path(0), line, { mode: 0o600 })
    } catch { this.disabled = true } // a full disk must never fail the request being measured
  }

  /** Every written line, oldest first, after writing the current window. */
  export(): string {
    this.flush()
    try { return [2, 1, 0].filter(i => existsSync(this.path(i))).map(i => readFileSync(this.path(i), 'utf8')).join('') } catch { return '' }
  }

  /** The whole journal as a table, slowest first: what the person waited on most. */
  summary(): string { return summarize(this.export(), this.now()) }

  get available(): boolean { return !this.disabled }
}

/** Adds up the journal's lines into one table, ordered by p95 then by the time spent over one frame. */
export function summarize(lines: string, now = Date.now()): string {
  const totals = new Map<string, PerfStat>()
  let first = Infinity, last = 0, windows = 0
  for (const line of lines.split('\n')) {
    let parsed: Line
    try { parsed = JSON.parse(line) } catch { continue }
    if (!parsed || typeof parsed.stats !== 'object' || !Number.isFinite(parsed.at)) continue
    windows++; first = Math.min(first, Number(parsed.from) || parsed.at); last = Math.max(last, parsed.at)
    for (const [key, value] of Object.entries(parsed.stats)) {
      const stat = validStat(value)
      if (!stat) continue
      const total = totals.get(key) ?? emptyStat()
      mergeStat(total, stat); totals.set(key, total)
    }
  }
  const header = '# OXESpace performance journal\n\nLocal only: durations and names, never content. Times in ms; p50 and p95 are bucket bounds (16, 33, 50, 100, 200, 500, 1000, 2000).'
  if (!windows) return `${header}\n\n(no measurements yet)\n`
  const slow = (stat: PerfStat) => stat.b.slice(1).reduce((sum, count) => sum + count, 0)
  const rows = [...totals].sort(([, a], [, b]) => quantile(b, 0.95) - quantile(a, 0.95) || slow(b) - slow(a))
  const pad = (text: string | number, width: number) => String(text).padStart(width)
  const table = rows.slice(0, 60).map(([key, stat]) =>
    `${key.padEnd(56).slice(0, 56)} ${pad(stat.n, 8)} ${pad(quantile(stat, 0.5), 6)} ${pad(quantile(stat, 0.95), 6)} ${pad(Math.round(stat.max), 7)} ${pad(slow(stat), 7)}`)
  const days = ((last - first) / 86400_000).toFixed(1)
  return [
    header,
    '',
    `${windows} windows from ${new Date(first).toISOString()} to ${new Date(last).toISOString()} (${days} days; written ${new Date(now).toISOString()}).`,
    '',
    '```text',
    `${'key'.padEnd(56)} ${pad('n', 8)} ${pad('p50', 6)} ${pad('p95', 6)} ${pad('max', 7)} ${pad('≥16ms', 7)}`,
    ...table,
    '```',
    ''
  ].join('\n')
}

const LOOP_RESOLUTION_MS = 20

/**
 * The event-loop delay histogram as a stat: one sample per tick of its timer, less the tick itself (the histogram
 * records the whole interval between ticks), so what is left is time the loop could not run. Bucket counts come from
 * the histogram's percentiles, so they are as fine as its own resolution.
 */
export function loopStat(histogram: Pick<IntervalHistogram, 'count' | 'mean' | 'max' | 'percentiles'>, resolutionMs = LOOP_RESOLUTION_MS): PerfStat | null {
  const n = Number(histogram.count)
  if (!Number.isSafeInteger(n) || n < 1) return null
  const delay = (ns: number) => Math.max(0, ns / 1e6 - resolutionMs)
  const points = [...histogram.percentiles].map(([percentile, ns]) => [percentile / 100, delay(ns)] as const).sort((a, b) => a[0] - b[0])
  const below = (bound: number) => points.reduce((share, [percentile, ms]) => ms < bound ? Math.max(share, percentile) : share, 0)
  const stat = emptyStat()
  let counted = 0
  PERF_BUCKETS_MS.forEach((bound, index) => {
    const upTo = Math.min(n, Math.round(n * below(bound)))
    stat.b[index] = Math.max(0, upTo - counted); counted = Math.max(counted, upTo)
  })
  stat.b[PERF_BUCKETS_MS.length] = n - counted
  stat.n = n; stat.max = delay(histogram.max); stat.sum = Math.min(delay(histogram.mean), stat.max) * n
  return stat
}

let journal: PerfJournal | undefined
let loop: IntervalHistogram | undefined

/**
 * Starts the journal once; `onIpc` is handed the measuring function (the IPC sender guard's hook). It holds no timer:
 * a window is written by the first measurement after its five minutes (the window reports every 30 seconds) and on
 * quit, and the event-loop histogram is read when a window is written.
 */
export function startPerfJournal(directory: string, onIpc?: (measure: ((channel: string, ms: number) => void) | null) => void): PerfJournal {
  if (journal) return journal
  let histogram: IntervalHistogram | undefined
  try { histogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS }); histogram.enable(); loop = histogram } catch { /* requests and frames are still measured */ }
  journal = new PerfJournal(directory, Date.now, FILE_BYTES, () => {
    if (!histogram) return null
    const stat = loopStat(histogram)
    histogram.reset()
    return stat
  })
  const current = journal
  onIpc?.((channel, ms) => current.ipc(channel, ms))
  return journal
}

export function stopPerfJournal(): void {
  journal?.flush()
  loop?.disable(); loop = undefined
}

export function perfJournal(): PerfJournal | undefined { return journal }
