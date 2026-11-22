/**
 * OXE-386 · The main process's event-loop delay, measured one way everywhere: the performance journal (`loopStat`)
 * and the perf-load E2E both read `monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS })`. Each sample of that
 * histogram is the whole interval between two ticks of its timer, so an idle loop reads about the resolution itself
 * (~21 ms at 20). The delay is what is left after the tick: the time the loop could not run. Pure, no Node imports, so
 * the main process and the E2E spec share it.
 */

/** The recorder's timer resolution, in ms. The same value is used to start the histogram and to read it. */
export const LOOP_RESOLUTION_MS = 20

/** A histogram reading in nanoseconds, as the delay beyond the recorder's tick in ms, never below 0. */
export function loopDelayMs(ns: number, resolutionMs: number = LOOP_RESOLUTION_MS): number {
  return Math.max(0, ns / 1e6 - resolutionMs)
}

/** The raw percentiles a recorder reports, in nanoseconds (`histogram.percentile(n)`, `histogram.max`). */
export interface LoopRawNs { p50: number; p95: number; max: number }

/** What perf-load reports as `main:loop`: each raw reading as the delay beyond the tick, in ms (OXE-386). */
export function loopReadingMs(raw: LoopRawNs, resolutionMs: number = LOOP_RESOLUTION_MS): { p50: number; p95: number; max: number } {
  return { p50: loopDelayMs(raw.p50, resolutionMs), p95: loopDelayMs(raw.p95, resolutionMs), max: loopDelayMs(raw.max, resolutionMs) }
}
