// @vitest-environment node
// OXE-404 (CI LEVE NO PR, the user 23/11): a pull request's own ci.yml run is the light shape (shard 2's build and brand
// conformance only), so it never stands for the CI a car merges on. A solo, up-to-date car with only that run gets the
// full check dispatched; it merges only on a green push or workflow_dispatch run, and never on a red one.
import { describe, expect, it } from 'vitest'
import {
  CI_WORKFLOW,
  DISPATCH_GRACE_MS,
  createGitHubApi,
  lightPullRequestRun,
  step,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-11-23T04:00:00Z')
const HEAD = 'c'.repeat(40)
const iso = (ms: number) => new Date(ms).toISOString()
const LABELED_AT = '2026-11-23T03:00:00Z'

type Run = { name: string; path: string; event?: string; headSha: string; status: string; conclusion: string | null; htmlUrl?: string; createdAt?: string; id?: number }
const run = (over: Partial<Run> = {}): Run => ({
  name: CI_WORKFLOW,
  path: '.github/workflows/ci.yml',
  headSha: HEAD,
  status: 'completed',
  conclusion: 'success',
  htmlUrl: 'https://github.com/o/r/actions/runs/1',
  createdAt: '2026-11-23T03:10:00Z',
  id: 1,
  ...over,
})
const check = (name: string, conclusion: string | null = 'success') => ({ name, headSha: HEAD, status: 'completed', conclusion })
const pr = () => ({
  number: 9,
  state: 'open',
  draft: false,
  isFork: false,
  headSha: HEAD,
  headRef: 'feat/light',
  mergeable: true,
  mergeableState: 'clean',
  changesRequested: false,
  labeledAt: LABELED_AT,
  labeledBy: 'maintainer',
  labelerAllowed: true,
})
// The train's state once the grace after the label has passed, so a missing CI run is dispatched at once.
const settled = { head: HEAD, since: iso(NOW - DISPATCH_GRACE_MS), labeledAt: LABELED_AT }
const input = (over: Record<string, unknown> = {}) => ({
  pr: pr(),
  behindBy: 0,
  runs: [],
  checks: [],
  requiredChecks: [],
  trainState: settled,
  now: NOW,
  timeoutMinutes: 60,
  ...over,
})

describe('OXE-404 · a pull request\'s light CI run never merges a car', () => {
  it('a pull_request run of ci.yml is the light one; a push, a dispatch or another workflow is not', () => {
    expect(lightPullRequestRun(run({ event: 'pull_request' }))).toBe(true)
    expect(lightPullRequestRun(run({ event: 'workflow_dispatch' }))).toBe(false)
    expect(lightPullRequestRun(run({ event: 'push' }))).toBe(false)
    expect(lightPullRequestRun(run({ name: 'Android', path: '.github/workflows/android.yml', event: 'pull_request' }))).toBe(false)
  })

  it('a solo up-to-date car with only a green PR run gets the full check dispatched, not merged', () => {
    const action = step(input({ runs: [run({ event: 'pull_request' })], checks: [check('CI result')] }))
    expect(action.type).toBe('dispatch')
    expect(action.dispatch).toContain('ci.yml')
    expect(action.state).toMatchObject({ dispatchedFor: HEAD })
  })

  it('with a green dispatched run on the head, the car merges', () => {
    const runs = [run({ event: 'pull_request', id: 1 }), run({ event: 'workflow_dispatch', id: 2, createdAt: '2026-11-23T03:30:00Z' })]
    const action = step(input({ runs, checks: [check('CI result')] }))
    expect(action.type).toBe('merge')
    expect(action.expectedHead).toBe(HEAD)
  })

  it('with a red dispatched run on the head, the car does not merge, even with the PR run green', () => {
    const runs = [run({ event: 'pull_request', id: 1 }), run({ event: 'workflow_dispatch', id: 2, conclusion: 'failure', createdAt: '2026-11-23T03:30:00Z' })]
    const action = step(input({ runs, checks: [check('CI result', 'failure')] }))
    expect(action.type).not.toBe('merge')
    expect(action.type).toBe('unlabel')
  })

  it('the Android workflow\'s pull_request run still counts with a dispatched ci.yml run', () => {
    const runs = [run({ event: 'workflow_dispatch', id: 2 }), run({ name: 'Android', path: '.github/workflows/android.yml', event: 'pull_request', id: 3 })]
    expect(step(input({ runs, checks: [check('CI result')] })).type).toBe('merge')
  })

  it('listRuns carries each run\'s event, so the light run is known by it', async () => {
    const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: { get: () => '' } })
    const fetchImpl = async () => respond({
      workflow_runs: [
        { name: 'PR #9 · light', path: '.github/workflows/ci.yml', head_sha: HEAD, event: 'pull_request', head_repository: { full_name: 'o/r' }, status: 'completed', conclusion: 'success', id: 1 },
      ],
    })
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl })
    const [listed] = await api.listRuns(HEAD)
    expect(listed).toMatchObject({ name: CI_WORKFLOW, event: 'pull_request' })
    expect(lightPullRequestRun(listed)).toBe(true)
  })
})
