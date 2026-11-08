// @vitest-environment node
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ALWAYS_TESTS,
  ANDROID_GENERATED_TEST,
  buildSteps,
  checkEnv,
  classifyChange,
  CI_UNIT_JOBS,
  ciEvidence,
  markerContent,
  markerPath,
  NETWORK_FAILURE,
  parseArgs,
  runIdOf,
  STATUS_CONTEXT,
  statusBody,
  visualEvidence,
  visualPlatforms,
  WORKERS,
  withNetworkRetry,
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
    const ci: Step[] = buildSteps({ files: ['vitest.config.ts'], related: plan({ all: true }) })
    expect(ci.map(s => s.kind)).toEqual(['npm', 'npm', 'ci'])
    expect(ci[2].args).toEqual(CI_UNIT_JOBS)
    const full: Step[] = buildSteps({ files: ['vitest.config.ts'], related: plan({ all: true }), full: true })
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
    expect(markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['ci'], evidence: 'ci', runs: [71] })).toEqual({ ok: true, sha: SHA, at: 't', evidence: 'ci', runs: [71], base: 'origin/main', steps: ['ci'] })
    expect(markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['visual'], evidence: 'images', runs: [81, 82] })).toMatchObject({ evidence: 'images', runs: [81, 82] })
    expect(markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['lint'] })).toMatchObject({ evidence: 'local', runs: [] })
  })
})

describe('changes that need no node_modules (TECH LEAD, 07/11)', () => {
  const win = (f: string) => `e2e/visual/__screenshots__/win32/${f}.png`
  const lin = (f: string) => `e2e/visual/__screenshots__/linux/${f}.png`

  it('tells images, packages and code apart', () => {
    expect(classifyChange([win('a/x'), lin('b/y')])).toBe('images')
    expect(classifyChange(['package.json', 'package-lock.json'])).toBe('packages')
    expect(classifyChange(['playground/package.json', 'playground/package-lock.json'])).toBe('packages')
    expect(classifyChange(['mobile/android/app/src/test/snapshots/images/a.png'])).toBe('packages')
    // A screenshot of a platform the workflow doesn't know is an "other snapshot": CI decides.
    expect(classifyChange(['e2e/visual/__screenshots__/darwin/a.png'])).toBe('packages')
    for (const files of [[win('a/x'), 'src/App.tsx'], [win('a/x'), 'e2e/visual/code-states.spec.ts'], ['package.json', 'scripts/x.mjs'], ['e2e/visual/__screenshots__/win32/notes.md'], []])
      expect(classifyChange(files), files.join(',')).toBe('code')
    expect(visualPlatforms([win('a/x'), win('b/y'), lin('c/z')])).toEqual(['linux', 'windows'])
  })

  it('proves images with visual-baselines.yml and packages with CI, with no local step', () => {
    expect(buildSteps({ files: [win('a/x')], related: plan() })).toEqual([{ name: expect.stringContaining('(windows)'), kind: 'visual', args: ['windows'] }])
    expect(buildSteps({ files: ['playground/package-lock.json'], related: plan({ all: true }) })).toEqual([{ name: expect.stringContaining('packages only'), kind: 'ci', args: CI_UNIT_JOBS }])
  })

  it('needs a green visual-baselines run on this exact sha for every platform touched', () => {
    const run = (id: number, platform: string, over: Record<string, unknown> = {}) => ({ id, head_sha: SHA, status: 'completed', conclusion: 'success', display_title: `Visual baselines · ${platform} · test/x`, created_at: '2026-11-07T10:00:00Z', ...over })
    expect(visualEvidence([run(1, 'linux'), run(2, 'windows')], ['linux', 'windows'], SHA)).toEqual({ ok: true, missing: [], runs: [1, 2] })
    expect(visualEvidence([run(1, 'linux')], ['linux', 'windows'], SHA).missing).toEqual([expect.stringMatching(/^windows: no visual-baselines\.yml run on this head/)])
    expect(visualEvidence([run(1, 'windows', { head_sha: 'b'.repeat(40) })], ['windows'], SHA).ok).toBe(false)
    expect(visualEvidence([run(1, 'windows', { status: 'in_progress', conclusion: null })], ['windows'], SHA).missing).toEqual(['windows: run 1 still in_progress'])
    // The latest run of a platform decides: a later failure is not hidden by an earlier pass.
    expect(visualEvidence([run(1, 'windows'), run(2, 'windows', { conclusion: 'failure', created_at: '2026-11-07T11:00:00Z' })], ['windows'], SHA).missing).toEqual(['windows: run 2 failure'])
  })
})

describe('an unstable network', () => {
  const failing = (messages: string[]) => {
    let calls = 0
    return { run: () => { const message = messages[calls++]; if (message) throw Object.assign(new Error(message), { stderr: message }); return 'ok' }, calls: () => calls }
  }

  it('retries a network failure with a doubling wait, then answers', () => {
    const waits: number[] = []
    const f = failing(['Post "https://api.github.com/graphql": unexpected EOF', 'HTTP 502 Bad Gateway'])
    expect(withNetworkRetry(f.run, { sleep: (ms: number) => waits.push(ms) })).toBe('ok')
    expect(f.calls()).toBe(3)
    expect(waits).toEqual([3000, 6000])
  })

  it('gives up after the last try, and never retries a real answer', () => {
    const f = failing(Array(5).fill('read: connection reset by peer'))
    expect(() => withNetworkRetry(f.run, { sleep: () => {} })).toThrow(/connection reset/)
    expect(f.calls()).toBe(5)
    const auth = failing(['HTTP 401: Bad credentials'])
    expect(() => withNetworkRetry(auth.run, { sleep: () => {} })).toThrow(/401/)
    expect(auth.calls()).toBe(1)
    expect(NETWORK_FAILURE.test('Not Found (HTTP 404)')).toBe(false)
  })
})

describe('the pr:ready commit status (TECH LEAD (b), 08/11)', () => {
  const content = (over: Record<string, unknown> = {}) => ({ ok: true, sha: SHA, at: 't', evidence: 'local', runs: [] as number[], base: 'origin/main', steps: ['lint', 'typecheck', 'gates'], ...over })

  it('is a success on the pr:ready context, saying how the head was proven', () => {
    expect(STATUS_CONTEXT).toBe('pr:ready')
    expect(statusBody(content(), 'o/r')).toEqual({ state: 'success', context: 'pr:ready', description: 'local: 3 local step(s)' })
    expect(statusBody(content({ evidence: 'images', runs: [81, 82] }), 'o/r')).toEqual({
      state: 'success', context: 'pr:ready', description: 'images: run 81, 82', target_url: 'https://github.com/o/r/actions/runs/81',
    })
    expect(statusBody(content({ evidence: 'ci', runs: [71] }), 'o/r').target_url).toBe('https://github.com/o/r/actions/runs/71')
  })

  it('keeps the description within GitHub\'s 140 characters', () => {
    const body = statusBody(content({ evidence: 'ci', runs: Array.from({ length: 30 }, (_, i) => 42000000000 + i) }), 'o/r')
    expect(body.description.length).toBeLessThanOrEqual(140)
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
