// @vitest-environment node
/**
 * The performance journal (1.5.1): buckets and their quantiles, which names it keeps from the window, what a window of
 * five minutes writes, the bounded files, the summary's order, and the IPC sender guard's timing hook.
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: {}, app: { on: vi.fn(), once: vi.fn() } }))
vi.mock('../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident: vi.fn() }))

const { PerfJournal, addSample, emptyStat, quantile, summarize, PERF_BUCKETS_MS } = await import('../../electron/main/services/perf/perf-journal')
const { installIpcSenderGuard, measureIpcWith, trustAppWindow } = await import('../../electron/main/ipc/ipc-sender-guard')

const stat = (...samples: number[]) => { const value = emptyStat(); for (const ms of samples) addSample(value, ms); return value }

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'oxe-perf-journal-')) })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

describe('buckets', () => {
  it('counts each sample under the first bound it is below, and the slowest in the open bucket', () => {
    const value = stat(0, 15.9, 16, 49, 120, 2500)
    expect(value.n).toBe(6)
    expect(value.max).toBe(2500)
    expect(value.b).toEqual([2, 1, 1, 0, 1, 0, 0, 0, 1])
    expect(value.b).toHaveLength(PERF_BUCKETS_MS.length + 1)
  })

  it('reads p50 and p95 as bucket bounds, never above the slowest sample', () => {
    const value = stat(...Array(19).fill(10), 140)
    expect(quantile(value, 0.5)).toBe(16)
    expect(quantile(value, 0.95)).toBe(16)
    expect(quantile(value, 1)).toBe(140)
    expect(quantile(stat(3), 0.95)).toBe(3)
    expect(quantile(emptyStat(), 0.95)).toBe(0)
  })

  it('ignores times that are not durations', () => {
    const value = stat(Number.NaN, -1, Number.POSITIVE_INFINITY)
    expect(value.n).toBe(0)
  })
})

describe('journal', () => {
  it('writes one line per window: slow channels by name, fast ones only in the total', () => {
    let now = 1_000_000
    const journal = new PerfJournal(directory, () => now)
    journal.ipc('terminal:create', 420)
    journal.ipc('settings:get', 2)
    journal.ipc('not a channel/with path', 900)
    journal.add('main:loop', 0)
    now += 5 * 60_000
    journal.ipc('git:status', 5) // starts the next window, after writing the first
    const [line] = readFileSync(join(directory, 'performance.0.jsonl'), 'utf8').trim().split('\n').map(text => JSON.parse(text))
    expect(Object.keys(line.stats).sort()).toEqual(['ipc:all', 'ipc:terminal:create', 'main:loop'])
    expect(line.stats['ipc:all'].n).toBe(2)
    expect(line.stats['ipc:terminal:create']).toMatchObject({ n: 1, max: 420 })
    expect(line.from).toBe(1_000_000)
    expect(JSON.stringify(line)).not.toContain('path')
  })

  it('keeps from the window only known names with counts that add up', () => {
    const journal = new PerfJournal(directory)
    const good = stat(60, 80)
    expect(journal.addBatch({ stats: {
      'frame:code': good,
      'block:thread:dialog': stat(20),
      'input:click:settings': stat(40),
      'frame:/home/user/secret': good,
      'input:click:code:extra': good,
      'frame:data': { ...good, n: 3 },
      'frame:thread': { ...good, b: [1, 1] },
      'input:keydown:code': { ...good, max: Number.NaN }
    } })).toBe(3)
    expect(journal.addBatch(null)).toBe(0)
    expect(journal.addBatch({ stats: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`frame:code${i}`, good])) })).toBe(0)
    const lines = journal.export()
    expect(Object.keys(JSON.parse(lines.trim()).stats).sort()).toEqual(['renderer:block:thread:dialog', 'renderer:frame:code', 'renderer:input:click:settings'])
  })

  it('rotates past the file cap and drops lines older than seven days', () => {
    let now = Date.now()
    const journal = new PerfJournal(directory, () => now, 400)
    for (let i = 0; i < 6; i++) { journal.ipc('terminal:create', 100 + i); journal.flush() }
    expect(existsSync(join(directory, 'performance.1.jsonl'))).toBe(true)
    expect(statSync(join(directory, 'performance.0.jsonl')).size).toBeLessThanOrEqual(400)
    writeFileSync(join(directory, 'performance.2.jsonl'), JSON.stringify({ at: now - 8 * 86400_000, run: 'x', from: 0, stats: { 'ipc:all': stat(1) } }) + '\n')
    now += 1
    new PerfJournal(directory, () => now, 400)
    expect(existsSync(join(directory, 'performance.2.jsonl'))).toBe(false)
  })

  it('summarizes the slowest first, with p50, p95, max and samples over a frame', () => {
    const lines = [
      { at: 2, run: 'a', from: 1, stats: { 'ipc:terminal:create': stat(400, 430), 'ipc:all': stat(1, 2, 400, 430), 'renderer:frame:code': stat(60) } },
      { at: 3, run: 'a', from: 2, stats: { 'ipc:terminal:create': stat(450), 'broken': { n: 1 } } }
    ].map(line => JSON.stringify(line)).join('\n') + '\nnot json\n'
    const text = summarize(lines, 10)
    const rows = text.split('\n').filter(row => /^(ipc|renderer|main):/.test(row))
    expect(rows.map(row => row.split(/\s+/)[0])).toEqual(['ipc:terminal:create', 'ipc:all', 'renderer:frame:code'])
    expect(rows[0].split(/\s+/).slice(1)).toEqual(['3', '450', '450', '450', '3'])
    expect(text).toContain('2 windows')
    expect(text).not.toContain('broken')
    expect(summarize('', 10)).toContain('(no measurements yet)')
  })
})

describe('IPC sender guard timing', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  class Target extends EventEmitter {
    readonly handlers = new Map<string, Handler>()
    handle(channel: string, handler: Handler): void { this.handlers.set(channel, handler) }
  }
  const sender = Object.assign(new EventEmitter(), { mainFrame: { name: 'main' } })
  trustAppWindow({ webContents: sender as never })
  const event = { sender, senderFrame: sender.mainFrame }
  afterEach(() => { measureIpcWith(null) })

  it('reports each answered request by channel, sync, async and failed, and returns the answer untouched', async () => {
    const target = new Target()
    installIpcSenderGuard(target, null)
    target.handle('a:sync', () => 1)
    target.handle('a:async', async () => { await new Promise(resolve => setTimeout(resolve, 20)); return 2 })
    target.handle('a:fails', async () => { throw new Error('no') })
    const seen: Array<[string, number]> = []
    measureIpcWith((channel, ms) => seen.push([channel, ms]))
    expect(target.handlers.get('a:sync')!(event)).toBe(1)
    await expect(target.handlers.get('a:async')!(event)).resolves.toBe(2)
    await expect(target.handlers.get('a:fails')!(event)).rejects.toThrow('no')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen.map(([channel]) => channel)).toEqual(['a:sync', 'a:async', 'a:fails'])
    expect(seen[1][1]).toBeGreaterThanOrEqual(15)
  })

  it('measures nothing without the journal, and a failing measure never fails the request', () => {
    const target = new Target()
    installIpcSenderGuard(target, null)
    target.handle('b:sync', () => 'ok')
    expect(target.handlers.get('b:sync')!(event)).toBe('ok')
    measureIpcWith(() => { throw new Error('disk full') })
    expect(target.handlers.get('b:sync')!(event)).toBe('ok')
  })
})
