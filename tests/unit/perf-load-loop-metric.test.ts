// OXE-386 CA-1: perf-load's main:loop is the performance journal's main:loop. Both read
// monitorEventLoopDelay({ resolution: 20 }), whose every sample includes the 20 ms tick of its own timer, and both
// report what is left after the tick, from one formula (shared/perfLoop.ts).
import { describe, expect, it } from 'vitest'
import { LOOP_RESOLUTION_MS, loopDelayMs, loopReadingMs } from '../../shared/perfLoop'

const { loopStat } = await import('../../electron/main/services/perf/perf-journal')
const ns = (ms: number) => ms * 1e6

describe('OXE-386 · main:loop measured one way', () => {
  it("perf-load reports main:loop with the recorder's resolution subtracted, like the performance journal", () => {
    expect(LOOP_RESOLUTION_MS).toBe(20)
    // An idle Node process: the histogram sits at its own tick (the 21.12–21.15 ms of the T6 spike).
    expect(loopDelayMs(ns(21.15))).toBeCloseTo(1.15, 5)
    // Never below 0, even when a sample lands just under the tick.
    expect(loopDelayMs(ns(19.4))).toBe(0)
    expect(loopDelayMs(0)).toBe(0)
    // Another resolution is subtracted as given.
    expect(loopDelayMs(ns(12), 10)).toBeCloseTo(2, 5)

    // perf-load's reading of a loaded round: each percentile and the max lose the tick.
    const raw = { p50: ns(21.1), p95: ns(41.5), max: ns(120) }
    const reading = loopReadingMs(raw)
    expect(reading.p50).toBeCloseTo(1.1, 5)
    expect(reading.p95).toBeCloseTo(21.5, 5)
    expect(reading.max).toBeCloseTo(100, 5)

    // The journal turns the same histogram into the same delay: its max is perf-load's max.
    const stat = loopStat({ count: 100, mean: ns(25), max: raw.max, percentiles: new Map([[0, ns(20)], [50, raw.p50], [95, raw.p95], [100, raw.max]]) })!
    expect(stat.max).toBeCloseTo(reading.max, 5)
    expect(stat.sum / stat.n).toBeCloseTo(loopDelayMs(ns(25)), 5)
  })
})
