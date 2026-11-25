// @vitest-environment node
// OXE-389: the performance gate's record reads the step of the job's own OS (the Windows outcome was never read), a
// memory reading of 0 MB is not a pass, Linux holds its working set to a budget, and outside a release ci.yml accepts
// only the two named Windows failures that exist today, each with its open card (decision of 23/11, option c).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { LINUX_WORKING_SET_BUDGETS_MB, WINDOWS_PRIVATE_BUDGETS_MB, memoryBudgetChecks, type MemorySample } from '../../e2e/helpers/memory-budget'
// @ts-expect-error -- a plain ES module script without type declarations
import { classifyGate, parseFailures } from '../../scripts/perf-gate-outcome.mjs'

type Step = { name?: string; id?: string; env?: Record<string, string>; run?: string }
type Job = { steps: Step[] }
const workflow = load(readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8')) as { env?: Record<string, string>; jobs: Record<string, Job> }
const recordStep = workflow.jobs.e2e.steps.find(step => step.name === 'Record the performance gate')

/** The subset of GitHub's expression language the record uses: paths, 'strings', ==, !=, !, && and || (left to right). */
function evaluate(expression: string, context: Record<string, unknown>): unknown {
  const body = /^\$\{\{([\s\S]*)\}\}$/.exec(expression.trim())?.[1] ?? expression
  const tokens = body.match(/'(?:[^']|'')*'|==|!=|&&|\|\||[!()]|[A-Za-z_][\w.-]*/g) ?? []
  let at = 0
  const peek = () => tokens[at]
  const truthy = (value: unknown) => value !== '' && value !== null && value !== undefined && value !== false && value !== 0
  const primary = (): unknown => {
    const token = tokens[at++]
    if (token === '(') { const value = or(); at++; return value }
    if (token === '!') return !truthy(primary())
    if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'")
    return token.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], context)
  }
  const compare = (): unknown => {
    let left = primary()
    while (peek() === '==' || peek() === '!=') {
      const op = tokens[at++]
      const right = primary()
      const same = String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase()
      left = op === '==' ? same : !same
    }
    return left
  }
  const and = (): unknown => { let left = compare(); while (peek() === '&&') { at++; const right = compare(); left = truthy(left) ? right : left } return left }
  const or = (): unknown => { let left = and(); while (peek() === '||') { at++; const right = and(); left = truthy(left) ? left : right } return left }
  return or()
}

const job = (os: 'Windows' | 'Linux', linux: string, windows: string) => ({ runner: { os }, steps: { perf_linux: { outcome: linux }, perf_windows: { outcome: windows } } })

describe('OXE-389: the performance gate record', () => {
  it('records the Windows outcome on a Windows job', () => {
    const outcome = recordStep?.env?.OUTCOME
    expect(outcome, 'the record step sets OUTCOME').toBeTypeOf('string')
    // On a Windows job the Linux step is skipped, and "skipped" is truthy: it must not hide the Windows step.
    expect(evaluate(outcome!, job('Windows', 'skipped', 'failure'))).toBe('failure')
    expect(evaluate(outcome!, job('Windows', 'skipped', 'success'))).toBe('success')
    // And a Linux job records the Linux step.
    expect(evaluate(outcome!, job('Linux', 'failure', 'skipped'))).toBe('failure')
    expect(evaluate(outcome!, job('Linux', 'success', 'skipped'))).toBe('success')
  })

  it('a zero memory reading is not a pass', () => {
    const zero: MemorySample = { totalMb: 0, byType: {}, workingSetTotalMb: 0, workingSetByType: {} }
    for (const platform of ['linux', 'win32'] as const) {
      const checks = memoryBudgetChecks(zero, platform)
      expect(checks.length, `${platform} checks total, browser and renderer`).toBe(3)
      for (const check of checks) {
        expect(check.ok, `${platform} ${check.key}: ${check.message}`).toBe(false)
        expect(check.message).toMatch(/read 0 MB: not a measurement/)
      }
    }
  })

  it('Linux holds the working set to its budget', () => {
    // 25% above the median of main's last 5 runs, which the budget's comment cites.
    expect(LINUX_WORKING_SET_BUDGETS_MB).toEqual({ total: 984, browser: 398, renderer: 320 })
    const source = readFileSync(join(process.cwd(), 'e2e', 'helpers', 'memory-budget.ts'), 'utf8')
    for (const run of ['45227150398', '45215169599', '45209063244', '45191886755', '45186569599']) expect(source).toContain(run)
    const linux = (total: number, browser: number, tab: number): MemorySample => ({ totalMb: 0, byType: {}, workingSetTotalMb: total, workingSetByType: { Browser: browser, Tab: tab, GPU: 130 } })
    // Main's measure today (run 45227150398) passes, on the working set, not on the private bytes Linux never reports.
    const today = memoryBudgetChecks(linux(786.9, 319, 255.3), 'linux')
    expect(today.map(check => [check.key, check.reading, check.value, check.budget, check.ok])).toEqual([
      ['total', 'working set', 786.9, 984, true], ['browser', 'working set', 319, 398, true], ['renderer', 'working set', 255.3, 320, true]])
    const over = memoryBudgetChecks(linux(1000, 400, 321), 'linux')
    expect(over.map(check => check.ok)).toEqual([false, false, false])
    expect(over[1].message).toBe('browser working set memory 400 MB exceeded 398 MB')
    // Windows keeps its private-bytes budgets, unchanged.
    expect(WINDOWS_PRIVATE_BUDGETS_MB).toEqual({ total: 680, browser: 270, renderer: 200 })
    const windows = memoryBudgetChecks({ totalMb: 600, byType: { Browser: 291.7, Tab: 150 }, workingSetTotalMb: 900, workingSetByType: {} }, 'win32')
    expect(windows.map(check => [check.key, check.reading, check.ok])).toEqual([['total', 'private', true], ['browser', 'private', false], ['renderer', 'private', true]])
    expect(windows[1].message).toBe('browser private memory 291.7 MB exceeded 270 MB')
  })
})

// The tail of the Windows gate's log on main cfe78e55f (run 45227150398, job 137879301553), as perf-gate.log holds it.
const MAIN_WINDOWS_LOG = `
  ok 20 e2e\\perf-benchmark.spec.ts:876:1 › memory: main process with 10 Threads open (15.6s)


  1) e2e\\memory-footprint.spec.ts:91:1 › memory footprint: one long Thread, four terminals, seeded history

    Error: browser private memory 291.7 MB exceeded 270 MB

    expect(received).toBeLessThanOrEqual(expected)

    Expected: <= 270
    Received:    291.7

    Error Context: test-results\\memory-footprint-memory-fo-89e8d-ur-terminals-seeded-history\\error-context.md

  2) e2e\\perceived-perf.spec.ts:479:1 › perceived performance: first feedback, first content and blank time per surface

    Error: OxeChat (Thread) warm: first content against the 33 ms baseline (round 1 55, round 2 54)

    expect(received).toBeLessThanOrEqual(expected)

    Expected: <= 49.7
    Received:    55

    Error Context: test-results\\perceived-perf-perceived-p-1786f--and-blank-time-per-surface\\error-context.md

  2 failed
    e2e\\memory-footprint.spec.ts:91:1 › memory footprint: one long Thread, four terminals, seeded history
    e2e\\perceived-perf.spec.ts:479:1 › perceived performance: first feedback, first content and blank time per surface
  18 passed (5.6m)
`
const known = () => JSON.parse(workflow.env?.PERF_GATE_KNOWN_FAILURES ?? '[]') as Array<{ card: string; os: string; test: string; error: string }>

const SAMPLE_KNOWN = [
  {
    card: 'OXE-412',
    os: 'Windows',
    test: 'e2e/memory-footprint.spec.ts › memory footprint: one long Thread, four terminals, seeded history',
    error: '^browser private memory \\d+(\\.\\d+)? MB exceeded 270 MB$',
  },
  {
    card: 'OXE-350',
    os: 'Windows',
    test: 'e2e/perceived-perf.spec.ts › perceived performance: first feedback, first content and blank time per surface',
    error: '^OxeChat \\(Thread\\) warm: first content against the 33 ms baseline( \\(round 1 \\d+, round 2 \\d+\\))?$',
  },
]

describe('OXE-389: only the named Windows failures are accepted, each with its card', () => {
  it('ci.yml currently accepts no known failures (OXE-412 and OXE-350 are fixed)', () => {
    expect(known()).toEqual([])
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: MAIN_WINDOWS_LOG, known: known() }).outcome).toBe('failure')
  })

  it('named failures match only their exact test/OS/error and keep their cards in the record', () => {
    expect(parseFailures(MAIN_WINDOWS_LOG).failed).toBe(2)
    const result = classifyGate({ outcome: 'failure', os: 'Windows', log: MAIN_WINDOWS_LOG, known: SAMPLE_KNOWN })
    expect(result.outcome).toBe('known')
    expect(result.unknown).toEqual([])
    expect(result.known.map((k: { card: string }) => k.card).sort()).toEqual(SAMPLE_KNOWN.map(entry => entry.card).sort())
  })

  it('any other failure still fails: a third error, a timeout, another budget, another OS or no summary', () => {
    const list = SAMPLE_KNOWN
    const third = MAIN_WINDOWS_LOG.replace('Error: OxeChat (Thread) warm', 'Error: OxeQuery warm: first content against the 26 ms baseline (round 1 60, round 2 61)\n\n    Error: OxeChat (Thread) warm')
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: third, known: list }).outcome).toBe('failure')
    const timeout = MAIN_WINDOWS_LOG.replace('    Error: browser private memory', '    Test timeout of 240000ms exceeded.\n\n    Error: browser private memory')
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: timeout, known: list }).outcome).toBe('failure')
    const budget = MAIN_WINDOWS_LOG.replace('exceeded 270 MB', 'exceeded 300 MB')
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: budget, known: list }).outcome).toBe('failure')
    const baseline = MAIN_WINDOWS_LOG.replace('the 33 ms baseline', 'the 40 ms baseline')
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: baseline, known: list }).outcome).toBe('failure')
    expect(classifyGate({ outcome: 'failure', os: 'Linux', log: MAIN_WINDOWS_LOG, known: list }).outcome).toBe('failure')
    const moreFailed = MAIN_WINDOWS_LOG.replace('  2 failed', '  3 failed')
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: moreFailed, known: list }).outcome).toBe('failure')
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: 'npm ERR! missing script', known: list }).outcome).toBe('failure')
    const interrupted = `${MAIN_WINDOWS_LOG}  1 interrupted\n`
    expect(classifyGate({ outcome: 'failure', os: 'Windows', log: interrupted, known: list }).outcome).toBe('failure')
  })

  it('a passing or skipped gate is recorded as it is', () => {
    expect(classifyGate({ outcome: 'success', os: 'Windows', log: '  20 passed (5.6m)', known: known() }).outcome).toBe('success')
    expect(classifyGate({ outcome: 'skipped', os: 'Linux', log: '', known: known() }).outcome).toBe('skipped')
  })
})
