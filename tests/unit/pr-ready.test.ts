// @vitest-environment node
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALWAYS_TESTS,
  ANDROID_GENERATED_TEST,
  buildSteps,
  checkEnv,
  CI_UNIT_JOBS,
  ciEvidence,
  markerContent,
  markerPath,
  parseArgs,
  runIdOf,
  WORKERS,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/pr-ready.mjs'

const SHA = 'a'.repeat(40)
const plan = (over: Record<string, unknown> = {}) => ({ all: false, changed: false, extra: [] as string[], reasons: [], ...over })
type Step = { name: string; kind: string; args: string[] }

describe('pr:ready steps', () => {
  it('always lints, typechecks and runs the gate tests with 2 workers', () => {
    const steps: Step[] = buildSteps({ files: ['docs/a.md'], related: plan() })
    expect(steps.map(s => s.kind)).toEqual(['npm', 'npm', 'vitest'])
    expect(steps[0].args).toEqual(['lint'])
    expect(steps[1].args).toEqual(['typecheck'])
    expect(steps[2].args).toEqual([...[...ALWAYS_TESTS].sort(), WORKERS])
  })

  it('adds the selector\'s read-from-disk tests and vitest --changed for a code change', () => {
    const steps: Step[] = buildSteps({ files: ['src/App.tsx'], related: plan({ changed: true, extra: ['tests/design-lint.test.ts', 'tests/x.test.ts'] }), base: 'origin/main' })
    expect(steps[2].args).toContain('tests/x.test.ts')
    expect(steps[2].args.filter(a => a === 'tests/design-lint.test.ts')).toHaveLength(1)
    expect(steps[3]).toEqual({ name: expect.stringContaining('--changed origin/main'), kind: 'vitest', args: ['--changed', 'origin/main', '--passWithNoTests', WORKERS] })
  })

  it('checks the generated Kotlin when an android:generate input changes, and only then', () => {
    for (const file of ['shared/remote/protocol.ts', 'src/design/tokens/palette.ts', 'shared/locales/pt-BR/mobile.json', 'scripts/android/protocol-kotlin.mjs'])
      expect((buildSteps({ files: [file], related: plan() }) as Step[])[2].args, file).toContain(ANDROID_GENERATED_TEST)
    for (const file of ['shared/locales/pt-BR/app.json', 'src/App.tsx', 'shared/remote/other.ts'])
      expect((buildSteps({ files: [file], related: plan() }) as Step[])[2].args, file).not.toContain(ANDROID_GENERATED_TEST)
  })

  it('takes the PR\'s CI as the whole suite, or runs it locally with --full', () => {
    const ci: Step[] = buildSteps({ files: ['package.json'], related: plan({ all: true }) })
    expect(ci.map(s => s.kind)).toEqual(['npm', 'npm', 'ci'])
    expect(ci[2].args).toEqual(CI_UNIT_JOBS)
    const full: Step[] = buildSteps({ files: ['package.json'], related: plan({ all: true }), full: true })
    expect(full[2]).toEqual({ name: expect.stringContaining('--full'), kind: 'vitest', args: [WORKERS] })
  })
})

describe('CI as evidence for the whole suite', () => {
  const run = (name: string, over: Record<string, unknown> = {}) => ({
    name, status: 'completed', conclusion: 'success', started_at: '2026-11-07T10:00:00Z', head_sha: SHA,
    details_url: `https://github.com/o/r/actions/runs/${name.includes('windows') ? 72 : 71}/job/9`, ...over,
  })

  it('needs every unit job completed and green on the head, and names the runs that prove it', () => {
    expect(ciEvidence(CI_UNIT_JOBS.map((n: string) => run(n)), CI_UNIT_JOBS, SHA)).toEqual({ ok: true, missing: [], runs: [71, 72] })
    expect(ciEvidence(CI_UNIT_JOBS.map((n: string) => run(n, { details_url: 'https://github.com/o/r/actions/runs/70/job/1' }))).runs).toEqual([70])
    expect(ciEvidence([run(CI_UNIT_JOBS[0])]).ok).toBe(false)
    expect(ciEvidence([run(CI_UNIT_JOBS[0]), run(CI_UNIT_JOBS[1], { status: 'in_progress', conclusion: null })]).missing).toEqual([`${CI_UNIT_JOBS[1]}: still in_progress`])
    expect(ciEvidence([run(CI_UNIT_JOBS[0]), run(CI_UNIT_JOBS[1], { conclusion: 'skipped' })]).ok).toBe(false)
    expect(ciEvidence([]).missing).toHaveLength(2)
  })

  it('reads the latest run of each job: a rerun that passed counts, an earlier pass does not hide a later failure', () => {
    const [linux, windows] = CI_UNIT_JOBS
    expect(ciEvidence([run(linux), run(windows, { conclusion: 'failure', started_at: '2026-11-07T09:00:00Z' }), run(windows, { started_at: '2026-11-07T11:00:00Z' })]).ok).toBe(true)
    expect(ciEvidence([run(linux), run(windows, { started_at: '2026-11-07T09:00:00Z' }), run(windows, { conclusion: 'failure', started_at: '2026-11-07T11:00:00Z' })]).ok).toBe(false)
  })

  it('counts only runs on this exact sha, and only runs it can point to', () => {
    const [linux, windows] = CI_UNIT_JOBS
    expect(ciEvidence([run(linux), run(windows, { head_sha: 'b'.repeat(40) })], CI_UNIT_JOBS, SHA).missing).toEqual([`${windows}: not run on this head`])
    expect(ciEvidence([run(linux), run(windows, { details_url: 'https://example.com/x' })]).missing).toEqual([`${windows}: no Actions run to point to`])
    expect(runIdOf({ html_url: 'https://github.com/o/r/actions/runs/123/job/4' })).toBe(123)
    expect(runIdOf({})).toBeNull()
  })

  it('records in the marker how the head was proven', () => {
    expect(markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['lint'], ciRuns: [71, 72] })).toEqual({ ok: true, sha: SHA, at: 't', evidence: 'ci', runs: [71, 72], base: 'origin/main', steps: ['lint'] })
    expect(markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['lint'], ciRuns: null })).toMatchObject({ evidence: 'local', runs: [] })
  })
})

describe('the marker and the environment', () => {
  it('writes the marker in the main checkout, whatever worktree runs it, and only for a full sha', () => {
    expect(markerPath(join('C:', 'repo', '.git'), SHA)).toBe(join('C:', 'repo', '.claude', 'pr-ready', `${SHA}.json`))
    expect(() => markerPath(join('C:', 'repo', '.git'), 'abc')).toThrow()
    expect(() => markerPath(join('C:', 'repo', '.git'), `../${SHA}`)).toThrow()
  })

  it('drops the live app\'s variables from every check', () => {
    expect(checkEnv({ PATH: 'p', OXESPACE_MCP_TOKEN: 't', AI_MEMORY_URL: 'u', oxespace_x: '1', HOME: 'h' })).toEqual({ PATH: 'p', HOME: 'h' })
  })

  it('reads its options and refuses others', () => {
    expect(parseArgs([])).toEqual({ base: 'origin/main', full: false, dryRun: false })
    expect(parseArgs(['--base', 'upstream/main', '--full', '--dry-run'])).toEqual({ base: 'upstream/main', full: true, dryRun: true })
    expect(() => parseArgs(['--base'])).toThrow()
    expect(() => parseArgs(['--base', '--full'])).toThrow()
    expect(() => parseArgs(['--force'])).toThrow()
  })
})
