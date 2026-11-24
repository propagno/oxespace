// OXE-163: the perf-gate's boot method (perf-gate/stats.mjs, perf-gate/summarize.mjs, .github/workflows/perf-gate.yml).
// CA-1: strict alternation of who launches first; CA-2: the single worst boot round per side is dropped before the CI95
// and the summary says which values; CA-3's wiring (the run itself is the workflow's): N=9 boot rounds, the order from
// the tested module and the method plus run id in the table.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BOOT_ROUNDS_DEFAULT, BOOT_ROUNDS_MIN, bootRounds, launchOrder, median, methodLine, pairedDelta, trimWorst, trimmedNote
} from '../../perf-gate/stats.mjs'

const ROOT = process.cwd()
const SIDES = { candidate: 'C', base: 'B', others: ['A'] }

describe('OXE-163 · perf-gate boot method', () => {
  it('alternates launch order between candidate and base across all paired boot rounds', () => {
    const rounds = Array.from({ length: BOOT_ROUNDS_DEFAULT }, (_, index) => index + 1)
    expect(rounds).toHaveLength(9)
    const orders = rounds.map(round => launchOrder(round, SIDES))
    for (const [index, order] of orders.entries()) {
      const round = index + 1
      // Candidate first on odd rounds, baseline first on even ones; every side launches exactly once per round.
      expect(order.slice(0, 2)).toEqual(round % 2 === 1 ? ['C', 'B'] : ['B', 'C'])
      expect([...order].sort()).toEqual(['A', 'B', 'C'])
    }
    // Strict alternation: no two consecutive rounds open with the same side, and each opens half of the pairs.
    for (let index = 1; index < orders.length; index++) expect(orders[index][0]).not.toBe(orders[index - 1][0])
    expect(orders.filter(order => order[0] === 'C')).toHaveLength(5)
    expect(orders.filter(order => order[0] === 'B')).toHaveLength(4)
    // Over every pair of rounds, each side is first once and second once: no position bias accumulates.
    for (let round = 1; round < 9; round += 2) {
      const [odd, even] = [launchOrder(round, SIDES), launchOrder(round + 1, SIDES)]
      expect(odd.indexOf('C') + even.indexOf('C')).toBe(odd.indexOf('B') + even.indexOf('B'))
    }
    // A side named twice is not launched twice, and a bad round is refused.
    expect(launchOrder(2, { candidate: 'C', base: 'B', others: ['A', 'B', 'C'] })).toEqual(['B', 'C', 'A'])
    expect(() => launchOrder(0, SIDES)).toThrow(RangeError)
    expect(() => launchOrder(1.5, SIDES)).toThrow(RangeError)

    // The workflow takes its order from the same module (the CLI the job calls).
    const cli = (round: number): string => execFileSync(process.execPath, [join(ROOT, 'perf-gate/stats.mjs'), 'order', String(round), 'C', 'B', 'A'], { encoding: 'utf8' }).trim()
    expect(cli(1)).toBe('C B A')
    expect(cli(2)).toBe('B C A')
    expect(cli(9)).toBe('C B A')

    // Boot rounds: 9 by default, at least 5.
    expect(bootRounds(undefined)).toBe(9)
    expect(bootRounds('9')).toBe(9)
    expect(bootRounds(BOOT_ROUNDS_MIN)).toBe(5)
    expect(() => bootRounds('4')).toThrow(RangeError)
    expect(() => bootRounds('16')).toThrow(RangeError)
    expect(() => bootRounds('nine')).toThrow(RangeError)

    // CA-3 wiring: the job defaults to 9 boot rounds (5-15), asks stats.mjs for each round's order, runs only the boot
    // probe past `rounds`, and the table names the method and the CI run.
    const yml = readFileSync(join(ROOT, '.github/workflows/perf-gate.yml'), 'utf8')
    const workflow = load(yml) as { on: { workflow_dispatch: { inputs: Record<string, { default: string }> } }; jobs: { gate: { env: Record<string, string> } } }
    expect(workflow.on.workflow_dispatch.inputs.boot_rounds.default).toBe('9')
    expect(workflow.jobs.gate.env.BOOT_ROUNDS).toBe("${{ inputs.boot_rounds || '9' }}")
    expect(yml).toContain('BOOT_ROUNDS < 5 || BOOT_ROUNDS > 15')
    expect(yml).toContain('node harness/perf-gate/stats.mjs order "$r" C B A')
    expect(yml).toContain('if (( round <= BOOT_ROUNDS )); then run perf-gate-boot.spec.ts')
    expect(yml).toContain('if (( round <= ROUNDS )); then run perf-benchmark.spec.ts')
    expect(yml).not.toMatch(/order="A B C"/)
    expect(yml).toMatch(/Method: alternating order .*worst boot round dropped per side before the CI95 \+ N=\$\{BOOT_ROUNDS\} boot rounds/)
    expect(yml).toContain('actions/runs/${GITHUB_RUN_ID}')
  })

  describe('summary', () => {
    let dir = ''
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = '' })

    it('trims the single worst boot round per side before CI95 and reports the trimmed samples in summary', () => {
      // 9 rounds; round 3 of the candidate has a +250 ms runner spike, round 6 of the baseline a +240 ms one.
      const candidate: Record<number, number> = { 1: 401, 2: 403, 3: 655, 4: 400, 5: 405, 6: 404, 7: 401, 8: 399, 9: 404 }
      const base: Record<number, number> = { 1: 400, 2: 404, 3: 403, 4: 399, 5: 406, 6: 640, 7: 402, 8: 398, 9: 405 }

      // trimWorst drops exactly one value per side: the highest.
      const c = trimWorst(candidate)
      expect(c.trimmed).toEqual([{ round: 3, value: 655 }])
      expect(Object.keys(c.kept)).toHaveLength(8)
      expect(trimWorst(base).trimmed).toEqual([{ round: 6, value: 640 }])
      // Fewer than 5 rounds: nothing is dropped.
      expect(trimWorst({ 1: 1, 2: 2, 3: 300, 4: 4 }).trimmed).toEqual([])
      // A tie drops one round only (the latest), never two.
      expect(trimWorst({ 1: 9, 2: 1, 3: 9, 4: 2, 5: 3 }).trimmed).toEqual([{ round: 3, value: 9 }])

      // Untrimmed, the two spikes pull the paired differences apart; trimmed, they are gone before the CI95.
      const raw = pairedDelta(candidate, base)
      const trimmed = pairedDelta(candidate, base, { trim: true })
      expect(raw.paired).toBe(9)
      expect(raw.pairedRounds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      expect(trimmed.paired).toBe(7)
      expect(trimmed.pairedRounds).toEqual([1, 2, 4, 5, 7, 8, 9])
      expect(trimmed.trimmed).toEqual({ candidate: [{ round: 3, value: 655 }], base: [{ round: 6, value: 640 }] })
      const kept = [1, 2, 4, 5, 7, 8, 9].map(round => candidate[round] - base[round])
      expect(trimmed.delta).toBe(median(kept))
      expect(trimmed.verdict).toBe('within noise')
      expect(Math.max(Math.abs(trimmed.ci[0]), Math.abs(trimmed.ci[1]))).toBeLessThanOrEqual(2)
      expect(trimmedNote(trimmed.trimmed)).toBe('candidate r3 655.0 · base r6 640.0')
      expect(methodLine({ bootRounds: 9, rounds: 7, runIds: ['43644280439'] })).toContain('N=9 boot rounds')

      // The real summarizer over a results folder: the method line, the trimmed values in markdown and in JSON.
      dir = mkdtempSync(join(tmpdir(), 'perf-gate-'))
      mkdirSync(join(dir, 'rounds'))
      writeFileSync(join(dir, 'heads.json'), JSON.stringify([
        { side: 'A', ref: 'v1.5.0', sha: 'aaaaaaaaaaaa' }, { side: 'B', ref: 'v1.5.1', sha: 'bbbbbbbbbbbb' }, { side: 'C', ref: 'main', sha: 'cccccccccccc' }
      ]))
      const reference: Record<number, number> = { 1: 420, 2: 421, 3: 419, 4: 418, 5: 422, 6: 420, 7: 417, 8: 423, 9: 421 }
      const boot = (side: string, round: number, value: number): void => {
        const lines = [0, 1, 2, 3].map(launch => `[GATE-BOOT] side=${side} round=${round} launch=${launch} warmup=${launch === 0 ? 1 : 0} interactive=${(launch === 0 ? value + 300 : value).toFixed(1)} firstPaint=${(value / 2).toFixed(1)}`)
        writeFileSync(join(dir, 'rounds', `${side}-r${round}-boot.log`), lines.join('\n'))
      }
      for (let round = 1; round <= 9; round++) { boot('A', round, reference[round]); boot('B', round, base[round]); boot('C', round, candidate[round]) }
      const json = join(dir, 'perf-gate.json')
      const markdown = execFileSync(process.execPath, [join(ROOT, 'perf-gate/summarize.mjs'), dir, 'windows-x64', '--json', json, '--run-ids', '43644280439'], {
        encoding: 'utf8', env: { ...process.env, GITHUB_RUN_ID: '50000000001' }
      })
      expect(markdown).toContain('Method (OXE-163): alternating order (candidate first on odd rounds, baseline first on even) + worst boot round dropped per side before the CI95 + N=9 boot rounds')
      expect(markdown).toContain('CI runs: 50000000001, 43644280439.')
      expect(markdown).toContain('launch order CBA on odd rounds, BCA on even ones')
      expect(markdown).toContain('Trimmed boot rounds (worst round per side, dropped before the median and the CI95):')
      expect(markdown).toContain('- Boot: process → interactive: v1.5.0 r8 423.0 · v1.5.1 r6 640.0 · main r3 655.0')
      const interactive = markdown.split('\n').find(line => line.startsWith('| Boot: process → interactive'))!
      expect(interactive).toContain('within noise')
      expect(interactive).not.toContain('REGRESSES')

      const report = JSON.parse(readFileSync(json, 'utf8')) as {
        method: { bootRounds: number; trimMax: number; order: { odd: string; even: string }; runIds: string[] }
        rows: Array<{ metric: string; paired: number; trimmed?: Record<string, Array<{ round: number; value: number }>> }>
      }
      expect(report.method).toMatchObject({ bootRounds: 9, trimMax: 1, order: { odd: 'CBA', even: 'BCA' }, runIds: ['50000000001', '43644280439'] })
      const row = report.rows.find(entry => entry.metric === 'Boot: process → interactive')!
      expect(row.paired).toBe(7)
      expect(row.trimmed).toEqual({ A: [{ round: 8, value: 423 }], B: [{ round: 6, value: 640 }], C: [{ round: 3, value: 655 }] })
      // Only boot metrics are trimmed.
      expect(report.rows.find(entry => entry.metric === 'Renderer entry chunk')).not.toHaveProperty('trimmed')
    })
  })
})
