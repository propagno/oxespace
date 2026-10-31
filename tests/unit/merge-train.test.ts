// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  CI_WORKFLOW,
  cleanName,
  DISPATCH_GRACE_MS,
  LABEL,
  PREFIX,
  TRAIN_JOB_NAME,
  createGitHubApi,
  orderQueue,
  parseTrainState,
  renderComment,
  runTrain,
  step,
  upsertComment,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const HEAD = 'a'.repeat(40)
const OLD = 'b'.repeat(40)
const minutes = (n: number) => n * 60_000
const iso = (ms: number) => new Date(ms).toISOString()

type Run = { name: string; path?: string; headSha: string; status: string; conclusion: string | null; htmlUrl?: string; createdAt?: string }
type Check = { name: string; headSha: string; status: string; conclusion: string | null; htmlUrl?: string; failedStep?: string | null }

const pr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'open',
  draft: false,
  isFork: false,
  headSha: HEAD,
  headRef: 'feat/x',
  mergeable: true,
  mergeableState: 'clean',
  changesRequested: false,
  labeledAt: '2026-10-31T11:00:00Z',
  labeledBy: 'maintainer',
  labelerAllowed: true,
  ...over,
})
const ciRun = (over: Partial<Run> = {}): Run => ({
  name: CI_WORKFLOW,
  path: '.github/workflows/ci.yml',
  headSha: HEAD,
  status: 'completed',
  conclusion: 'success',
  htmlUrl: 'https://github.com/o/r/actions/runs/1',
  createdAt: '2026-10-31T11:10:00Z',
  ...over,
})
const check = (name: string, over: Partial<Check> = {}): Check => ({ name, headSha: HEAD, status: 'completed', conclusion: 'success', ...over })
const greenChecks = () => [check('Changed paths'), check('Typecheck, test and build (Linux)'), check('OxeQuery live tests', { conclusion: 'skipped' })]

const input = (over: Record<string, unknown> = {}) => ({
  pr: pr(),
  behindBy: 0,
  runs: [ciRun()],
  checks: greenChecks(),
  requiredChecks: [],
  trainState: null,
  now: NOW,
  timeoutMinutes: 60,
  ...over,
})

describe('merge train step', () => {
  it('does nothing when no PR is labelled', () => {
    expect(step({ ...input(), pr: null }).type).toBe('idle')
  })

  it('takes a conflicting PR out of the queue with the cause', () => {
    const action = step(input({ pr: pr({ mergeable: false, mergeableState: 'dirty' }) }))
    expect(action.type).toBe('unlabel')
    expect(action.message).toMatch(/conflicts with main/)
    expect(step(input({ pr: pr({ mergeableState: 'dirty' }) })).type).toBe('unlabel')
  })

  it('takes a draft out of the queue', () => {
    const action = step(input({ pr: pr({ draft: true }) }))
    expect(action).toMatchObject({ type: 'unlabel' })
    expect(action.message).toMatch(/draft/)
  })

  it('takes a PR with changes requested, or from a fork, out of the queue', () => {
    expect(step(input({ pr: pr({ changesRequested: true }) })).message).toMatch(/requests changes/)
    expect(step(input({ pr: pr({ isFork: true }) })).message).toMatch(/branches of this repository/)
  })

  it('waits while GitHub computes mergeability', () => {
    expect(step(input({ pr: pr({ mergeable: null, mergeableState: 'unknown' }) })).type).toBe('wait')
  })

  it('updates a branch behind main and dispatches the CI that ran on it', () => {
    const action = step(
      input({
        behindBy: 3,
        runs: [ciRun(), ciRun({ name: 'Accessibility scan (axe)', path: '.github/workflows/a11y-axe.yml' }), ciRun({ name: 'x', path: '.github/workflows/provider-contract.yml' })],
      }),
    )
    expect(action.type).toBe('update')
    expect(action.expectedHead).toBe(HEAD)
    expect(action.dispatch).toEqual(['ci.yml', 'a11y-axe.yml'])
    expect(action.message).toMatch(/3 commits behind/)
  })

  it('always dispatches ci.yml after an update, even when nothing ran on the old head', () => {
    expect(step(input({ behindBy: 1, runs: [] })).dispatch).toEqual(['ci.yml'])
  })

  it('waits while CI on the current head is running', () => {
    expect(step(input({ runs: [ciRun({ status: 'in_progress', conclusion: null })] }))).toMatchObject({ type: 'wait' })
    const checks = [...greenChecks(), check('Typecheck, test and build (Windows)', { status: 'queued', conclusion: null })]
    const action = step(input({ checks }))
    expect(action.type).toBe('wait')
    expect(action.message).toMatch(/Windows/)
  })

  it('waits for an axe or memory run on the head to finish too', () => {
    const runs = [ciRun(), ciRun({ name: 'Accessibility scan (axe)', status: 'in_progress', conclusion: null })]
    expect(step(input({ runs })).message).toMatch(/Accessibility scan/)
  })

  it('takes a red PR out with the failing job, its link and its first failing step', () => {
    const checks = [
      ...greenChecks(),
      check('Typecheck, test and build (Windows)', { conclusion: 'failure', htmlUrl: 'https://github.com/o/r/runs/9', failedStep: 'Unit tests' }),
    ]
    const action = step(input({ checks, runs: [ciRun({ conclusion: 'failure' })] }))
    expect(action.type).toBe('unlabel')
    expect(action.message).toContain('"Typecheck, test and build (Windows)" failure at step "Unit tests"')
    expect(action.message).toContain('https://github.com/o/r/runs/9')
  })

  it('takes a PR out when a watched run failed without a failing check', () => {
    const action = step(input({ runs: [ciRun({ conclusion: 'startup_failure' })] }))
    expect(action.type).toBe('unlabel')
    expect(action.message).toMatch(/startup_failure/)
  })

  it('never merges on a green run of an old head: it waits for CI on the current one', () => {
    const runs = [ciRun({ headSha: OLD })]
    const checks = greenChecks().map((c) => ({ ...c, headSha: OLD }))
    const action = step(input({ runs, checks }))
    expect(action.type).toBe('wait')
    expect(action.message).toMatch(/has not started/)
  })

  it('merges a green, up-to-date head, pinning the tested SHA', () => {
    expect(step(input())).toMatchObject({ type: 'merge', expectedHead: HEAD })
  })

  it('ignores skipped checks and the train job itself', () => {
    const checks = [...greenChecks(), check(TRAIN_JOB_NAME, { status: 'in_progress', conclusion: null }), check('Android', { conclusion: 'skipped' })]
    expect(step(input({ checks })).type).toBe('merge')
  })

  it('only gates on the required checks when branch protection names them', () => {
    const checks = [...greenChecks(), check('Optional', { conclusion: 'failure' })]
    expect(step(input({ checks, requiredChecks: ['Changed paths'] })).type).toBe('merge')
    expect(step(input({ requiredChecks: ['Missing check'] })).message).toMatch(/Missing check/)
  })

  it('uses the latest run of a check that ran twice on the head', () => {
    const checks = [check('Build', { conclusion: 'failure' }), check('Build')]
    const runs = [ciRun({ conclusion: 'failure', createdAt: '2026-10-31T11:00:00Z' }), ciRun({ createdAt: '2026-10-31T11:30:00Z' })]
    expect(step(input({ checks, runs })).type).toBe('merge')
  })

  it('takes a PR that waited too long for CI on its head out of the queue', () => {
    const trainState = { head: HEAD, since: iso(NOW - minutes(61)), labeledAt: pr().labeledAt }
    const action = step(input({ trainState, runs: [ciRun({ status: 'in_progress', conclusion: null })] }))
    expect(action.type).toBe('unlabel')
    expect(action.message).toMatch(/more than 60 minutes/)
    // Within the limit it keeps waiting, and the wait keeps its start.
    const fresh = step(input({ trainState: { ...trainState, since: iso(NOW - minutes(30)) }, runs: [ciRun({ status: 'queued', conclusion: null })] }))
    expect(fresh).toMatchObject({ type: 'wait', state: { since: iso(NOW - minutes(30)) } })
  })

  it('restarts the wait on a new head', () => {
    const trainState = { head: OLD, since: iso(NOW - minutes(90)), labeledAt: pr().labeledAt }
    const action = step(input({ trainState, runs: [ciRun({ status: 'in_progress', conclusion: null })] }))
    expect(action).toMatchObject({ type: 'wait', state: { head: HEAD, since: iso(NOW) } })
  })

  it('a label added again starts from scratch: an old state never times it out', () => {
    const trainState = { head: HEAD, since: iso(NOW - minutes(500)), labeledAt: '2026-10-30T09:00:00Z' }
    const action = step(input({ trainState, runs: [ciRun({ status: 'in_progress', conclusion: null })] }))
    expect(action).toMatchObject({ type: 'wait', state: { since: iso(NOW), labeledAt: pr().labeledAt } })
  })

  it('dispatches CI once when nothing started it on the head after the grace', () => {
    const labeledAt = pr().labeledAt
    const early = step(input({ runs: [], checks: [], trainState: { head: HEAD, since: iso(NOW - 1000), labeledAt } }))
    expect(early.type).toBe('wait')
    const late = step(input({ runs: [], checks: [], trainState: { head: HEAD, since: iso(NOW - DISPATCH_GRACE_MS), labeledAt } }))
    expect(late).toMatchObject({ type: 'dispatch', dispatch: ['ci.yml'], state: { dispatchedFor: HEAD } })
    const again = step(input({ runs: [], checks: [], trainState: late.state }))
    expect(again.type).toBe('wait')
  })
})

describe('queue order', () => {
  it('takes the oldest labelling first, then the lowest number', () => {
    const order = orderQueue([
      { number: 30, labeledAt: '2026-10-31T10:00:00Z' },
      { number: 12, labeledAt: '2026-10-31T11:00:00Z' },
      { number: 20, labeledAt: '2026-10-31T10:00:00Z' },
      { number: 5, labeledAt: null },
    ])
    expect(order.map((e: { number: number }) => e.number)).toEqual([20, 30, 12, 5])
  })

  it('counts a PR labelled twice once, at its latest labelling', () => {
    const order = orderQueue([
      { number: 1, labeledAt: '2026-10-31T09:00:00Z' },
      { number: 2, labeledAt: '2026-10-31T10:00:00Z' },
      { number: 1, labeledAt: '2026-10-31T11:00:00Z' },
    ])
    expect(order).toEqual([
      { number: 2, labeledAt: '2026-10-31T10:00:00Z' },
      { number: 1, labeledAt: '2026-10-31T11:00:00Z' },
    ])
  })
})

describe('train comment', () => {
  it('round-trips its state and starts with the stable prefix', () => {
    const body = renderComment('waiting: x.', { head: HEAD, since: iso(NOW), labeledAt: null })
    expect(body.startsWith(`${PREFIX} waiting: x.`)).toBe(true)
    expect(parseTrainState(body, NOW)).toEqual({ head: HEAD, since: iso(NOW), labeledAt: null })
    expect(parseTrainState('no state')).toBeNull()
    expect(parseTrainState('<!-- merge-train-state {nope} -->')).toBeNull()
  })
})

// A fake GitHub: PRs with their checks, and a log of every write.
function fakeApi(prs: Array<{ number: number; labeledAt: string | null; pr?: Record<string, unknown>; behindBy?: number; runs?: Run[]; checks?: Check[] }>) {
  const writes: Array<[string, ...unknown[]]> = []
  const comments = new Map<number, Array<{ id: number; body: string; byTrain: boolean }>>()
  let nextId = 1
  const find = (number: number) => prs.find((p) => p.number === number)!
  const api = {
    writes,
    comments,
    afterUpdate: (_n: number) => {},
    async listQueue() {
      return prs.filter((p) => !writes.some(([w, n]) => (w === 'removeLabel' || w === 'merge') && n === p.number)).map(({ number, labeledAt }) => ({ number, labeledAt, labeledBy: 'maintainer' }))
    },
    async getPull(number: number) {
      const p = find(number)
      return { ...pr({ number }), ...p.pr, state: writes.some(([w, n]) => w === 'merge' && n === number) ? 'closed' : 'open' }
    },
    async behindBy(sha: string) {
      return prs.find((p) => (p.pr?.headSha ?? HEAD) === sha)?.behindBy ?? 0
    },
    async changesRequested() {
      return false
    },
    async listRuns(sha: string) {
      return prs.flatMap((p) => p.runs ?? [ciRun()]).filter((r) => r.headSha === sha)
    },
    async listChecks(sha: string) {
      return prs.flatMap((p) => p.checks ?? greenChecks()).filter((c) => c.headSha === sha)
    },
    async requiredChecks() {
      return []
    },
    async collaboratorRole(_login: string): Promise<string | null> {
      return 'write'
    },
    async listComments(number: number) {
      return [{ id: 999, body: `${PREFIX} a person quoting the train`, byTrain: false }, ...(comments.get(number) ?? [])]
    },
    async createComment(number: number, body: string) {
      writes.push(['createComment', number, body])
      const comment = { id: nextId++, body, byTrain: true }
      comments.set(number, [...(comments.get(number) ?? []), comment])
      return comment
    },
    async updateComment(id: number, body: string) {
      writes.push(['updateComment', id, body])
      for (const list of comments.values()) for (const c of list) if (c.id === id) c.body = body
    },
    async removeLabel(number: number) {
      writes.push(['removeLabel', number])
    },
    async updateBranch(number: number, sha: string) {
      writes.push(['updateBranch', number, sha])
      api.afterUpdate(number)
    },
    async merge(number: number, sha: string) {
      writes.push(['merge', number, sha])
    },
    async dispatchWorkflow(file: string, ref: string) {
      writes.push(['dispatch', file, ref])
    },
  }
  return api
}

const noSleep = async () => {}

describe('running the train against a fake API', () => {
  it('merges the green PRs in label order and dispatches main CI after each', async () => {
    const api = fakeApi([
      { number: 2, labeledAt: '2026-10-31T10:00:00Z', pr: { headSha: 'c'.repeat(40) }, runs: [ciRun({ headSha: 'c'.repeat(40) })], checks: [check('Build', { headSha: 'c'.repeat(40) })] },
      { number: 1, labeledAt: '2026-10-31T09:00:00Z' },
    ])
    const actions = await runTrain(api, { now: NOW, sleep: noSleep })
    expect(actions.map((a: { type: string; number?: number }) => [a.type, a.number])).toEqual([
      ['merge', 1],
      ['merge', 2],
      ['idle', undefined],
    ])
    expect(api.writes.filter(([w]) => w === 'merge' || w === 'dispatch')).toEqual([
      ['merge', 1, HEAD],
      ['dispatch', 'ci.yml', 'main'],
      ['merge', 2, 'c'.repeat(40)],
      ['dispatch', 'ci.yml', 'main'],
    ])
  })

  it('stops at a red PR only after taking it out, then serves the next', async () => {
    const api = fakeApi([
      { number: 1, labeledAt: '2026-10-31T09:00:00Z', checks: [check('Build', { conclusion: 'failure', failedStep: 'Lint' })], runs: [ciRun({ conclusion: 'failure' })] },
      { number: 2, labeledAt: '2026-10-31T10:00:00Z', pr: { headSha: OLD }, behindBy: 2 },
    ])
    const actions = await runTrain(api, { now: NOW, sleep: noSleep, headPolls: 2 })
    expect(actions.map((a: { type: string }) => a.type)).toEqual(['unlabel', 'update'])
    expect(api.writes).toContainEqual(['removeLabel', 1])
    expect(api.writes).toContainEqual(['updateBranch', 2, OLD])
    // The head never moved in the fake, so nothing was dispatched on the old head; the next run does it.
    expect(api.writes.some(([w, file]) => w === 'dispatch' && file === 'ci.yml')).toBe(false)
    const comment = api.comments.get(1)![0].body
    expect(comment).toMatch(/^merge-train: left the queue: "Build" failure at step "Lint"/)
  })

  it('dispatches CI on the branch once the update gave it a new head', async () => {
    const prs = [{ number: 3, labeledAt: '2026-10-31T09:00:00Z', pr: { headSha: OLD } as Record<string, unknown>, behindBy: 1 }]
    const api = fakeApi(prs)
    api.afterUpdate = () => {
      prs[0].pr = { headSha: HEAD }
    }
    await runTrain(api, { now: NOW, sleep: noSleep })
    expect(api.writes).toContainEqual(['dispatch', 'ci.yml', 'feat/x'])
    expect(parseTrainState(api.comments.get(3)![0].body, NOW)).toMatchObject({ head: HEAD, dispatchedFor: HEAD })
  })

  it('keeps one comment per PR, edits it, and never touches a person’s comment', async () => {
    const api = fakeApi([{ number: 4, labeledAt: '2026-10-31T09:00:00Z', runs: [ciRun({ status: 'in_progress', conclusion: null })] }])
    await runTrain(api, { now: NOW, sleep: noSleep })
    await runTrain(api, { now: NOW + minutes(5), sleep: noSleep })
    expect(api.writes.filter(([w]) => w === 'createComment')).toHaveLength(1)
    // Same wait, same text: the second run wrote nothing.
    expect(api.writes.filter(([w]) => w === 'updateComment')).toHaveLength(0)
    await runTrain(api, { now: NOW + minutes(61), sleep: noSleep })
    expect(api.writes.filter(([w]) => w === 'updateComment')).toEqual([['updateComment', 1, expect.stringMatching(/more than 60 minutes/)]])
    expect(api.writes).toContainEqual(['removeLabel', 4])
    expect(api.writes.some(([, id]) => id === 999)).toBe(false)
  })

  it('a label event delivered twice changes nothing the second time', async () => {
    const api = fakeApi([{ number: 5, labeledAt: '2026-10-31T09:00:00Z', runs: [ciRun({ status: 'queued', conclusion: null })] }])
    await runTrain(api, { now: NOW, sleep: noSleep })
    const before = api.writes.length
    await runTrain(api, { now: NOW, sleep: noSleep })
    expect(api.writes.length).toBe(before)
  })

  it('never merges when main moved between the check and the merge', async () => {
    const api = fakeApi([{ number: 6, labeledAt: '2026-10-31T09:00:00Z' }])
    let calls = 0
    api.behindBy = async () => (calls++ === 0 ? 0 : 1)
    const actions = await runTrain(api, { now: NOW, sleep: noSleep, headPolls: 1 })
    expect(api.writes.some(([w]) => w === 'merge')).toBe(false)
    expect(actions.map((a: { type: string }) => a.type)).toEqual(['merge', 'update'])
  })

  it('takes a PR out when GitHub refuses the merge of a workflow change', async () => {
    const api = fakeApi([{ number: 8, labeledAt: '2026-10-31T09:00:00Z' }])
    api.merge = async () => {
      throw Object.assign(new Error('refusing to allow a GitHub App to create or update workflow without `workflows` permission'), { status: 405 })
    }
    const actions = await runTrain(api, { now: NOW, sleep: noSleep })
    expect(actions.map((a: { type: string }) => a.type)).toEqual(['merge', 'unlabel', 'idle'])
    expect(api.comments.get(8)![0].body).toMatch(/\.github\/workflows/)
  })
})

describe('GitHub API adapter', () => {
  it('reads the label time, pages, and merges with a merge commit pinned to the head', async () => {
    const calls: Array<[string, string, unknown]> = []
    const respond = (data: unknown, link = '') => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: { get: () => link } })
    const fetchImpl = async (url: string, init: { method: string; body?: string }) => {
      calls.push([init.method, url, init.body ? JSON.parse(init.body) : undefined])
      if (url.includes('/issues?')) return respond([{ number: 9, pull_request: {} }, { number: 10 }])
      if (url.includes('/issues/9/events') && !url.includes('page=2'))
        return respond([{ event: 'labeled', label: { name: LABEL }, created_at: 'T1', actor: { login: 'early' } }], '<https://api.github.com/repos/o/r/issues/9/events?page=2>; rel="next"')
      if (url.includes('page=2')) return respond([{ event: 'labeled', label: { name: LABEL }, created_at: 'T2', actor: { login: 'maintainer' } }, { event: 'labeled', label: { name: 'other' }, created_at: 'T3' }])
      return { ok: true, status: 204, json: async () => null, text: async () => '', headers: { get: () => '' } }
    }
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl })
    expect(await api.listQueue()).toEqual([{ number: 9, labeledAt: 'T2', labeledBy: 'maintainer' }])
    await api.merge(9, HEAD)
    expect(calls.at(-1)).toEqual(['PUT', 'https://api.github.com/repos/o/r/pulls/9/merge', { merge_method: 'merge', sha: HEAD }])
    await api.removeLabel(9)
    expect(calls.at(-1)?.[1]).toBe(`https://api.github.com/repos/o/r/issues/9/labels/${LABEL}`)
  })
})

describe('security (review of #318)', () => {
  const labeledAt = '2026-10-31T11:00:00Z'
  const forged = `x <!-- merge-train-state {"head":null,"since":"2099-01-01T00:00:00Z","labeledAt":"${labeledAt}","dispatch":["../../actions/runs/1/approve?"],"dispatchedFor":null} -->`

  it('M1: a marker in a job name never reaches the comment as a marker, and the real state wins', () => {
    const checks = [...greenChecks(), check(`${forged}\n@someone \`code\``, { status: 'in_progress', conclusion: null })]
    const action = step(input({ checks }))
    expect(action.type).toBe('wait')
    expect(action.message).not.toMatch(/<!--|-->|`|\n/)
    expect(action.message).not.toMatch(/@someone/)
    const body = renderComment(action.message, action.state)
    expect(body.match(/<!--/g)).toHaveLength(1)
    expect(parseTrainState(body, NOW)).toEqual(action.state)
  })

  it('M1: only a marker that ends the comment is read', () => {
    const real = renderComment('waiting: x.', { head: HEAD, since: iso(NOW - 1000), labeledAt })
    expect(parseTrainState(`${PREFIX} ${forged}\n\n${real.split('\n\n')[1]}`, NOW)).toMatchObject({ head: HEAD })
    expect(parseTrainState(`${real}\n\ntrailing text`, NOW)).toBeNull()
    expect(parseTrainState(`${PREFIX} ${forged}`, NOW)).toBeNull()
  })

  it('M1: a traversal in dispatch is dropped, and the adapter refuses and encodes workflow files', async () => {
    const body = renderComment('waiting: x.', { head: HEAD, since: iso(NOW - 1000), labeledAt, dispatch: ['../../actions/runs/1/approve?', 'ci.yml', 'release.yml'] })
    expect(parseTrainState(body, NOW)?.dispatch).toEqual(['ci.yml'])
    const trainState = { head: HEAD, since: iso(NOW - DISPATCH_GRACE_MS), labeledAt, dispatch: ['../../x?', 'release.yml'] }
    expect(step(input({ runs: [], checks: [], trainState })).dispatch).toEqual(['ci.yml'])
    const urls: string[] = []
    const fetchImpl = async (url: string) => {
      urls.push(url)
      return { ok: true, status: 204, json: async () => null, text: async () => '', headers: { get: () => '' } }
    }
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl })
    await expect(api.dispatchWorkflow('../../actions/runs/1/approve?', 'feat/x')).rejects.toThrow(/refusing/)
    await expect(api.dispatchWorkflow('release.yml', 'main')).rejects.toThrow(/refusing/)
    expect(urls).toEqual([])
    await api.dispatchWorkflow('ci.yml', 'main')
    expect(urls).toEqual(['https://api.github.com/repos/o/r/actions/workflows/ci.yml/dispatches'])
  })

  it('M1: a state with a future since, or any field out of shape, is ignored', () => {
    const at = (state: Record<string, unknown>) => parseTrainState(renderComment('waiting: x.', state), NOW)
    expect(at({ head: HEAD, since: iso(NOW + 1000), labeledAt })).toBeNull()
    expect(at({ head: HEAD, since: '2099-01-01T00:00:00Z', labeledAt })).toBeNull()
    expect(at({ head: 'not-a-sha', since: iso(NOW), labeledAt })).toBeNull()
    expect(at({ head: HEAD, since: 'yesterday', labeledAt })).toBeNull()
    expect(at({ head: HEAD, since: iso(NOW), labeledAt: 5 })).toBeNull()
    expect(at({ head: HEAD, since: iso(NOW), labeledAt, dispatch: 'ci.yml' })).toBeNull()
    expect(at({ head: HEAD, since: iso(NOW), labeledAt, dispatchedFor: '../x' })).toBeNull()
    expect(at({ head: HEAD, since: iso(NOW), labeledAt })).toEqual({ head: HEAD, since: iso(NOW), labeledAt })
  })

  it('M1: a failure link off GitHub and a hostile step name are cleaned', () => {
    const checks = [check('Build', { conclusion: 'failure', htmlUrl: 'javascript:alert(1)', failedStep: '<!-- x --> `rm`\nnext' })]
    const action = step(input({ checks }))
    expect(action.message).not.toContain('javascript:')
    expect(action.message).toContain('at step "!-- x -- rm next"')
  })

  it('L1: only github-actions[bot] comments count as the train', async () => {
    const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: { get: () => '' } })
    const api = createGitHubApi({
      token: 't',
      repo: 'o/r',
      fetchImpl: async () =>
        respond([
          { id: 1, body: `${PREFIX} a`, user: { login: 'github-actions[bot]', type: 'Bot' }, performed_via_github_app: null },
          { id: 2, body: `${PREFIX} b`, user: { login: 'other-app[bot]', type: 'Bot' } },
          { id: 3, body: `${PREFIX} c`, user: { login: 'github-actions[bot]', type: 'Bot' }, performed_via_github_app: { id: 42 } },
        ]),
    })
    expect((await api.listComments(1)).map((c: { byTrain: boolean }) => c.byTrain)).toEqual([true, false, false])
  })

  it('L2: runs from a fork or a non-PR event, and checks from another app, never count', async () => {
    const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: { get: () => '' } })
    const fetchImpl = async (url: string) => {
      if (url.includes('/actions/runs?'))
        return respond({
          workflow_runs: [
            { name: CI_WORKFLOW, head_sha: HEAD, event: 'pull_request', head_repository: { full_name: 'o/r' }, check_suite_id: 100 },
            { name: CI_WORKFLOW, head_sha: HEAD, event: 'pull_request', head_repository: { full_name: 'fork/r' }, check_suite_id: 200 },
            { name: CI_WORKFLOW, head_sha: HEAD, event: 'workflow_run', head_repository: { full_name: 'o/r' }, check_suite_id: 300 },
          ],
        })
      return respond({
        check_runs: [
          { name: 'Build', head_sha: HEAD, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, check_suite: { id: 100 } },
          { name: 'Build', head_sha: HEAD, status: 'completed', conclusion: 'success', app: { slug: 'evil-app' }, check_suite: { id: 100 } },
        ],
      })
    }
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl })
    expect(await api.listRuns(HEAD)).toHaveLength(1)
    expect(await api.listChecks(HEAD)).toHaveLength(1)
  })

  it('L-A: an Actions check of a fork PR run (or of a run that does not count) on the same SHA never counts', async () => {
    const respond = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => '', headers: { get: () => '' } })
    const fetchImpl = async (url: string) => {
      if (url.includes('/actions/runs?'))
        return respond({
          workflow_runs: [
            { name: CI_WORKFLOW, head_sha: HEAD, event: 'pull_request', head_repository: { full_name: 'o/r' }, check_suite_id: 100 },
            { name: CI_WORKFLOW, head_sha: HEAD, event: 'pull_request', head_repository: { full_name: 'fork/r' }, check_suite_id: 200 },
            { name: 'Other', head_sha: HEAD, event: 'workflow_run', head_repository: { full_name: 'o/r' }, check_suite_id: 300 },
          ],
        })
      return respond({
        check_runs: [
          { name: 'Build', head_sha: HEAD, status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' }, check_suite: { id: 100 } },
          { name: 'Build', head_sha: HEAD, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, check_suite: { id: 200 } },
          { name: 'Lint', head_sha: HEAD, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' }, check_suite: { id: 300 } },
          { name: 'Orphan', head_sha: HEAD, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } },
        ],
      })
    }
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl })
    const checks = await api.listChecks(HEAD)
    expect(checks.map((c: { name: string; conclusion: string }) => [c.name, c.conclusion])).toEqual([['Build', 'failure']])
  })

  it('L-B: bidi controls and zero-width characters are stripped from names', () => {
    const hidden = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff]
    const name = `Bu${String.fromCharCode(...hidden)}ild`
    expect(cleanName(name)).toBe('Build')
    expect(cleanName(`${String.fromCharCode(0x202e)}gnp.exe`)).toBe('gnp.exe')
    // The train's own mention break is added after the strip, so a mention stays broken.
    expect(cleanName('@someone')).toBe(`@${String.fromCharCode(0x200b)}someone`)
    const checks = [check(`Te${String.fromCharCode(0x202e)}st`, { status: 'in_progress', conclusion: null })]
    expect(step(input({ checks })).message).toContain('Test still running')
  })

  it('L3: a label added without write access takes the PR out of the queue', async () => {
    expect(step(input({ pr: pr({ labelerAllowed: false, labeledBy: 'drive-by' }) })).message).toMatch(/drive-by, who has no write access/)
    expect(step(input({ pr: pr({ labelerAllowed: false, labeledBy: null }) })).type).toBe('unlabel')
    for (const role of ['triage', 'read', null]) {
      const api = fakeApi([{ number: 11, labeledAt }])
      api.collaboratorRole = async () => role
      const actions = await runTrain(api, { now: NOW, sleep: noSleep })
      expect(actions[0].type).toBe('unlabel')
      expect(api.writes).toContainEqual(['removeLabel', 11])
    }
    const failing = fakeApi([{ number: 12, labeledAt }])
    failing.collaboratorRole = async () => {
      throw new Error('403')
    }
    expect((await runTrain(failing, { now: NOW, sleep: noSleep }))[0].type).toBe('unlabel')
    for (const role of ['write', 'maintain', 'admin']) {
      const api = fakeApi([{ number: 13, labeledAt }])
      api.collaboratorRole = async () => role
      expect((await runTrain(api, { now: NOW, sleep: noSleep }))[0].type).toBe('merge')
    }
  })
})

describe('merge-train workflow', () => {
  const workflow = load(readFileSync(join('.github', 'workflows', 'merge-train.yml'), 'utf8')) as {
    on: Record<string, unknown>
    concurrency: { group: string; 'cancel-in-progress': boolean }
    permissions: Record<string, string>
    jobs: Record<string, { name: string; permissions: Record<string, string>; steps: Array<{ run?: string }> }>
  }

  it('parses, runs serially and keeps its job name in sync with the script', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_run'])
    expect(workflow.concurrency).toEqual({ group: 'merge-train', 'cancel-in-progress': false })
    expect(workflow.jobs.train.name).toBe(TRAIN_JOB_NAME)
    expect(workflow.jobs.train.steps.some((s) => s.run === 'node scripts/merge-train.mjs')).toBe(true)
  })

  it('asks for only what it uses', () => {
    expect(workflow.permissions).toEqual({})
    expect(workflow.jobs.train.permissions).toEqual({ contents: 'write', 'pull-requests': 'write', checks: 'read', actions: 'write' })
  })
})
