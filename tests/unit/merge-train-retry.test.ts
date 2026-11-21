// @vitest-environment node
// OXE-141: a car or a batch broken only by E2E shards gets its failed jobs re-run once before it leaves the queue.
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { CI_WORKFLOW, CONTAINER_CHECK, retryableFailure, step } from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const HEAD = 'a'.repeat(40)
const minutes = (n: number) => n * 60_000
const iso = (ms: number) => new Date(ms).toISOString()
type Run = { name: string; path?: string; headSha: string; status: string; conclusion: string | null; htmlUrl?: string; createdAt?: string; id?: number; runAttempt?: number }
type Check = { name: string; headSha: string; status: string; conclusion: string | null; htmlUrl?: string; failedStep?: string | null }
const pr = (over: Record<string, unknown> = {}) => ({ number: 7, state: 'open', draft: false, isFork: false, headSha: HEAD, headRef: 'feat/x', mergeable: true, mergeableState: 'clean', changesRequested: false, labeledAt: '2026-10-31T11:00:00Z', labeledBy: 'maintainer', labelerAllowed: true, ...over })
const ciRun = (over: Partial<Run> = {}): Run => ({ name: CI_WORKFLOW, path: '.github/workflows/ci.yml', headSha: HEAD, status: 'completed', conclusion: 'success', htmlUrl: 'https://github.com/o/r/actions/runs/1', createdAt: '2026-10-31T11:10:00Z', ...over })
const check = (name: string, over: Partial<Check> = {}): Check => ({ name, headSha: HEAD, status: 'completed', conclusion: 'success', ...over })
const greenChecks = () => [check('CI result'), check('Changed paths'), check('Typecheck, test and build (Linux)'), check('OxeQuery live tests', { conclusion: 'skipped' })]
const input = (over: Record<string, unknown> = {}) => ({ pr: pr(), behindBy: 0, runs: [ciRun()], checks: greenChecks(), requiredChecks: [], trainState: null, now: NOW, timeoutMinutes: 60, ...over })

describe('the train re-runs flaky E2E jobs once (OXE-141)', () => {
  it('re-runs the failed E2E jobs once when they are the only failures (OXE-141), restarting the wait', () => {
    const checks = [...greenChecks().filter(c => c.name !== 'CI result'), check('CI result', { conclusion: 'failure' }), check('E2E and native tests (windows-x64, 2/3)', { conclusion: 'failure' })]
    const action = step(input({ checks, runs: [ciRun({ conclusion: 'failure', id: 41, runAttempt: 1 })], trainState: { head: HEAD, since: iso(NOW - minutes(50)), labeledAt: pr().labeledAt } }))
    expect(action.type).toBe('rerun')
    expect((action as { runId?: number }).runId).toBe(41)
    expect(action.message).toContain('E2E and native tests (windows-x64, 2/3)')
    expect(action.state?.since).toBe(iso(NOW))
  })

  it('takes the PR out when the re-run failed again, and never re-runs a non-E2E failure', () => {
    const e2e = [...greenChecks(), check('E2E and native tests (linux-x64, 3/3)', { conclusion: 'failure' })]
    expect(step(input({ checks: e2e, runs: [ciRun({ conclusion: 'failure', id: 41, runAttempt: 2 })] })).type).toBe('unlabel')
    const unit = [...greenChecks(), check('Unit and integration tests (linux-x64)', { conclusion: 'failure' }), check('E2E and native tests (linux-x64, 3/3)', { conclusion: 'failure' })]
    expect(step(input({ checks: unit, runs: [ciRun({ conclusion: 'failure', id: 41, runAttempt: 1 })] })).type).toBe('unlabel')
    // A run with no id (an older listing) is never re-run: the old behaviour.
    expect(step(input({ checks: e2e, runs: [ciRun({ conclusion: 'failure' })] })).type).toBe('unlabel')
  })

  it('repeats once an OxeQuery live job whose containers did not come up, like an E2E shard (OXE-288, #859)', () => {
    const live = { name: 'OxeQuery live tests (PostgreSQL 17-alpine, MongoDB 8.0)', conclusion: 'failure' }
    expect(CONTAINER_CHECK.test(live.name)).toBe(true)
    expect(CONTAINER_CHECK.test('OxeQuery live tests (sqlite; PostgreSQL, MongoDB, SSH, TLS)')).toBe(true)
    expect(retryableFailure([live, { name: 'CI result', conclusion: 'failure' }])).toBe(true)
    expect(retryableFailure([live, { name: 'E2E and native tests (linux-x64, 2/3)', conclusion: 'failure' }, { name: 'CI result', conclusion: 'failure' }])).toBe(true)
    // With a real answer beside it (unit, lint), nothing is repeated.
    expect(retryableFailure([live, { name: 'Quick checks (linux-x64)', conclusion: 'failure' }])).toBe(false)
    // The second failure still takes the car out: the retry is once, by run attempt, as for the E2E shards.
    const checks = [...greenChecks(), check(live.name, { conclusion: 'failure' })]
    expect(step(input({ checks, runs: [ciRun({ conclusion: 'failure', id: 41, runAttempt: 2 })] })).type).toBe('unlabel')
    expect(step(input({ checks, runs: [ciRun({ conclusion: 'failure', id: 41, runAttempt: 1 })] })).type).toBe('rerun')
  })

  it('counts a job the runner cancelled or timed out as infrastructure, and the unit merge job that failed on it (car #816)', () => {
    const shard = { name: 'Unit and integration tests (linux-x64, 1/3)', conclusion: 'cancelled' }
    expect(retryableFailure([shard, { name: 'Unit and integration tests (linux-x64)', conclusion: 'failure' }, { name: 'Unit and integration tests (windows-x64)', conclusion: 'failure' }, { name: 'CI result', conclusion: 'failure' }])).toBe(true)
    expect(retryableFailure([{ name: 'E2E and native tests (windows-x64, 2/3)', conclusion: 'timed_out' }])).toBe(true)
    // A unit merge job that failed with no cancelled shard behind it is an answer, never repeated.
    expect(retryableFailure([{ name: 'Unit and integration tests (linux-x64)', conclusion: 'failure' }, { name: 'CI result', conclusion: 'failure' }])).toBe(false)
    expect(retryableFailure([shard, { name: 'Quick checks (linux-x64)', conclusion: 'failure' }])).toBe(false)
  })

  it('counts a failure as repeatable only when every failing check is an E2E shard or CI result, with one E2E at least', () => {
    expect(retryableFailure([{ name: 'E2E and native tests (windows-x64, 1/3)' }, { name: 'CI result' }])).toBe(true)
    expect(retryableFailure([{ name: 'CI result' }])).toBe(false)
    expect(retryableFailure([{ name: 'E2E and native tests (linux-x64, 2/3)' }, { name: 'Quick checks (linux-x64)' }])).toBe(false)
    expect(retryableFailure([])).toBe(false)
  })

})
