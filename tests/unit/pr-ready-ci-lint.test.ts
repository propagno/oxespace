// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildSteps,
  CI_LINT_JOB,
  CI_UNIT_JOBS,
  ciEvidence,
  markerContent,
  npmInstalled,
  statusBody,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/pr-ready.mjs'

const SHA = 'a'.repeat(40)
const plan = (over: Record<string, unknown> = {}) => ({ all: false, changed: false, extra: [] as string[], reasons: [], ...over })
type Step = { name: string; kind: string; args: string[] }

describe('lint and typecheck from CI, only with no local node_modules (TECH LEAD, 08/11)', () => {
  it('calls a checkout installed only when npm installed it, not for a cache folder', () => {
    const root = 'C:/w'
    const has = (paths: string[]) => (path: string) => paths.includes(path.replace(/\\/g, '/'))
    expect(npmInstalled(root, has(['C:/w/node_modules/.package-lock.json']))).toBe(true)
    expect(npmInstalled(root, has(['C:/w/node_modules', 'C:/w/node_modules/.vite']))).toBe(false)
    expect(npmInstalled(root, has([]))).toBe(false)
  })

  it('a checkout with node_modules always runs lint and typecheck itself', () => {
    for (const steps of [buildSteps({ files: ['scripts/x.mjs'], related: plan() }), buildSteps({ files: ['scripts/x.mjs'], related: plan(), nodeModules: true })] as Step[][]) {
      expect(steps.slice(0, 2).map(step => [step.kind, step.args[0]])).toEqual([['npm', 'lint'], ['npm', 'typecheck']])
      expect(steps.some(step => step.kind === 'ci-lint')).toBe(false)
    }
  })

  it('a checkout without node_modules takes the gate and related tests from both CI unit jobs', () => {
    const steps: Step[] = buildSteps({ files: ['scripts/x.mjs'], related: plan({ changed: true, extra: ['tests/x.test.ts'] }), nodeModules: false })
    expect(steps.map(step => [step.kind, step.args])).toEqual([['ci-lint', [CI_LINT_JOB]], ['ci-tests', CI_UNIT_JOBS]])
    expect(steps.some(step => step.kind === 'vitest')).toBe(false)
    // Installed: the tests run here, as before.
    expect((buildSteps({ files: ['scripts/x.mjs'], related: plan({ changed: true }) }) as Step[]).filter(step => step.kind === 'vitest')).toHaveLength(2)
  })

  it('counts only both unit jobs completed with success on the exact head, and names them linux then windows', () => {
    const [linux, windows] = CI_UNIT_JOBS
    const job = (name: string, id: number, over: Record<string, unknown> = {}) => ({ id, name, status: 'completed', conclusion: 'success', head_sha: SHA, started_at: '2026-11-08T10:00:00Z', details_url: `https://github.com/o/r/actions/runs/90/job/${id}`, ...over })
    expect(ciEvidence([job(windows, 802), job(linux, 801)], CI_UNIT_JOBS, SHA)).toMatchObject({ ok: true, runs: [90], jobs: [801, 802] })
    for (const over of [{ status: 'in_progress', conclusion: null }, { conclusion: 'skipped' }, { conclusion: 'cancelled' }, { head_sha: 'b'.repeat(40) }]) {
      expect(ciEvidence([job(linux, 801), job(windows, 802, over)], CI_UNIT_JOBS, SHA).ok, JSON.stringify(over)).toBe(false)
    }
    expect(ciEvidence([job(linux, 801)], CI_UNIT_JOBS, SHA).missing).toEqual([`${windows}: not run on this head`])
    const marker = markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['quick', 'tests'], lint: 'ci:91', tests: 'ci:801,802' })
    expect(marker).toMatchObject({ evidence: 'local', lint: 'ci:91', tests: 'ci:801,802' })
    expect(statusBody(marker, 'o/r').description).toBe('local: 2 local step(s) · lint ci:91 · tests ci:801,802')
  })

  it('a checkout without node_modules takes them from the Quick checks job instead', () => {
    const steps: Step[] = buildSteps({ files: ['package.json', 'scripts/x.mjs'], related: plan({ all: true }), nodeModules: false })
    expect(steps).toEqual([
      { name: expect.stringContaining(CI_LINT_JOB), kind: 'ci-lint', args: [CI_LINT_JOB] },
      { name: expect.stringContaining('CI unit jobs'), kind: 'ci', args: CI_UNIT_JOBS },
    ])
    expect(CI_LINT_JOB).toBe('Quick checks (linux-x64)')
  })

  it('leaves the images and packages paths as they were', () => {
    const image = 'e2e/visual/__screenshots__/linux/a/x.png'
    expect((buildSteps({ files: [image], related: plan(), nodeModules: false }) as Step[]).map(step => step.kind)).toEqual(['visual'])
    expect((buildSteps({ files: ['package-lock.json'], related: plan({ all: true }), nodeModules: false }) as Step[]).map(step => step.kind)).toEqual(['ci'])
  })

  it('wants the Quick checks job completed with success on the exact head', () => {
    const run = (over: Record<string, unknown> = {}) => ({ name: CI_LINT_JOB, status: 'completed', conclusion: 'success', head_sha: SHA, started_at: '2026-11-08T10:00:00Z', details_url: 'https://github.com/o/r/actions/runs/91/job/1', ...over })
    expect(ciEvidence([run()], [CI_LINT_JOB], SHA)).toMatchObject({ ok: true, missing: [], runs: [91] })
    expect(ciEvidence([run({ head_sha: 'b'.repeat(40) })], [CI_LINT_JOB], SHA).missing).toEqual([`${CI_LINT_JOB}: not run on this head`])
    expect(ciEvidence([run({ status: 'in_progress', conclusion: null })], [CI_LINT_JOB], SHA).ok).toBe(false)
    expect(ciEvidence([run(), run({ conclusion: 'failure', started_at: '2026-11-08T11:00:00Z' })], [CI_LINT_JOB], SHA).missing).toEqual([`${CI_LINT_JOB}: failure`])
  })

  it('records lint: "ci:<run id>" in the marker and the status, and nothing when lint ran here', () => {
    const marker = markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['quick', 'ci'], evidence: 'ci', runs: [71], lint: 'ci:91' })
    expect(marker).toMatchObject({ ok: true, evidence: 'ci', runs: [71], lint: 'ci:91' })
    expect(markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['lint'] })).not.toHaveProperty('lint')
    expect(markerContent({ sha: SHA, at: 't', base: 'origin/main', steps: ['lint'] })).not.toHaveProperty('tests')
    expect(statusBody(marker, 'o/r').description).toBe('ci: run 71 · lint ci:91')
  })
})
