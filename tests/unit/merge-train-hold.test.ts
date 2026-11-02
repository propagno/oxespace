// @vitest-environment node
// The merge train's own required checks (decisions.md #11) and the hold while main is red (fix-main). Split out of
// merge-train.test.ts to keep each file under the 1,000-line limit.
import { describe, expect, it } from 'vitest'
import {
  CI_WORKFLOW,
  FIX_MAIN_LABEL,
  LABEL,
  TRAIN_REQUIRED_CHECKS,
  createGitHubApi,
  mainHealth,
  runTrain,
  step,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-11-01T19:00:00Z')
const HEAD = 'a'.repeat(40)
type Check = { name: string; headSha: string; status: string; conclusion: string | null }
const check = (name: string, over: Partial<Check> = {}): Check => ({ name, headSha: HEAD, status: 'completed', conclusion: 'success', ...over })
const ciRun = { name: CI_WORKFLOW, path: '.github/workflows/ci.yml', headSha: HEAD, status: 'completed', conclusion: 'success', createdAt: '2026-11-01T18:00:00Z' }
const pr = (number = 7) => ({ number, state: 'open', draft: false, isFork: false, headSha: HEAD, headRef: `feat/${number}`, mergeable: true, mergeableState: 'clean' })
const input = (over: Record<string, unknown> = {}) => ({
  pr: { ...pr(), changesRequested: false, labeledAt: '2026-11-01T17:00:00Z', labeledBy: 'maintainer', labelerAllowed: true },
  behindBy: 0,
  runs: [ciRun],
  checks: [check('CI result'), check('Changed paths')],
  trainRequiredChecks: TRAIN_REQUIRED_CHECKS,
  requiredChecks: [],
  trainState: null,
  now: NOW,
  timeoutMinutes: 60,
  ...over,
})

describe("the train's own required checks", () => {
  it('requires CI result whatever branch protection says', () => {
    expect(TRAIN_REQUIRED_CHECKS).toEqual(['CI result'])
    expect(step(input()).type).toBe('merge')
    expect(step(input({ checks: [check('Changed paths')] })).message).toMatch(/required check CI result has not run/)
    // A required gate that was skipped tested nothing: the car leaves instead of merging.
    expect(step(input({ checks: [check('CI result', { conclusion: 'skipped' })] })).type).toBe('unlabel')
  })

  it("adds protection's checks to its own, and a failing check outside both lists still keeps the car out", () => {
    expect(step(input({ requiredChecks: ['Android'] })).message).toMatch(/required check Android has not run/)
    expect(step(input({ checks: [check('CI result'), check('Accessibility scan', { conclusion: 'failure' })], requiredChecks: ['CI result'] })).type).toBe('unlabel')
  })

  it('a failed check takes the car out even when a required check never ran', () => {
    expect(step(input({ checks: [check('Build', { conclusion: 'failure' })] })).type).toBe('unlabel')
  })
})

const run = (conclusion: string | null, at: string, sha = 'c'.repeat(40), status = 'completed') => ({
  id: Date.parse(at),
  status,
  conclusion,
  headSha: sha,
  htmlUrl: `https://github.com/o/r/actions/runs/${Date.parse(at)}`,
  createdAt: at,
})

describe('main health', () => {
  it('is green when one of the 3 latest completed runs passed; cancelled and running ones say nothing', () => {
    expect(mainHealth([run('failure', '2026-11-01T18:00:00Z'), run('failure', '2026-11-01T17:00:00Z'), run('success', '2026-11-01T16:00:00Z')]).green).toBe(true)
    const noise = [run('cancelled', '2026-11-01T18:30:00Z'), run(null, '2026-11-01T18:40:00Z', 'd'.repeat(40), 'in_progress'), run('skipped', '2026-11-01T18:20:00Z')]
    expect(mainHealth([...noise, run('success', '2026-11-01T16:00:00Z')]).green).toBe(true)
  })

  it('is red when none of the 3 latest passed, and names the first red run after the last green', () => {
    const runs = [
      run('failure', '2026-11-01T18:00:00Z', '1'.repeat(40)),
      run('failure', '2026-11-01T17:00:00Z', '2'.repeat(40)),
      run('failure', '2026-11-01T16:00:00Z', '3'.repeat(40)),
      run('failure', '2026-11-01T15:00:00Z', '4'.repeat(40)),
      run('success', '2026-11-01T14:00:00Z', '5'.repeat(40)),
    ]
    const health = mainHealth(runs)
    expect(health.green).toBe(false)
    expect(health.reason).toMatch(/^main red since 4444444 \(https:\/\/github\.com\/o\/r\/actions\/runs\/\d+\)$/)
  })

  it('fails closed: runs that could not be read, or none completed, are red', () => {
    expect(mainHealth(null)).toMatchObject({ green: false, reason: "main's CI runs could not be read" })
    expect(mainHealth([run('cancelled', '2026-11-01T18:00:00Z')])).toMatchObject({ green: false, reason: 'main has no completed CI run' })
  })
})

type Entry = { number: number; labeledAt: string; fixMain?: boolean; fixMainBy?: string | null }
function fakeApi(entries: Entry[], { mainRuns, roles = {} }: { mainRuns: () => Promise<unknown>; roles?: Record<string, string> }) {
  const writes: Array<[string, ...unknown[]]> = []
  const gone = (n: number) => writes.some(([w, x, label]) => (w === 'merge' || (w === 'removeLabel' && (label ?? LABEL) === LABEL)) && x === n)
  return {
    writes,
    listQueue: async () => entries.filter((e) => !gone(e.number)).map((e) => ({ labeledBy: 'maintainer', fixMain: false, fixMainBy: null, ...e })),
    getPull: async (number: number) => ({ ...pr(number), state: writes.some(([w, x]) => w === 'merge' && x === number) ? 'closed' : 'open' }),
    behindBy: async () => 0,
    docsOnlySince: async () => false,
    changesRequested: async () => false,
    listRuns: async () => [ciRun],
    listChecks: async () => [check('CI result')],
    requiredChecks: async () => [],
    collaboratorRole: async (login: string) => roles[login] ?? 'write',
    listComments: async () => [],
    createComment: async (number: number, body: string) => {
      writes.push(['comment', number, body])
      return { id: 1, body, byTrain: true }
    },
    updateComment: async () => {},
    removeLabel: async (number: number, label?: string) => {
      writes.push(['removeLabel', number, label ?? LABEL])
    },
    merge: async (number: number) => {
      writes.push(['merge', number])
    },
    dispatchWorkflow: async (file: string, ref: string) => {
      writes.push(['dispatch', file, ref])
    },
    mainRuns,
  }
}
const red = async () => [run('failure', '2026-11-01T18:00:00Z')]
const queue = (): Entry[] => [
  { number: 1, labeledAt: '2026-11-01T10:00:00Z' },
  { number: 2, labeledAt: '2026-11-01T11:00:00Z', fixMain: true, fixMainBy: 'owner' },
]
type Action = { type: string; number?: number; message: string }

describe('the hold while main is red', () => {
  it('is off by default: the queue moves in label order whatever main looks like', async () => {
    const api = fakeApi(queue(), { mainRuns: red, roles: { owner: 'admin' } })
    const actions = await runTrain(api, { now: NOW })
    expect(actions.map((a: Action) => [a.type, a.number])).toEqual([['merge', 1], ['merge', 2], ['idle', undefined]])
  })

  it("when on, merges only a maintainer's fix-main car, removes that label, then holds the rest without a comment", async () => {
    const api = fakeApi(queue(), { mainRuns: red, roles: { owner: 'admin' } })
    const actions = await runTrain(api, { now: NOW, holdWhenMainRed: true })
    expect(actions.map((a: Action) => [a.type, a.number])).toEqual([['merge', 2], ['hold', undefined]])
    expect(actions[1].message).toMatch(/^held: main red since c{7} .*1 car\(s\) wait; a car labelled fix-main/)
    expect(api.writes.filter(([w]) => w === 'merge' || w === 'removeLabel')).toEqual([['merge', 2], ['removeLabel', 2, FIX_MAIN_LABEL]])
    expect(api.writes.some(([w, n]) => w === 'comment' && n === 1)).toBe(false)
  })

  it('a fix-main label added by someone with only write access does not pass the hold', async () => {
    const api = fakeApi(queue(), { mainRuns: red, roles: { owner: 'write' } })
    const actions = await runTrain(api, { now: NOW, holdWhenMainRed: true })
    expect(actions.map((a: Action) => a.type)).toEqual(['hold'])
    expect(api.writes.filter(([w]) => w === 'merge')).toEqual([])
  })

  it("holds when main's runs cannot be read, and moves normally once main is green", async () => {
    const broken = fakeApi(queue(), { mainRuns: async () => Promise.reject(new Error('500')) })
    expect((await runTrain(broken, { now: NOW, holdWhenMainRed: true })).map((a: Action) => a.type)).toEqual(['hold'])
    const green = fakeApi(queue(), { mainRuns: async () => [run('success', '2026-11-01T18:00:00Z')] })
    const actions = await runTrain(green, { now: NOW, holdWhenMainRed: true })
    expect(actions.map((a: Action) => [a.type, a.number])).toEqual([['merge', 1], ['merge', 2], ['idle', undefined]])
  })
})

describe('the GitHub calls behind the hold', () => {
  const respond = (data: unknown) => ({ ok: true, status: 204, json: async () => data, text: async () => '', headers: { get: () => '' } })

  it("reads main's own ci.yml runs only: no packaged smoke, publish, other branch or fork", async () => {
    const raw = (id: number, event: string, title: string, over: Record<string, unknown> = {}) => ({
      id, event, display_title: title, name: title, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'failure',
      head_branch: 'main', head_sha: HEAD, head_repository: { full_name: 'o/r' }, html_url: `https://github.com/o/r/actions/runs/${id}`, created_at: '2026-11-01T18:00:00Z', ...over,
    })
    const runs = [
      raw(1, 'push', 'Push · main'),
      raw(2, 'workflow_dispatch', 'Full check · main'),
      raw(3, 'workflow_dispatch', `Packaged smoke · ${HEAD}`),
      raw(4, 'workflow_dispatch', 'Publish v1.4.0 · main'),
      raw(5, 'push', 'Push · main', { head_repository: { full_name: 'fork/r' } }),
      raw(6, 'pull_request', 'PR #9 · x'),
    ]
    const urls: string[] = []
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl: async (url: string) => (urls.push(url), { ...respond({ workflow_runs: runs }), status: 200 }) })
    expect((await api.mainRuns()).map((r: { id: number }) => r.id)).toEqual([1, 2])
    expect(urls).toEqual(['https://api.github.com/repos/o/r/actions/workflows/ci.yml/runs?branch=main&per_page=30'])
  })

  it('lists who added fix-main, and removes only the train labels', async () => {
    const fetchImpl = async (url: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') return respond(null)
      if (url.includes('/events')) {
        return { ...respond([{ event: 'labeled', label: { name: LABEL }, actor: { login: 'dev' }, created_at: '2026-11-01T10:00:00Z' }, { event: 'labeled', label: { name: FIX_MAIN_LABEL }, actor: { login: 'owner' }, created_at: '2026-11-01T11:00:00Z' }]), status: 200 }
      }
      return { ...respond([{ number: 9, pull_request: {}, labels: [{ name: LABEL }, { name: FIX_MAIN_LABEL }] }]), status: 200 }
    }
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl })
    expect(await api.listQueue()).toEqual([{ number: 9, labeledAt: '2026-11-01T10:00:00Z', labeledBy: 'dev', fixMain: true, fixMainBy: 'owner' }])
    await expect(api.removeLabel(9, FIX_MAIN_LABEL)).resolves.toBeUndefined()
    await expect(api.removeLabel(9, 'bug')).rejects.toThrow(/not a train label/)
  })
})
