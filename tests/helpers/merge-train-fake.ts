// The fake GitHub the merge train v2 tests drive (tests/unit/merge-train-batch*.test.ts): real merge semantics,
// a tree is a set of patches, a merge is the union, and listed patch pairs conflict. Every write is logged.
import { createHash } from 'node:crypto'
import {
  BATCH_PREFIX,
  DB_INDEX,
  buildChain,
  countedMainRuns,
  countedTipRuns,
  parseManifest,
  renderManifest,
  requiredGates,
  runBatchTrain,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train-batch.mjs'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Any = any

export const NOW = Date.parse('2026-11-01T12:00:00Z')
const sha1 = (text: string) => createHash('sha1').update(text).digest('hex')
const LATEST = 87

/**
 * A fake GitHub with real merge semantics: a tree is the set of patches a commit contains, a merge is the union,
 * and two patches listed in `conflicts` cannot meet. Every write is logged.
 */
export function fakeGitHub() {
  const commits = new Map<string, { tree: string; parents: string[]; message: string; date: string; patches: string[] }>()
  const trees = new Map<string, string[]>()
  const refs = new Map<string, string>()
  const writes: Array<[string, ...Any[]]> = []
  const conflicts = new Set<string>()
  let counter = 0
  let clock = NOW
  const treeOf = (patches: string[]) => {
    const sorted = [...new Set(patches)].sort()
    const id = sha1(`tree:${sorted.join('|')}`)
    trees.set(id, sorted)
    return id
  }
  const commit = (patches: string[], parents: string[], message = 'commit') => {
    const sha = sha1(`commit:${counter++}`)
    commits.set(sha, { tree: treeOf(patches), parents, message, date: new Date(clock).toISOString(), patches: [...new Set(patches)].sort() })
    return sha
  }
  const clash = (a: string[], b: string[]) => a.some((x) => b.some((y) => conflicts.has(`${x}|${y}`) || conflicts.has(`${y}|${x}`)))
  const m0 = commit(['m0'], [])
  refs.set('main', m0)
  const prs = new Map<number, Any>()
  const comments = new Map<number, Array<{ id: number; body: string; byTrain: boolean }>>()
  const runs: Any[] = []
  const jobs = new Map<string, Any[]>()
  let nextComment = 1
  let nextRun = 100
  const hooks: { beforeMergePull?: (n: number) => void; mergeTree?: (patches: string[]) => string[]; fastForward?: boolean; afterMergeInto?: (ref: string) => void } = {}
  const fs = new Map<string, string>() // `${path}@${sha}` -> text

  const api: Any = {
    repo: 'o/r',
    base: 'main',
    writes,
    // v1 surface
    async listQueue() {
      return [...prs.values()].filter((p) => p.state === 'open' && p.labels.has('na-fila')).map((p) => ({ number: p.number, labeledAt: p.labeledAt, labeledBy: p.labeledBy ?? 'maintainer' }))
    },
    async getPull(n: number) {
      const p = prs.get(n)
      return p && { number: n, state: p.state, draft: p.draft, isFork: false, headSha: p.head, headRef: p.ref, mergeable: p.mergeable, mergeableState: p.mergeable ? 'clean' : 'dirty' }
    },
    async behindBy() {
      return 0
    },
    async docsOnlySince() {
      return false
    },
    async changesRequested(n: number) {
      return prs.get(n).changesRequested
    },
    async listRuns() {
      return []
    },
    async listChecks() {
      return []
    },
    async requiredChecks() {
      return []
    },
    roles: {} as Record<string, string>,
    async collaboratorRole(login: string) {
      return api.roles[login] ?? 'write'
    },
    async listComments(n: number) {
      return comments.get(n) ?? []
    },
    async createComment(n: number, body: string) {
      writes.push(['comment', n, body])
      comments.set(n, [...(comments.get(n) ?? []), { id: nextComment++, body, byTrain: true }])
    },
    async updateComment(id: number, body: string) {
      for (const [n, list] of comments) for (const c of list) if (c.id === id) {
        c.body = body
        writes.push(['comment', n, body])
      }
    },
    async removeLabel(n: number) {
      writes.push(['unlabel', n])
      prs.get(n).labels.delete('na-fila')
    },
    async dispatchWorkflow(file: string, ref: string) {
      writes.push(['dispatch', file, ref])
    },
    async updateBranch(n: number) {
      writes.push(['updateBranch', n])
    },
    async merge(n: number) {
      writes.push(['v1merge', n])
    },
    // batch surface
    async listTrainRefs() {
      return [...refs].filter(([name]) => name.startsWith('merge-train/')).map(([name, sha]) => ({ name, sha }))
    },
    async createRef(name: string, sha: string) {
      if (refs.has(name)) throw Object.assign(new Error('exists'), { status: 422 })
      writes.push(['createRef', name])
      refs.set(name, sha)
    },
    async deleteRef(name: string) {
      if (refs.delete(name)) writes.push(['deleteRef', name])
    },
    async getRef(name: string) {
      const sha = refs.get(name)
      if (!sha) throw Object.assign(new Error('no ref'), { status: 404 })
      return sha
    },
    async updateRef(name: string, sha: string) {
      if (commits.get(sha)!.parents[0] !== refs.get(name)) throw Object.assign(new Error('not a fast-forward'), { status: 422 })
      refs.set(name, sha)
    },
    async mergeInto(name: string, head: string) {
      const prev = refs.get(name)!
      const a = commits.get(prev)!.patches
      const b = commits.get(head)!.patches
      if (b.every((x) => a.includes(x))) return { status: 204 }
      if (clash(a, b)) return { status: 409 }
      if (hooks.fastForward && a.every((x) => b.includes(x))) {
        refs.set(name, head)
        hooks.afterMergeInto?.(name)
        return { status: 201, sha: head }
      }
      const made = commit([...a, ...b], [prev, head], `Merge ${head}`)
      refs.set(name, made)
      hooks.afterMergeInto?.(name)
      return { status: 201, sha: made }
    },
    async getCommit(sha: string) {
      const c = commits.get(sha)
      if (!c) throw Object.assign(new Error('no commit'), { status: 404 })
      return { sha, tree: c.tree, parents: c.parents, message: c.message, date: c.date }
    },
    async createCommit({ message, tree, parents }: Any) {
      const sha = sha1(`commit:${counter++}`)
      commits.set(sha, { tree, parents, message, date: new Date(clock).toISOString(), patches: trees.get(tree) ?? [] })
      return sha
    },
    async prFiles(n: number) {
      return { files: prs.get(n).files, complete: true }
    },
    async readFile(path: string, ref: string) {
      return fs.get(`${path}@${ref}`) ?? (path === DB_INDEX ? `export const LATEST_DB_VERSION = ${LATEST}` : null)
    },
    async issueLabels(n: number) {
      return [...prs.get(n).labels]
    },
    async tipRuns(sha: string, ref: string) {
      return countedTipRuns(runs, { sha, ref, repo: 'o/r' })
    },
    async trainStatus(sha: string) {
      const own = writes.filter(([w, at, st]) => w === 'status' && at === sha && st.context === 'merge-train')
      return own.length ? own[own.length - 1][2].state : null
    },
    async getRun(id: number) {
      return runs.find((r) => r.id === id)
    },
    async runJobs(id: number, attempt?: number) {
      return jobs.get(`${id}@${attempt ?? 'latest'}`) ?? []
    },
    async rerunFailedJobs(id: number) {
      writes.push(['rerun', id])
    },
    mainRunList: [] as Any[],
    async mainRuns() {
      return countedMainRuns(api.mainRunList, { repo: 'o/r', base: 'main' })
    },
    async recentBatchRuns() {
      return runs.filter((r) => String(r.headBranch).startsWith(BATCH_PREFIX)).sort((a, b) => b.id - a.id)
    },
    async activeRunCount() {
      return 0
    },
    async mergePull(n: number, head: string, title: string, message: string) {
      hooks.beforeMergePull?.(n)
      const p = prs.get(n)
      if (p.head !== head) throw Object.assign(new Error('Head branch was modified'), { status: 409 })
      const prev = refs.get('main')!
      const patches = [...commits.get(prev)!.patches, ...commits.get(head)!.patches]
      refs.set('main', commit(hooks.mergeTree ? hooks.mergeTree(patches) : patches, [prev, head], `${title}\n\n${message}`))
      p.state = 'closed'
      writes.push(['mergePull', n, head, title, message])
    },
    async postStatus(sha: string, status: Any) {
      writes.push(['status', sha, status])
    },
  }

  const pr = (number: number, files: string[] = [`src/f${number}.ts`], over: Any = {}) => {
    const head = commit(['m0', `p${number}`], [m0], `PR ${number}`)
    prs.set(number, {
      number,
      head,
      ref: `feat/${number}`,
      state: 'open',
      draft: false,
      mergeable: true,
      changesRequested: false,
      labels: new Set(['na-fila']),
      labeledAt: new Date(NOW - 3_600_000 + number * 1000).toISOString(),
      files: files.map((filename) => ({ filename, status: 'modified' })),
      ...over,
    })
    return head
  }
  /** Completed runs of every gate on a tip, all green unless `red` names one with a failing job. */
  const ci = (tip: string, branch: string, opts: { red?: string; job?: string; step?: string; conclusion?: string; attempt?: number; pending?: boolean; actor?: string; green?: boolean } = {}) => {
    const gates = requiredGates(
      [...new Set(parseManifest(commits.get(tip)!.message)!.cars.flatMap((c: Any) => prs.get(c.number).files.map((f: Any) => f.filename)))],
    )
    for (const gate of gates) {
      const id = nextRun++
      const red = opts.red === gate.name && !opts.green
      runs.push({
        id,
        name: gate.name,
        path: `.github/workflows/${gate.file}`,
        displayTitle: gate.file === 'ci.yml' ? `Full check · ${branch}` : gate.name,
        triggeringActor: opts.actor ?? 'github-actions[bot]',
        headSha: tip,
        headBranch: branch,
        headRepo: 'o/r',
        event: 'workflow_dispatch',
        status: opts.pending ? 'in_progress' : 'completed',
        conclusion: opts.pending ? null : red ? 'failure' : 'success',
        runAttempt: opts.attempt ?? 1,
        htmlUrl: `https://github.com/o/r/actions/runs/${id}`,
        createdAt: new Date(clock).toISOString(),
      })
      if (red) jobs.set(`${id}@latest`, [{ name: opts.job ?? 'Typecheck, test and build (Linux)', conclusion: opts.conclusion ?? 'failure', steps: [{ name: opts.step ?? 'Unit tests', conclusion: 'failure' }] }])
    }
  }
  const batchRef = () => [...refs.keys()].find((k) => k.startsWith(BATCH_PREFIX))
  /** The merge-train run a train() call stands for: the batch age comes from its start (L8). */
  const trainRun = (id: number, at = clock) => {
    if (!runs.some((r) => r.id === id)) runs.push({ id, name: 'Merge train', path: '.github/workflows/merge-train.yml', headRepo: 'o/r', headBranch: 'main', event: 'schedule', status: 'in_progress', createdAt: new Date(at).toISOString() })
  }
  return {
    api,
    refs,
    commits,
    prs,
    writes,
    conflicts,
    hooks,
    fs,
    comments,
    runs,
    jobs,
    pr,
    ci,
    commit,
    treeOf,
    batchRef,
    trainRun,
    tick: (ms: number) => (clock += ms),
    get now() {
      return clock
    },
  }
}

export const train = (gh: ReturnType<typeof fakeGitHub>, runId: number, over: Any = {}) => {
  gh.trainRun(runId)
  return runBatchTrain(gh.api, { now: gh.now, size: 3, runId: String(runId), runAttempt: '1', ...over })
}
export const kinds = (writes: Array<[string, ...Any[]]>, kind: string) => writes.filter(([w]) => w === kind)


/** A batch ref built by hand with the train's own merges, as a writer could: a manifest with any cars. */
export async function forge(gh: ReturnType<typeof fakeGitHub>, numbers: number[], over: Any = {}) {
  const main = gh.refs.get('main')!
  const ref = `${BATCH_PREFIX}${over.id ?? '5-1'}`
  const chain = await buildChain(gh.api, ref, main, numbers.map((n) => ({ number: n, head: gh.prs.get(n).head })))
  const manifest = { v: 1, id: over.id ?? '5-1', mode: over.mode ?? 'batch', base: main, cars: chain.steps.map(({ number, head, sha }: Any) => ({ number, head, sha })), rest: over.rest ?? [], known: [] }
  const last = chain.steps.at(-1)
  const tip = await gh.api.createCommit({ message: renderManifest(manifest), tree: over.tree ?? last.tree, parents: [last.sha] })
  gh.refs.set(ref, tip)
  return { ref, tip }
}
