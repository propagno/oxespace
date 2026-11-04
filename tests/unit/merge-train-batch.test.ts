// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  BATCH_START_MS,
  CI_WORKFLOW,
  NO_BATCH_LABEL,
  batchMessage,
  batchRefusal,
  createGitHubApi,
  dryRunApi,
  isBatchPath,
  nextBatchRef,
  recentBatchRefs,
  BATCH_REFS_READ,
  parseBatchMessage,
  runBatch,
  runTrain,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train.mjs'

const NOW = Date.parse('2026-11-04T12:00:00Z')
const BUILT = '2026-11-04T11:50:00Z'
const RUN_URL = 'https://github.com/o/r/actions/runs/77'

type Commit = { sha: string; message: string; parents: string[]; date: string }
type Pull = { headSha: string; files: string[]; state?: string; draft?: boolean; mergeable?: boolean | null; headRef?: string; mergedSha?: string }

/** A fake GitHub with real branches and merge commits, so the batch's state lives where it does on GitHub. */
function fakeGitHub(pulls: Record<number, Pull>, { queue = Object.keys(pulls).map(Number) }: { queue?: number[] } = {}) {
  let next = 0
  const newSha = () => (++next).toString(16).padStart(40, '0')
  const commits = new Map<string, Commit>()
  const add = (message: string, parents: string[]) => {
    const sha = newSha()
    commits.set(sha, { sha, message, parents, date: BUILT })
    return sha
  }
  const root = add('initial', [])
  const refs = new Map<string, string>([['main', root]])
  for (const p of Object.values(pulls)) commits.set(p.headSha, { sha: p.headSha, message: 'work', parents: [root], date: BUILT })
  const writes: Array<[string, ...unknown[]]> = []
  const comments = new Map<number, Array<{ id: number; body: string; byTrain: boolean }>>()
  const runs = new Map<string, Array<Record<string, unknown>>>()
  const checks = new Map<string, Array<Record<string, unknown>>>()
  const conflicts = new Set<string>()
  let commentId = 1
  const api = {
    writes,
    refs,
    commits,
    runs,
    checks,
    conflicts,
    comments,
    beforeMerge: (_n: number) => {},
    queue: () => queue.filter((n) => pulls[n].state !== 'closed').map((number, i) => ({ number, labeledAt: `2026-11-04T10:0${i}:00Z`, labeledBy: 'maintainer', fixMain: false, noBatch: writes.some(([w, l, label]) => w === 'addLabel' && l === number && label === NO_BATCH_LABEL) })),
    async listQueue() {
      return api.queue()
    },
    async getPull(number: number) {
      const p = pulls[number]
      return {
        number,
        state: p.state ?? 'open',
        draft: p.draft ?? false,
        isFork: false,
        headSha: p.headSha,
        headRef: p.headRef ?? `topic-${number}`,
        mergeable: p.mergeable === undefined ? true : p.mergeable,
        mergeableState: 'clean',
        changedFiles: p.files.length,
        merged: Boolean(p.mergedSha),
        mergeCommitSha: p.mergedSha ?? null,
      }
    },
    async listFiles(number: number) {
      return pulls[number].files
    },
    async collaboratorRole() {
      return 'write'
    },
    async changesRequested() {
      return false
    },
    async listBatchRefs() {
      return [...refs].filter(([name]) => name.startsWith('train/batch-')).map(([name, sha]) => ({ name, sha }))
    },
    async getCommit(sha: string) {
      return commits.get(sha)!
    },
    async branchSha(name: string) {
      return refs.get(name)!
    },
    async mainSha() {
      return refs.get('main')!
    },
    async createRef(name: string, sha: string) {
      writes.push(['createRef', name, sha])
      refs.set(name, sha)
    },
    async deleteRef(name: string) {
      writes.push(['deleteRef', name])
      refs.delete(name)
    },
    async mergeInto(name: string, head: string, message: string) {
      if (conflicts.has(head)) throw Object.assign(new Error('POST /merges: 409 Merge conflict'), { status: 409 })
      writes.push(['mergeInto', name, head])
      const sha = add(message, [refs.get(name)!, head])
      refs.set(name, sha)
      return { sha }
    },
    // Per call: 'ok' merges; '500' answers 500 without merging; '500-merged' merges and still answers 500.
    mergeAnswers: [] as Array<'ok' | '500' | '500-merged'>,
    async merge(number: number, head: string) {
      api.beforeMerge(number)
      writes.push(['merge', number, head])
      const answer = api.mergeAnswers.shift() ?? 'ok'
      if (answer === '500') throw Object.assign(new Error('PUT merge: 500'), { status: 500 })
      const sha = add(`Merge pull request #${number}`, [refs.get('main')!, head])
      refs.set('main', sha)
      pulls[number].state = 'closed'
      pulls[number].mergedSha = sha
      if (answer === '500-merged') throw Object.assign(new Error('PUT merge: 500'), { status: 500 })
      return { sha }
    },
    async postStatus(sha: string, status: Record<string, unknown>) {
      writes.push(['postStatus', sha, status])
    },
    async addLabel(number: number, label: string) {
      writes.push(['addLabel', number, label])
    },
    async dispatchWorkflow(file: string, ref: string) {
      writes.push(['dispatch', file, ref])
    },
    async listRuns(sha: string) {
      return runs.get(sha) ?? []
    },
    async listChecks(sha: string) {
      return checks.get(sha) ?? []
    },
    async listComments(number: number) {
      return comments.get(number) ?? []
    },
    async createComment(number: number, body: string) {
      writes.push(['comment', number, body])
      const c = { id: commentId++, body, byTrain: true }
      comments.set(number, [...(comments.get(number) ?? []), c])
      return c
    },
    async updateComment(id: number, body: string) {
      writes.push(['comment', id, body])
      for (const list of comments.values()) for (const c of list) if (c.id === id) c.body = body
    },
    async removeLabel(number: number) {
      writes.push(['removeLabel', number])
    },
  }
  return api
}

const head = (c: string) => c.repeat(40)
const docs = (n: number, c: string): Pull => ({ headSha: head(c), files: [`docs/notes-${n}.md`] })
const step = async (api: ReturnType<typeof fakeGitHub>, now = NOW) => {
  const actions: Array<{ type: string; message: string }> = []
  const log: string[] = []
  const took = await runBatch(api, api.queue(), { now, timeoutMinutes: 60, log: (l: string) => log.push(l), actions, canStart: true, sleep: async () => {} })
  return { took, actions, log }
}
const batchHead = (api: ReturnType<typeof fakeGitHub>) => api.refs.get('train/batch-1')!
const finishCi = (api: ReturnType<typeof fakeGitHub>, conclusion = 'success', ciResult = conclusion) => {
  const sha = batchHead(api)
  api.runs.set(sha, [{ name: CI_WORKFLOW, headSha: sha, status: 'completed', conclusion, htmlUrl: RUN_URL, createdAt: '2026-11-04T11:51:00Z' }])
  api.checks.set(sha, [{ name: 'CI result', headSha: sha, status: 'completed', conclusion: ciResult }])
}
const kinds = (api: ReturnType<typeof fakeGitHub>, ...names: string[]) => api.writes.filter(([w]) => names.includes(w))

describe('batch paths (TECH LEAD allowlist)', () => {
  it('takes docs, Markdown outside .github and app code, tests and e2e specs', () => {
    for (const path of ['docs/ci-cd.md', 'docs/screens/a.png', 'README.md', 'CHANGELOG.md', '.claude/notes.md', 'tests/unit/a.test.ts', 'tests/helpers/removeTempDir.ts', 'e2e/thread-view.spec.ts', 'e2e/visual/code-states.spec.ts'])
      expect(isBatchPath(path), path).toBe(true)
  })
  it('refuses workflows, packages, scripts, configs, app code and android', () => {
    for (const path of [
      '.github/workflows/ci.yml', '.github/PULL_REQUEST_TEMPLATE.md', 'package.json', 'package-lock.json', 'scripts/merge-train.mjs', 'scripts/README.md',
      'playwright.config.ts', 'playwright.visual.config.ts', 'vitest.config.ts', 'tests/vitest.config.mts', 'electron/main/index.ts', 'src/App.tsx', 'src/ui/README.md',
      'shared/x.ts', 'mobile/android/RELEASING.md', 'android/app/build.gradle', 'e2e/helpers/launch.ts', 'e2e/visual/__screenshots__/linux/a.png', '.claude/settings.json', 'THIRD_PARTY_NOTICES',
    ])
      expect(isBatchPath(path), path).toBe(false)
  })
  it('refuses odd paths', () => {
    for (const path of ['', '/docs/a.md', 'docs/../src/a.ts', 'docs\\a.md', 'docs//a.md', './docs/a.md', null, undefined, 3])
      expect(isBatchPath(path as string)).toBe(false)
  })
})

describe('batch bookkeeping', () => {
  it('reads back only its own batch number, and numbers after every batch branch', () => {
    const sha = head('a')
    expect(parseBatchMessage(batchMessage(4, 12, sha), 4)).toEqual({ number: 12, sha })
    expect(parseBatchMessage(batchMessage(4, 12, sha), 5)).toBeNull()
    expect(parseBatchMessage('Merge PR #12 into batch 4', 4)).toBeNull()
    expect(nextBatchRef(['train/batch-3', 'train/batch-12', 'train/batch-D', 'main'])).toBe(13)
    expect(nextBatchRef([])).toBe(1)
  })
  it('names why a PR stays out', () => {
    const pr = { state: 'open', draft: false, isFork: false, headRef: 'x', mergeable: true, mergeableState: 'clean', changedFiles: 1 }
    const ok = { pr, entry: {}, files: ['docs/a.md'], labelerAllowed: true, changesRequested: false }
    expect(batchRefusal(ok)).toBeNull()
    expect(batchRefusal({ ...ok, entry: { noBatch: true } })).toBe(NO_BATCH_LABEL)
    expect(batchRefusal({ ...ok, entry: { fixMain: true } })).toBe('fix-main')
    expect(batchRefusal({ ...ok, labelerAllowed: false })).toMatch(/write access/)
    expect(batchRefusal({ ...ok, pr: { ...pr, draft: true } })).toBe('draft')
    expect(batchRefusal({ ...ok, pr: { ...pr, headRef: 'train/batch-2' } })).toBe('is a batch')
    expect(batchRefusal({ ...ok, pr: { ...pr, mergeable: false } })).toBe('conflicts with main')
    expect(batchRefusal({ ...ok, changesRequested: true })).toBe('changes requested')
    expect(batchRefusal({ ...ok, pr: { ...pr, changedFiles: 2 } })).toBe('file list incomplete')
    expect(batchRefusal({ ...ok, pr: { ...pr, changedFiles: 2 }, files: ['docs/a.md', 'src/a.ts'] })).toBe('changes src/a.ts')
  })
})

describe('building a batch', () => {
  it('takes the batchable cars from a batchable first car, merges them onto main and starts CI on the branch', async () => {
    const api = fakeGitHub({ 1: docs(1, 'a'), 2: { headSha: head('b'), files: ['src/a.ts'] }, 3: { headSha: head('c'), files: ['tests/unit/x.test.ts', 'e2e/x.spec.ts'] } })
    const main = api.refs.get('main')
    const { took, actions } = await step(api)
    expect(took).toBe(true)
    expect(kinds(api, 'createRef', 'mergeInto', 'dispatch')).toEqual([
      ['createRef', 'train/batch-1', main],
      ['mergeInto', 'train/batch-1', head('a')],
      ['mergeInto', 'train/batch-1', head('c')],
      ['dispatch', 'ci.yml', 'train/batch-1'],
    ])
    expect(actions[0].message).toMatch(/built train\/batch-1 from main \w{7} with #1 #3/)
    expect(api.comments.get(1)![0].body).toMatch(/^merge-train: riding train\/batch-1 with #1 #3/)
    expect(api.comments.has(2)).toBe(false)
  })

  it('leaves the run to the serial train when the first car is not batchable, or only one car is', async () => {
    const appFirst = fakeGitHub({ 1: { headSha: head('a'), files: ['src/a.ts'] }, 2: docs(2, 'b'), 3: docs(3, 'c') })
    expect((await step(appFirst)).took).toBe(false)
    const alone = fakeGitHub({ 1: docs(1, 'a'), 2: { headSha: head('b'), files: ['package.json'] } })
    expect((await step(alone)).took).toBe(false)
    expect(appFirst.writes).toEqual([])
    expect(alone.writes).toEqual([])
  })

  it('stops at five cars', async () => {
    const pulls: Record<number, Pull> = {}
    for (let n = 1; n <= 7; n++) pulls[n] = docs(n, String(n))
    const api = fakeGitHub(pulls)
    await step(api)
    expect(kinds(api, 'mergeInto').map(([, , sha]) => sha)).toEqual(['1', '2', '3', '4', '5'].map(head))
  })

  it('leaves a conflicting member out, and builds nothing when fewer than two merge', async () => {
    const api = fakeGitHub({ 1: docs(1, 'a'), 2: docs(2, 'b'), 3: docs(3, 'c') })
    api.conflicts.add(head('b'))
    await step(api)
    expect(kinds(api, 'mergeInto').map(([, , sha]) => sha)).toEqual([head('a'), head('c')])
    const lonely = fakeGitHub({ 1: docs(1, 'a'), 2: docs(2, 'b') })
    lonely.conflicts.add(head('b'))
    expect((await step(lonely)).took).toBe(false)
    expect(kinds(lonely, 'deleteRef')).toEqual([['deleteRef', 'train/batch-1']])
    expect(lonely.refs.has('train/batch-1')).toBe(false)
  })

  it('a dry run logs the plan and writes nothing', async () => {
    const api = fakeGitHub({ 1: docs(1, 'a'), 2: docs(2, 'b') })
    const log: string[] = []
    const actions: Array<{ type: string; message: string }> = []
    await runBatch(dryRunApi(api, (l: string) => log.push(l)), api.queue(), { now: NOW, timeoutMinutes: 60, log: (l: string) => log.push(l), actions, canStart: true })
    expect(api.writes).toEqual([])
    expect(api.refs.has('train/batch-1')).toBe(false)
    expect(log.filter((l) => l.startsWith('[dry run] '))).toHaveLength(3)
    expect(actions[0].message).toMatch(/^would build train\/batch-1 .* post "CI result" on aaaaaaa and merge #1 .* then post "CI result" on bbbbbbb and merge #2/)
  })
})

describe('driving a batch', () => {
  const built = async (pulls: Record<number, Pull> = { 1: docs(1, 'a'), 2: docs(2, 'b') }) => {
    const api = fakeGitHub(pulls)
    await step(api)
    api.writes.length = 0
    return api
  }

  it('waits while CI runs, and writes nothing', async () => {
    const api = await built()
    const sha = batchHead(api)
    api.runs.set(sha, [{ name: CI_WORKFLOW, headSha: sha, status: 'in_progress', conclusion: null, htmlUrl: RUN_URL }])
    const { took, actions } = await step(api)
    expect(took).toBe(true)
    expect(actions[0].type).toBe('batch-wait')
    expect(api.writes).toEqual([])
  })

  it('green: posts the traceable status on each tested head and merges in order on the expected main', async () => {
    const api = await built()
    const base = api.refs.get('main')!
    finishCi(api)
    const { actions } = await step(api)
    expect(kinds(api, 'postStatus', 'merge', 'dispatch', 'deleteRef')).toEqual([
      ['postStatus', head('a'), { state: 'success', context: 'CI result', description: 'batch train/batch-1', targetUrl: RUN_URL }],
      ['merge', 1, head('a')],
      ['postStatus', head('b'), { state: 'success', context: 'CI result', description: 'batch train/batch-1', targetUrl: RUN_URL }],
      ['merge', 2, head('b')],
      ['dispatch', 'ci.yml', 'main'],
      ['deleteRef', 'train/batch-1'],
    ])
    // main is the base plus the members' merges, in the batch's order: the tested tree.
    const top = api.commits.get(api.refs.get('main')!)!
    expect(top.parents[1]).toBe(head('b'))
    expect(api.commits.get(top.parents[0])!.parents).toEqual([base, head('a')])
    expect(actions.at(-1)!.message).toBe('train/batch-1: merged #1 #2')
    expect(api.comments.get(2)!.at(-1)!.body).toMatch(/merged bbbbbbb in train\/batch-1: tested with #1 #2/)
  })

  it('main moved before the first merge: nothing merges and the members go on their own', async () => {
    const api = await built()
    finishCi(api)
    api.refs.set('main', head('f'))
    await step(api)
    expect(kinds(api, 'merge', 'postStatus')).toEqual([])
    expect(kinds(api, 'addLabel')).toEqual([['addLabel', 1, NO_BATCH_LABEL], ['addLabel', 2, NO_BATCH_LABEL]])
    expect(kinds(api, 'deleteRef')).toEqual([['deleteRef', 'train/batch-1']])
  })

  it('main moved between two merges: the rest stops', async () => {
    const api = await built({ 1: docs(1, 'a'), 2: docs(2, 'b'), 3: docs(3, 'c') })
    finishCi(api)
    api.beforeMerge = (n) => {
      if (n === 2) api.refs.set('main', head('f'))
    }
    // The move lands between the check and the merge of #2: the merge commit is not on the expected main.
    await step(api)
    expect(kinds(api, 'merge')).toEqual([['merge', 1, head('a')], ['merge', 2, head('b')]])
    expect(kinds(api, 'addLabel')).toEqual([['addLabel', 3, NO_BATCH_LABEL]])
    expect(api.comments.get(3)!.at(-1)!.body).toMatch(/did not land on/)
  })

  it('red CI: no status, no merge, every member back on its own with no-batch', async () => {
    const api = await built()
    finishCi(api, 'failure')
    await step(api)
    expect(kinds(api, 'postStatus', 'merge')).toEqual([])
    expect(kinds(api, 'addLabel')).toEqual([['addLabel', 1, NO_BATCH_LABEL], ['addLabel', 2, NO_BATCH_LABEL]])
    expect(api.comments.get(1)!.at(-1)!.body).toMatch(/given up|ended failure/)
    expect(api.refs.has('train/batch-1')).toBe(false)
  })

  it('a cancelled or skipped run never counts as green', async () => {
    for (const conclusion of ['cancelled', 'skipped', 'neutral', 'timed_out']) {
      const api = await built()
      finishCi(api, conclusion, 'success')
      await step(api)
      expect(kinds(api, 'postStatus', 'merge'), conclusion).toEqual([])
    }
  })

  it('re-checks the files at merge time: a member that now changes app code gets no status', async () => {
    const pulls = { 1: docs(1, 'a'), 2: docs(2, 'b') }
    const api = await built(pulls)
    finishCi(api)
    pulls[2].files = ['docs/notes-2.md', 'src/App.tsx']
    await step(api)
    expect(kinds(api, 'postStatus', 'merge')).toEqual([
      ['postStatus', head('a'), expect.objectContaining({ description: 'batch train/batch-1' })],
      ['merge', 1, head('a')],
    ])
    expect(kinds(api, 'addLabel')).toEqual([['addLabel', 2, NO_BATCH_LABEL]])
    expect(api.comments.get(2)!.at(-1)!.body).toMatch(/changes src\/App\.tsx, outside docs and tests/)
  })

  it('a 500 on a merge is retried once while main and the head are unchanged (batch-46)', async () => {
    const api = await built()
    finishCi(api)
    api.mergeAnswers = ['500', 'ok']
    const { actions } = await step(api)
    expect(kinds(api, 'merge')).toEqual([['merge', 1, head('a')], ['merge', 1, head('a')], ['merge', 2, head('b')]])
    expect(actions.at(-1)!.message).toBe('train/batch-1: merged #1 #2')
    expect(kinds(api, 'addLabel')).toEqual([])
  })

  it('a 500 after GitHub did merge counts the merge, and is not merged twice', async () => {
    const api = await built()
    finishCi(api)
    api.mergeAnswers = ['500-merged']
    const { actions } = await step(api)
    expect(kinds(api, 'merge')).toEqual([['merge', 1, head('a')], ['merge', 2, head('b')]])
    expect(actions.at(-1)!.message).toBe('train/batch-1: merged #1 #2')
  })

  it('two 500s send the members back on their own, nothing merged', async () => {
    const api = await built()
    finishCi(api)
    api.mergeAnswers = ['500', '500']
    await step(api)
    expect(kinds(api, 'merge')).toHaveLength(2)
    expect(api.commits.get(api.refs.get('main')!)!.message).toBe('initial')
    expect(kinds(api, 'addLabel')).toEqual([['addLabel', 1, NO_BATCH_LABEL], ['addLabel', 2, NO_BATCH_LABEL]])
  })

  it('a 500 is not retried when main moved meanwhile', async () => {
    const api = await built()
    finishCi(api)
    api.mergeAnswers = ['500']
    api.beforeMerge = () => api.refs.set('main', head('f'))
    await step(api)
    expect(kinds(api, 'merge')).toHaveLength(1)
    expect(kinds(api, 'addLabel')).toHaveLength(2)
  })

  it('a green run without a passing CI result is not green', async () => {
    const api = await built()
    finishCi(api, 'success', 'failure')
    await step(api)
    expect(kinds(api, 'merge')).toEqual([])
  })

  it('a member with a new head ends the batch without blaming the others', async () => {
    const pulls = { 1: docs(1, 'a'), 2: docs(2, 'b') }
    const api = await built(pulls)
    pulls[2].headSha = head('e')
    finishCi(api)
    await step(api)
    expect(kinds(api, 'merge', 'postStatus', 'addLabel')).toEqual([])
    expect(kinds(api, 'deleteRef')).toEqual([['deleteRef', 'train/batch-1']])
    expect(api.comments.get(1)!.at(-1)!.body).toMatch(/#2 changed/)
  })

  it('gives up when CI never starts', async () => {
    const api = await built()
    await step(api, NOW + BATCH_START_MS)
    expect(kinds(api, 'addLabel')).toHaveLength(2)
    expect(api.refs.has('train/batch-1')).toBe(false)
  })

  it('ignores a batch branch that is not the train’s (merge-batch.mjs builds those as PRs)', async () => {
    const api = fakeGitHub({ 1: { headSha: head('a'), files: ['src/a.ts'] } })
    const sha = head('d')
    api.commits.set(sha, { sha, message: 'Merge PR #9 into batch 4', parents: [api.refs.get('main')!, head('a')], date: BUILT })
    api.refs.set('train/batch-4', sha)
    expect((await step(api)).took).toBe(false)
    expect(api.writes).toEqual([])
  })

  it('reads only the newest batch branches, and still finds its own batch among dozens of stale ones', async () => {
    expect(recentBatchRefs([3, 45, 1, 12, 46, 2, 44].map((n) => ({ name: `train/batch-${n}`, sha: 'x' })).concat([{ name: 'train/batch-D', sha: 'x' }]), 3).map((r: { name: string }) => r.name)).toEqual([
      'train/batch-46',
      'train/batch-45',
      'train/batch-44',
    ])
    const api = fakeGitHub({ 1: docs(1, 'a'), 2: docs(2, 'b') })
    const main = api.refs.get('main')!
    for (let n = 1; n <= 45; n++) {
      const sha = (1000 + n).toString(16).padStart(40, 'c')
      api.commits.set(sha, { sha, message: `Merge PR #${n} into batch ${n}`, parents: [main, head('a')], date: BUILT })
      api.refs.set(`train/batch-${n}`, sha)
    }
    let reads = 0
    const getCommit = api.getCommit
    api.getCommit = async (sha: string) => {
      reads++
      return getCommit(sha)
    }
    await step(api)
    // The new batch is numbered 46, after every branch; building it reads its own commits, not the 45 stale ones.
    expect(kinds(api, 'createRef')).toEqual([['createRef', 'train/batch-46', main]])
    reads = 0
    await step(api)
    expect(reads).toBeLessThanOrEqual(BATCH_REFS_READ + 3)
  })

  it('runTrain gives the run to the batch and serves no car alongside it', async () => {
    const api = await built()
    const actions = await runTrain(api, { now: NOW, batches: true, sleep: async () => {} })
    expect(actions.map((a: { type: string }) => a.type)).toEqual(['batch-wait'])
  })
})

describe('batch API guards', () => {
  const calls: Array<[string, string, unknown]> = []
  const fetchImpl = async (url: string, init: { method: string; body?: string }) => {
    calls.push([init.method, url, init.body ? JSON.parse(init.body) : null])
    return { ok: true, status: 201, json: async () => ({ sha: 'f'.repeat(40) }), text: async () => '', headers: { get: () => '' } }
  }
  const api = createGitHubApi({ token: 't', repo: 'o/r', fetchImpl })

  it('writes only batch branches, the one status and the one label', async () => {
    await expect(api.createRef('main', 'a'.repeat(40))).rejects.toThrow(/not a batch branch/)
    await expect(api.deleteRef('main')).rejects.toThrow(/not a batch branch/)
    await expect(api.deleteRef('train/batch-D')).rejects.toThrow(/not a batch branch/)
    await expect(api.mergeInto('feat/x', 'a'.repeat(40), 'm')).rejects.toThrow(/not a batch branch/)
    await expect(api.postStatus('a'.repeat(40), { state: 'success', context: 'Build', description: 'x' })).rejects.toThrow()
    await expect(api.postStatus('a'.repeat(40), { state: 'failure', context: 'CI result', description: 'x' })).rejects.toThrow()
    await expect(api.addLabel(1, 'na-fila')).rejects.toThrow(/not a train label/)
    expect(calls).toEqual([])
  })

  it('posts the status and the merge into the batch as GitHub expects', async () => {
    await api.postStatus('a'.repeat(40), { state: 'success', context: 'CI result', description: 'batch train/batch-2', targetUrl: RUN_URL })
    await api.mergeInto('train/batch-2', 'b'.repeat(40), 'merge-train batch 2: #5 ' + 'b'.repeat(40))
    await api.addLabel(5, NO_BATCH_LABEL)
    expect(calls).toEqual([
      ['POST', `https://api.github.com/repos/o/r/statuses/${'a'.repeat(40)}`, { state: 'success', context: 'CI result', description: 'batch train/batch-2', target_url: RUN_URL }],
      ['POST', 'https://api.github.com/repos/o/r/merges', { base: 'train/batch-2', head: 'b'.repeat(40), commit_message: `merge-train batch 2: #5 ${'b'.repeat(40)}` }],
      ['POST', 'https://api.github.com/repos/o/r/issues/5/labels', { labels: [NO_BATCH_LABEL] }],
    ])
  })
})
