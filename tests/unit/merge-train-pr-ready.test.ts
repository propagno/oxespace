// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CI_WORKFLOW,
  isTrainUpdate,
  PR_READY_CONTEXT,
  prReadyCheck,
  SKIP_CI_NOTE,
  step,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-11-08T12:00:00Z')
const LABELED = '2026-11-08T10:00:00Z'
const sha = (c: string) => c.repeat(40)
type Commit = { sha: string; message: string; parents: string[]; date: string }
type Status = { context: string; state: string; createdAt: string }

/** A fake GitHub with commits and statuses only: what prReadyCheck reads. */
function fake(commits: Commit[], statuses: Record<string, Status[]> = {}) {
  const bySha = new Map(commits.map(c => [c.sha, c]))
  return {
    async getCommit(s: string) { return bySha.get(s)! },
    async commitStatuses(s: string) { return statuses[s] ?? [] },
  }
}
const authored = (c: string, date: string, parent = sha('0')): Commit => ({ sha: sha(c), message: 'feat: something', parents: [parent], date })
const trainUpdate = (c: string, onto: string, date = '2026-11-08T11:30:00Z'): Commit => ({ sha: sha(c), message: `Merge branch 'main' into topic\n\n${SKIP_CI_NOTE}`, parents: [onto, sha('9')], date })
const green = (at = '2026-11-08T11:00:00Z'): Status[] => [{ context: PR_READY_CONTEXT, state: 'success', createdAt: at }]
const pr = (head: string, headRef = 'topic') => ({ headSha: head, headRef })

describe('which commits are the train\'s own updates', () => {
  it('is a two-parent "Merge branch" commit carrying the skip-ci note, nothing else', () => {
    expect(isTrainUpdate(trainUpdate('b', sha('a')))).toBe(true)
    expect(isTrainUpdate({ ...trainUpdate('b', sha('a')), parents: [sha('a')] })).toBe(false)
    expect(isTrainUpdate({ ...trainUpdate('b', sha('a')), message: "Merge branch 'main' into topic" })).toBe(false)
    expect(isTrainUpdate(authored('a', LABELED))).toBe(false)
  })
})

describe('a head pushed after the label needs a green pr:ready (TECH LEAD (b), 08/11)', () => {
  it('does not check a head from before the label: the hook checked it when the label went on', async () => {
    expect(await prReadyCheck(fake([authored('a', '2026-11-08T09:00:00Z')]), pr(sha('a')), LABELED)).toMatchObject({ required: false })
  })

  it('checks a head pushed after the label: green passes, missing fails', async () => {
    const commits = [authored('a', '2026-11-08T11:00:00Z')]
    expect(await prReadyCheck(fake(commits, { [sha('a')]: green() }), pr(sha('a')), LABELED)).toEqual({ required: true, ok: true, sha: sha('a') })
    expect(await prReadyCheck(fake(commits), pr(sha('a')), LABELED)).toEqual({ required: true, ok: false, sha: sha('a') })
  })

  it('reads the latest pr:ready status, and no other context', async () => {
    const commits = [authored('a', '2026-11-08T11:00:00Z')]
    const later = { [sha('a')]: [...green('2026-11-08T11:00:00Z'), { context: PR_READY_CONTEXT, state: 'failure', createdAt: '2026-11-08T11:10:00Z' }] }
    expect((await prReadyCheck(fake(commits, later), pr(sha('a')), LABELED)).ok).toBe(false)
    const other = { [sha('a')]: [{ context: 'CI result', state: 'success', createdAt: '2026-11-08T11:00:00Z' }] }
    expect((await prReadyCheck(fake(commits, other), pr(sha('a')), LABELED)).ok).toBe(false)
  })

  it('looks through the train\'s own update merges to the author\'s commit', async () => {
    // The train merged main into a car labelled with a pre-label head: still nothing to check.
    const before = [authored('a', '2026-11-08T09:00:00Z'), trainUpdate('b', sha('a'))]
    expect(await prReadyCheck(fake(before), pr(sha('b')), LABELED)).toMatchObject({ required: false, sha: sha('a') })
    // An author's post-label commit under a train update: checked on the author's commit, not the merge.
    const after = [authored('a', '2026-11-08T11:00:00Z'), trainUpdate('b', sha('a'))]
    expect(await prReadyCheck(fake(after, { [sha('a')]: green() }), pr(sha('b')), LABELED)).toEqual({ required: true, ok: true, sha: sha('a') })
    expect((await prReadyCheck(fake(after), pr(sha('b')), LABELED)).ok).toBe(false)
  })

  it('leaves batch PRs, unlabelled entries and an API without statuses alone', async () => {
    const commits = [authored('a', '2026-11-08T11:00:00Z')]
    expect(await prReadyCheck(fake(commits), pr(sha('a'), 'train/batch-7'), LABELED)).toEqual({ required: false })
    expect(await prReadyCheck(fake(commits), pr(sha('a')), null)).toEqual({ required: false })
    expect(await prReadyCheck({ async getCommit() { return commits[0] } }, pr(sha('a')), LABELED)).toEqual({ required: false })
  })
})

describe('the train step with the pr:ready check', () => {
  const HEAD = sha('a')
  const base = (prReady: unknown) => ({
    pr: { number: 7, state: 'open', draft: false, isFork: false, headSha: HEAD, headRef: 'topic', mergeable: true, mergeableState: 'clean', changesRequested: false, labeledAt: LABELED, labeledBy: 'maintainer', labelerAllowed: true },
    behindBy: 0,
    runs: [{ name: CI_WORKFLOW, path: '.github/workflows/ci.yml', headSha: HEAD, status: 'completed', conclusion: 'success', createdAt: '2026-11-08T11:10:00Z' }],
    checks: [{ name: 'CI result', headSha: HEAD, status: 'completed', conclusion: 'success' }],
    requiredChecks: [],
    trainState: null,
    prReady,
    now: NOW,
    timeoutMinutes: 60,
  })

  it('drops a car whose post-label head has no green pr:ready, saying how to get back in', () => {
    const action = step(base({ required: true, ok: false, sha: HEAD }))
    expect(action.type).toBe('unlabel')
    expect(action.message).toMatch(/aaaaaaa was pushed after the label and has no green pr:ready/)
    expect(action.message).toMatch(/npm run pr:ready/)
  })

  it('waits, without dropping or merging, when the status cannot be read', () => {
    expect(step(base({ required: true, ok: null, sha: HEAD })).type).toBe('wait')
  })

  it('merges as before when the head passed pr:ready or needs no check', () => {
    expect(step(base({ required: true, ok: true, sha: HEAD })).type).toBe('merge')
    expect(step(base({ required: false })).type).toBe('merge')
    expect(step(base(undefined)).type).toBe('merge')
  })
})
