// @vitest-environment node
// The release hold (agents maturity M6): while an open issue or PR carries release-hold, the train makes no move.
import { describe, expect, it } from 'vitest'
import {
  CI_WORKFLOW,
  LABEL,
  RELEASE_HOLD_LABEL,
  createGitHubApi,
  dryRunApi,
  runTrain,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-11-08T19:00:00Z')
const HEAD = 'a'.repeat(40)
const ciRun = { name: CI_WORKFLOW, path: '.github/workflows/ci.yml', headSha: HEAD, status: 'completed', conclusion: 'success', createdAt: '2026-11-08T18:00:00Z' }
const pr = (number: number) => ({ number, state: 'open', draft: false, isFork: false, headSha: HEAD, headRef: `feat/${number}`, mergeable: true, mergeableState: 'clean' })
type Hold = { number: number | null; title: string }
type Action = { type: string; number?: number; message: string }

function fakeApi(holds: (() => Promise<Hold[]>) | null) {
  const writes: unknown[][] = []
  const merged = (n: number) => writes.some(([w, x]) => w === 'merge' && x === n)
  return {
    writes,
    ...(holds ? { releaseHolds: holds } : {}),
    listQueue: async () => [1, 2].filter((n) => !merged(n)).map((number) => ({ number, labeledAt: `2026-11-08T1${number}:00:00Z`, labeledBy: 'maintainer', fixMain: false, fixMainBy: null })),
    getPull: async (number: number) => ({ ...pr(number), state: merged(number) ? 'closed' : 'open' }),
    behindBy: async () => 0,
    docsOnlySince: async () => false,
    changesRequested: async () => false,
    listRuns: async () => [ciRun],
    listChecks: async () => [{ name: 'CI result', headSha: HEAD, status: 'completed', conclusion: 'success' }],
    requiredChecks: async () => [],
    collaboratorRole: async () => 'admin',
    listComments: async () => [],
    createComment: async (number: number, body: string) => {
      writes.push(['comment', number, body])
      return { id: 1, body, byTrain: true }
    },
    updateComment: async () => {},
    removeLabel: async (number: number) => {
      writes.push(['removeLabel', number])
    },
    updateBranch: async (number: number) => {
      writes.push(['updateBranch', number])
    },
    merge: async (number: number) => {
      writes.push(['merge', number])
    },
    dispatchWorkflow: async (file: string, ref: string) => {
      writes.push(['dispatch', file, ref])
    },
    mainRuns: async () => [],
  }
}

describe('the release hold', () => {
  it('is the label release-hold', () => {
    expect(RELEASE_HOLD_LABEL).toBe('release-hold')
  })

  it('stops the train with no write while an issue or PR carries it, and keeps every car labelled', async () => {
    const api = fakeApi(async () => [{ number: 644, title: 'v1.4.3 release' }])
    const actions = await runTrain(api, { now: NOW, batches: true })
    expect(actions.map((a: Action) => a.type)).toEqual(['hold'])
    expect(actions[0].message).toBe(`held by ${RELEASE_HOLD_LABEL}: #644 (v1.4.3 release). 2 car(s) keep their place; the train goes on in order once the label comes off.`)
    expect(api.writes).toEqual([])
  })

  it('goes on in label order once the label comes off', async () => {
    const api = fakeApi(async () => [])
    const actions = await runTrain(api, { now: NOW })
    expect(actions.map((a: Action) => [a.type, a.number])).toEqual([['merge', 1], ['merge', 2], ['idle', undefined]])
  })

  it('holds when the label cannot be read: a release outranks a car', async () => {
    const api = fakeApi(async () => {
      throw new Error('HTTP 502')
    })
    const actions = await runTrain(api, { now: NOW })
    expect(actions.map((a: Action) => a.type)).toEqual(['hold'])
    expect(actions[0].message).toMatch(/^held by release-hold: the release-hold label could not be read\. 2 car\(s\)/)
    expect(api.writes).toEqual([])
  })

  it('reads nothing with an empty queue, and an API without the read moves as before', async () => {
    let reads = 0
    const empty = { ...fakeApi(async () => { reads++; return [{ number: 1, title: 'x' }] }), listQueue: async () => [] }
    expect((await runTrain(empty, { now: NOW })).map((a: Action) => a.type)).toEqual(['idle'])
    expect(reads).toBe(0)
    expect((await runTrain(fakeApi(null), { now: NOW })).map((a: Action) => a.type)).toEqual(['merge', 'merge', 'idle'])
  })

  it('reads open issues and PRs labelled release-hold from GitHub, and a dry run still reads it', async () => {
    const urls: string[] = []
    const fetchFn = async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify([{ number: 9, title: 'Release 1.5.0', pull_request: {} }, { number: 10, title: 'Gate F8' }]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl: fetchFn })
    expect(await api.releaseHolds()).toEqual([{ number: 9, title: 'Release 1.5.0' }, { number: 10, title: 'Gate F8' }])
    expect(urls[0]).toContain('/repos/o/r/issues?state=open&labels=release-hold')
    expect(await dryRunApi(api, () => {}).releaseHolds()).toHaveLength(2)
    expect(LABEL).toBe('na-fila')
  })
})
