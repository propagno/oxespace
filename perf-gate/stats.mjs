// The perf-gate's statistical method (OXE-163, 1.5.3 onwards), pure and testable (tests/unit/perf-gate-stats.test.ts).
// Used by .github/workflows/perf-gate.yml (launch order of each round) and perf-gate/summarize.mjs (the table).
// Why: on 1.5.2 (OXE-105) the Windows `process → interactive` moved ±40-75 ms between runs of the same tree, and one
// round of the bisect 43644280439 ran 170-290 ms slower on one side (a runner background task). So, for boot:
//  - the candidate and the baseline swap who launches first every round (candidate first on odd rounds, baseline first
//    on even ones), so warm-up and position noise do not pile up on one side;
//  - more rounds (BOOT_ROUNDS, default 9, at least 5) of the light boot probe only, not of the whole suite;
//  - the single worst (highest) round of each side is dropped before the median and the 95% interval, and the summary
//    says which values were dropped.
// The method changes only between releases, never hours before a gate (RN-1); every table states it with the run ids.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BOOT_ROUNDS_DEFAULT = 9
export const BOOT_ROUNDS_MIN = 5
export const BOOT_ROUNDS_MAX = 15
/** Worst rounds dropped per side on boot metrics. */
export const TRIM_MAX = 1
/** Fewest rounds a side needs before its worst one is dropped. */
export const TRIM_MIN_ROUNDS = 5

/** @param {number[]} xs */
export const median = xs => {
  const s = [...xs].sort((a, b) => a - b)
  const n = s.length
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN
}

/** @param {number[]} xs @param {number} q */
export const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return NaN
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo)
}

/**
 * The boot rounds asked for, or the default; outside BOOT_ROUNDS_MIN..BOOT_ROUNDS_MAX (or not a whole number) is an error.
 * @param {string | number | undefined | null} value
 * @returns {number}
 */
export function bootRounds(value) {
  if (value === undefined || value === null || value === '') return BOOT_ROUNDS_DEFAULT
  const text = String(value).trim()
  const n = Number(text)
  if (!/^\d+$/.test(text) || n < BOOT_ROUNDS_MIN || n > BOOT_ROUNDS_MAX) throw new RangeError(`boot rounds must be ${BOOT_ROUNDS_MIN}-${BOOT_ROUNDS_MAX}, got ${text}`)
  return n
}

/**
 * Who launches first in a round (1-based): the candidate on odd rounds, the baseline on even ones, every other side after
 * them in the order given. `round % 2 === 1 ? [candidate, base] : [base, candidate]`.
 * @param {number} round
 * @param {{ candidate: string, base: string, others?: string[] }} sides
 * @returns {string[]}
 */
export function launchOrder(round, { candidate, base, others = [] }) {
  if (!Number.isInteger(round) || round < 1) throw new RangeError(`round must be a whole number from 1, got ${round}`)
  const pair = round % 2 === 1 ? [candidate, base] : [base, candidate]
  return [...pair, ...others.filter(side => side !== candidate && side !== base)]
}

/**
 * Drops the `trim` worst (highest) rounds of one side. Ties drop the latest round, so the result does not depend on key
 * order. A side with fewer than `minRounds` rounds is kept whole.
 * @param {Record<string | number, number>} values round → value
 * @param {{ trim?: number, minRounds?: number }} [options]
 * @returns {{ kept: Record<number, number>, trimmed: Array<{ round: number, value: number }> }}
 */
export function trimWorst(values, { trim = TRIM_MAX, minRounds = TRIM_MIN_ROUNDS } = {}) {
  const entries = Object.entries(values).map(([round, value]) => ({ round: Number(round), value })).filter(entry => Number.isFinite(entry.value))
  if (entries.length < minRounds || trim <= 0) return { kept: Object.fromEntries(entries.map(e => [e.round, e.value])), trimmed: [] }
  const worst = [...entries].sort((a, b) => b.value - a.value || b.round - a.round).slice(0, trim)
  const dropped = new Set(worst.map(e => e.round))
  return {
    kept: Object.fromEntries(entries.filter(e => !dropped.has(e.round)).map(e => [e.round, e.value])),
    trimmed: worst.sort((a, b) => a.round - b.round)
  }
}

/** Deterministic generator for the bootstrap, so the same samples always print the same table. */
export function seeded(seed = 42) {
  let state = seed
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
}

/**
 * Δ = candidate − base as the median of the paired round differences, with a 95% bootstrap interval and a verdict:
 * REGRESSES when the interval lies entirely above zero, improves when entirely below, else within noise. With `trim`,
 * each side's worst round is dropped first (only rounds both sides kept are paired), and the dropped values are returned.
 * @param {Record<number, number>} candidate round → value
 * @param {Record<number, number>} base round → value
 * @param {{ trim?: boolean, iterations?: number, rand?: () => number }} [options]
 */
export function pairedDelta(candidate, base, { trim = false, iterations = 5000, rand = seeded() } = {}) {
  const cand = trim ? trimWorst(candidate) : { kept: candidate, trimmed: [] }
  const ref = trim ? trimWorst(base) : { kept: base, trimmed: [] }
  const rounds = Object.keys(cand.kept).map(Number).filter(round => round in ref.kept).sort((a, b) => a - b)
  const d = rounds.map(round => cand.kept[round] - ref.kept[round])
  let lo = NaN, hi = NaN, delta = NaN, verdict = 'n/a'
  if (d.length >= 3) {
    const boots = []
    for (let k = 0; k < iterations; k++) boots.push(median(d.map(() => d[Math.floor(rand() * d.length)])))
    lo = quantile(boots, 0.025); hi = quantile(boots, 0.975); delta = median(d)
    verdict = lo > 0 ? '**REGRESSES**' : hi < 0 ? 'improves' : 'within noise'
  } else if (d.length) {
    delta = median(d); verdict = `n/a (${d.length} paired rounds)`
  }
  return { delta, ci: [lo, hi], paired: d.length, pairedRounds: rounds, verdict, trimmed: { candidate: cand.trimmed, base: ref.trimmed }, kept: { candidate: cand.kept, base: ref.kept } }
}

/**
 * The method line every table carries (RN-1): launch order, trim and rounds, and the CI run ids compared.
 * @param {{ bootRounds: number, rounds: number, runIds?: string[] }} input
 */
export function methodLine({ bootRounds: boot, rounds, runIds = [] }) {
  const ids = runIds.filter(Boolean)
  return `Method (OXE-163): alternating order (candidate first on odd rounds, baseline first on even) + worst boot round dropped per side before the CI95 + N=${boot} boot rounds (${rounds} rounds for the other metrics).${ids.length ? ` CI runs: ${ids.join(', ')}.` : ''}`
}

/**
 * The trimmed boot values of one row, as the table prints them: `C r3 412.0 · B r5 398.0`.
 * @param {Record<string, Array<{ round: number, value: number }>>} trimmed side → dropped rounds
 * @param {(side: string) => string} [name]
 */
export function trimmedNote(trimmed, name = side => side) {
  const parts = Object.entries(trimmed).flatMap(([side, list]) => list.map(entry => `${name(side)} r${entry.round} ${entry.value.toFixed(1)}`))
  return parts.length ? parts.join(' · ') : 'none'
}

// `node perf-gate/stats.mjs order <round> <candidate> <base> [others…]` prints the launch order for the workflow;
// `node perf-gate/stats.mjs boot-rounds <value>` validates the input and prints it.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2)
  try {
    if (command === 'order') {
      const [round, candidate, base, ...others] = args
      console.log(launchOrder(Number(round), { candidate, base, others }).join(' '))
    } else if (command === 'boot-rounds') {
      console.log(bootRounds(args[0]))
    } else {
      console.error('usage: node perf-gate/stats.mjs order <round> <candidate> <base> [others…] | boot-rounds <value>')
      process.exit(2)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
