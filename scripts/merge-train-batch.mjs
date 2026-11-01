// Merge train v2 (S0.2 follow-up): batches of up to 3 labelled cars, tested together on a temporary ref.
//
// Off by default: MERGE_TRAIN_BATCH=1 (the default) is v1 exactly; MERGE_TRAIN_BATCH=2 or 3 turns batching on;
// MERGE_TRAIN_BATCH_SHADOW=1 (with size 1) also builds and tests batches next to v1 without merging anything.
// Design and review: train-v2-design.md, reviewed by the ARCHITECT (R1-R11 below refer to that review).
//
// The invariant: after a batch, the tree of main is exactly a tree the train merged itself from main@B and the
// cars' real heads, and that tree passed every gate main has, on a completed run of its own commit.
// - R1: nothing in a merge-train/* ref is trusted. Before CI counts and again before merging, the train merges
//   the same heads onto the same base on a scratch ref and requires every tree to match.
// - R2: green means every path-matched workflow (CI and Release, axe, Android) passed on the batch tip.
// - R5/R6: cars merge in order with PUT /pulls/{n}/merge pinned to the tested head, each merge checked for
//   parents [previous main, car head] and the tree the train derived; a partial batch stops the line.
// - R7: the state is the one live batch ref (plus a manifest in its tip commit, verified like the rest).
// - R8: a red batch falls back to testing car 1 alone, reusing a red verdict for a tree already tested.

import {
  CI_WORKFLOW,
  DEFAULT_TIMEOUT_MINUTES,
  LABEL,
  LABELER_ROLES,
  cleanName,
  globToRegExp,
  loadInput,
  orderQueue,
  renderComment,
  runTrain,
  upsertComment,
} from './merge-train.mjs'

export const REF_ROOT = 'merge-train/'
export const BATCH_PREFIX = 'merge-train/batch-'
export const SHADOW_PREFIX = 'merge-train/shadow-'
export const VERIFY_PREFIX = 'merge-train/verify-'
export const MAX_BATCH = 3
/** How long a fresh batch tip may sit without runs before the train dispatches its gates again. */
export const BATCH_DISPATCH_GRACE_MS = 3 * 60_000
const SHA_RE = /^[0-9a-f]{40}$/
const isSha = (value) => typeof value === 'string' && SHA_RE.test(value)
const short = (sha) => String(sha ?? '').slice(0, 7)
const matchesAny = (path, globs) => globs.some((glob) => globToRegExp(glob).test(path))

// ---------------------------------------------------------------------------------------------------------------
// R2: the gates. One table, checked against the workflow files by tests/unit/merge-train-batch.test.ts.

/**
 * Every workflow that gates main, with the path filter its pull_request trigger uses. `always`: runs on every
 * change. `paths`: runs when any file matches. `pathsIgnore`: runs unless every file matches. `coveredBy`: a
 * dispatched run of that workflow already runs it as a job, so it is not dispatched on its own.
 */
export const WORKFLOW_GATES = [
  { file: 'ci.yml', name: CI_WORKFLOW, always: true },
  {
    file: 'a11y-axe.yml',
    name: 'Accessibility scan (axe)',
    pathsIgnore: [
      'docs/**',
      '**/*.md',
      '.claude/**',
      'electron/main/**/*.test.ts',
      'tests/**',
      'mobile/**',
      'scripts/android/**',
      'shared/remote/**',
      '.github/workflows/ci.yml',
      '.github/workflows/android.yml',
      '.github/workflows/memory-compatibility.yml',
      '.github/workflows/provider-contract.yml',
      '.github/workflows/release.yml',
      '.github/workflows/visual-baselines.yml',
      '.github/workflows/visual-regression.yml',
    ],
  },
  {
    file: 'android.yml',
    name: 'Android',
    paths: [
      'mobile/android/**',
      'shared/remote/**',
      'shared/locales/*/mobile.json',
      'src/design/tokens/**',
      'scripts/android/**',
      'shared/approval-rules.ts',
      'shared/reserved-names.ts',
      '.github/workflows/android.yml',
    ],
  },
  {
    file: 'memory-compatibility.yml',
    name: 'Memory compatibility',
    coveredBy: 'ci.yml',
    paths: [
      'electron/main/services/memory/**',
      'electron/main/services/conversation/**',
      'shared/types/memory.ts',
      'shared/types/thread.ts',
      'resources/memory/**',
      'tests/**/memory*',
      'tests/**/ai-memory*',
      'scripts/test-memory-compatibility.mjs',
      '.github/workflows/memory-compatibility.yml',
    ],
  },
]

/** The gates a set of changed paths needs: [{ file, name }], dispatched and awaited on the batch tip. */
export function requiredGates(paths) {
  const files = [...new Set(paths)]
  return WORKFLOW_GATES.filter((gate) => {
    if (gate.coveredBy) return false
    if (gate.always) return true
    if (gate.paths) return files.some((path) => matchesAny(path, gate.paths))
    if (gate.pathsIgnore) return files.some((path) => !matchesAny(path, gate.pathsIgnore))
    return true
  }).map(({ file, name }) => ({ file, name }))
}

// ---------------------------------------------------------------------------------------------------------------
// R3, R4, R9, L4: which cars may share a batch.

export const MIGRATION_DIR = 'electron/main/db/migrations/'
export const DB_INDEX = 'electron/main/db/index.ts'
/** R4: inputs of the generated Android sources (tests/android-generated.test.ts): one such car per batch. */
export const GENERATOR_GLOBS = ['shared/remote/**', 'src/design/tokens/**', 'shared/locales/*/mobile.json', 'scripts/android/**']
/** R9: files that change a gate itself; such a car runs alone, so it can only weaken its own checks. */
export const GATE_GLOBS = [
  'package.json',
  'tsconfig*.json',
  'vitest.config.*',
  'vitest.*.config.*',
  'playwright.config.*',
  'playwright.*.config.*',
  'eslint.config.*',
  '.eslintrc*',
  'electron.vite.config.*',
  'electron-builder*',
  'scripts/**',
  '.github/**',
  'tests/setup*',
  'tests/**/setup*',
]
export const WORKFLOW_GLOBS = ['.github/workflows/**']

export function parseLatestDbVersion(text) {
  const match = /export const LATEST_DB_VERSION = (\d+)/.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

/**
 * R3: a car's migration change. `none`, `ok` (exactly one new NNN_*.sql, or the NNN_*_posix.sql/NNN_*_win.sql
 * pair, with NNN = LATEST_DB_VERSION on the base + 1, and LATEST_DB_VERSION set to NNN in the car), `renumber`
 * (the right shape with the wrong number), or `invalid` (anything else: never batched).
 */
export function classifyMigration(files, latestOnBase, latestOnCar) {
  const touched = files.filter((f) => f.filename.startsWith(MIGRATION_DIR) || String(f.previous_filename ?? '').startsWith(MIGRATION_DIR))
  if (!touched.length) return { kind: 'none' }
  if (touched.some((f) => f.status !== 'added' || f.previous_filename)) return { kind: 'invalid', reason: 'it changes an existing migration' }
  const names = touched.map((f) => f.filename.slice(MIGRATION_DIR.length))
  const numbers = names.map((name) => /^(\d{3})_[a-z0-9_]+\.sql$/.exec(name)?.[1])
  if (numbers.some((n) => !n) || new Set(numbers).size !== 1) return { kind: 'invalid', reason: 'it adds more than one migration' }
  const pair = names.length === 2 && names.some((n) => n.endsWith('_posix.sql')) && names.some((n) => n.endsWith('_win.sql'))
  if (names.length > 2 || (names.length === 2 && !pair)) return { kind: 'invalid', reason: 'it adds more than one migration' }
  const number = Number(numbers[0])
  if (!Number.isInteger(latestOnBase)) return { kind: 'invalid', reason: 'LATEST_DB_VERSION on main could not be read' }
  if (number !== latestOnBase + 1) return { kind: 'renumber', expected: latestOnBase + 1, number }
  const indexChanged = files.some((f) => f.filename === DB_INDEX && f.status === 'modified')
  if (!indexChanged || latestOnCar !== number) return { kind: 'invalid', reason: `LATEST_DB_VERSION must be ${number}` }
  return { kind: 'ok', number }
}

/**
 * What a car is for batching: { batchable, solo, generator, migration, reason, leave? }.
 * files: the PR's files ({ filename, previous_filename, status }); complete: false when the list was cut short.
 */
export function classifyCar({ headRef, files, complete, migration }) {
  if (!complete) return { batchable: false, reason: 'its file list could not be read in full' }
  const paths = files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean))
  if (paths.some((p) => matchesAny(p, WORKFLOW_GLOBS))) return { batchable: false, reason: 'it changes a workflow file' }
  if (migration?.kind === 'renumber') {
    return {
      batchable: false,
      leave: `renumber the migration: main is at ${migration.expected - 1}, so the next one is ${String(migration.expected).padStart(3, '0')} (this PR adds ${String(migration.number).padStart(3, '0')}).`,
      reason: 'its migration number is not the next one',
    }
  }
  if (migration?.kind === 'invalid') return { batchable: false, reason: `its migration is not batchable (${migration.reason})` }
  const solo = String(headRef ?? '').startsWith('release/') || paths.some((p) => matchesAny(p, GATE_GLOBS))
  return {
    batchable: true,
    solo,
    generator: paths.some((p) => matchesAny(p, GENERATOR_GLOBS)),
    migration: migration?.kind === 'ok',
    reason: solo ? 'it changes a gate or is a release, so it runs alone' : '',
  }
}

/**
 * Which cars form the next batch, from the head of the queue in order (no overtaking).
 * cars: [{ number, eligible, why, cls }]. Returns { cars: [numbers] } | { delegate: number, reason } (the head car
 * goes through v1's single-car path) | { leave: { number, message } } | { idle: true }.
 */
export function planBatch(cars, max = MAX_BATCH) {
  const picked = []
  for (const car of cars) {
    const first = picked.length === 0
    if (!car.eligible) {
      if (first) return { delegate: car.number, reason: car.why ?? 'not ready' }
      break
    }
    if (car.cls.leave) {
      if (first) return { leave: { number: car.number, message: car.cls.leave } }
      break
    }
    if (!car.cls.batchable) {
      if (first) return { delegate: car.number, reason: car.cls.reason }
      break
    }
    if (car.cls.solo) {
      if (first) return { cars: [car.number] }
      break
    }
    if (car.cls.generator && picked.some((p) => p.cls.generator)) break
    if (car.cls.migration && picked.some((p) => p.cls.migration)) break
    picked.push(car)
    if (picked.length >= max) break
  }
  return picked.length ? { cars: picked.map((c) => c.number) } : { idle: true }
}

// ---------------------------------------------------------------------------------------------------------------
// R7, R10: the manifest in the batch tip, and the trailers on main.

const MANIFEST_RE = /\n\n<!-- merge-train-batch (\{[^\n]*\}) -->\s*$/

export function renderManifest(manifest) {
  return `merge-train ${manifest.mode} ${manifest.id}: ${manifest.cars.map((c) => `#${c.number}`).join(' ')}\n\n<!-- merge-train-batch ${JSON.stringify(manifest)} -->`
}

/** The manifest from a batch tip's message, or null. It is a claim, never trusted: R1 re-derives everything. */
export function parseManifest(message) {
  const match = MANIFEST_RE.exec(String(message ?? ''))
  if (!match) return null
  let m
  try {
    m = JSON.parse(match[1])
  } catch {
    return null
  }
  const int = (n) => Number.isInteger(n) && n > 0
  if (!m || m.v !== 1 || typeof m.id !== 'string' || !/^\d+-\d+$/.test(m.id)) return null
  if (!['batch', 'fallback', 'shadow'].includes(m.mode) || !isSha(m.base)) return null
  if (!Array.isArray(m.cars) || m.cars.length < 1 || m.cars.length > MAX_BATCH) return null
  if (!m.cars.every((c) => c && int(c.number) && isSha(c.head) && isSha(c.sha))) return null
  if (new Set(m.cars.map((c) => c.number)).size !== m.cars.length) return null
  const rest = m.rest ?? []
  if (!Array.isArray(rest) || rest.length > MAX_BATCH || !rest.every(int)) return null
  const known = m.known ?? []
  if (!Array.isArray(known) || known.length > MAX_BATCH || !known.every((k) => k && isSha(k.tree) && int(k.run))) return null
  return {
    v: 1,
    id: m.id,
    mode: m.mode,
    base: m.base,
    cars: m.cars.map(({ number, head, sha }) => ({ number, head, sha })),
    rest,
    known: known.map(({ tree, run }) => ({ tree, run })),
  }
}

/** R10: the merge commit message of car i of k. */
export function mergeCommitMessage({ number, headRef, owner, batchId, index, count, testedRun }) {
  return {
    title: `Merge pull request #${number} from ${owner}/${headRef}`,
    message: `Merge-Train-Batch: ${batchId} ${index}/${count}\nTested-Run: ${testedRun}`,
  }
}

/** The batch trailer of a main commit: { id, index, count } or null. */
export function parseBatchTrailer(message) {
  const match = /^Merge-Train-Batch: (\d+-\d+) (\d+)\/(\d+)$/m.exec(String(message ?? ''))
  return match ? { id: match[1], index: Number(match[2]), count: Number(match[3]) } : null
}

// ---------------------------------------------------------------------------------------------------------------
// R1, R11: building and re-deriving the chain.

/**
 * Merges each car's head SHA, in order, onto a ref created at `base` (POST /merges). R11: GitHub documents 201
 * (the resulting commit) and 204 (nothing to merge); whether a 201 can be a fast-forward is not documented, so
 * a result counts when it is a merge commit [previous tip, head] or the head itself (a fast-forward), and only
 * its tree is used afterwards. 204 means the car adds nothing; a 409 is a conflict. Both end the chain there
 * (R5: the batch is the cars before it).
 */
export async function buildChain(api, ref, base, cars, messageFor = () => 'merge-train') {
  await api.createRef(ref, base)
  const steps = []
  let prev = base
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i]
    const result = await api.mergeInto(ref, car.head, messageFor(car, i))
    if (result.status === 409) return { steps, stopAt: i, reason: 'conflict' }
    if (result.status === 204) return { steps, stopAt: i, reason: 'nothing to merge' }
    const tip = await api.getRef(ref)
    const commit = await api.getCommit(tip)
    const merged = commit.parents.length === 2 && commit.parents[0] === prev && commit.parents[1] === car.head
    const fastForward = tip === car.head
    if (!merged && !fastForward) return { steps, stopAt: i, reason: 'unexpected merge result' }
    steps.push({ number: car.number, head: car.head, sha: tip, tree: commit.tree })
    prev = tip
  }
  return { steps }
}

/** R1: the trees the train itself gets by merging these heads onto `base`, on a scratch ref it deletes after. */
export async function rederive(api, base, cars, tag) {
  const ref = `${VERIFY_PREFIX}${tag}`
  try {
    const chain = await buildChain(api, ref, base, cars)
    return chain.stopAt === undefined ? chain.steps.map((s) => s.tree) : null
  } finally {
    await api.deleteRef(ref)
  }
}

/**
 * R1: the batch tip matches the train's own re-derivation: the tip's single parent is the last car's commit,
 * the tip's tree is the last derived tree, and every car commit in the manifest has the derived tree at its
 * position. Returns null when it matches, or the reason.
 */
export function verifyChain({ manifest, tipCommit, carCommits, rederived }) {
  if (!manifest || !tipCommit || !Array.isArray(rederived)) return 'the batch could not be re-derived'
  if (rederived.length !== manifest.cars.length || carCommits.length !== manifest.cars.length) return 'the batch has a different number of cars'
  const last = manifest.cars[manifest.cars.length - 1]
  if (tipCommit.parents.length !== 1 || tipCommit.parents[0] !== last.sha) return 'the batch tip is not on the last car'
  if (tipCommit.tree !== rederived[rederived.length - 1]) return 'the batch tip tree is not the derived tree'
  for (let i = 0; i < manifest.cars.length; i++) {
    if (carCommits[i]?.sha !== manifest.cars[i].sha || carCommits[i]?.tree !== rederived[i]) return `car ${i + 1}'s tree is not the derived tree`
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// CI on the batch tip, and flaky retries (the review's Q3).

/** Failed steps that are nondeterministic by nature, plus jobs and workflows that are (the review's list). */
export const NONDETERMINISTIC = [/^E2E\b/i, /performance gate/i, /OxeQuery live/i, /\baxe\b/i, /accessibility/i, /^Live tests$/i]
const INFRA_CONCLUSIONS = new Set(['cancelled', 'timed_out', 'startup_failure'])

/**
 * The verdict on the batch tip: { state: 'missing' | 'pending' | 'green' | 'red', missing, pending, failed, runs }.
 * gates: [{ name }]; runs: the workflow runs on the tip ({ id, name, status, conclusion, runAttempt, htmlUrl,
 * createdAt }); jobs: { [runId]: [{ name, conclusion, steps }] } for the completed red runs.
 */
export function evaluateBatchCI({ gates, runs, jobs = {} }) {
  const latest = new Map()
  for (const run of runs ?? []) {
    const known = latest.get(run.name)
    if (!known || Date.parse(run.createdAt ?? 0) >= Date.parse(known.createdAt ?? 0)) latest.set(run.name, run)
  }
  const missing = gates.filter((g) => !latest.has(g.name)).map((g) => g.name)
  const chosen = gates.map((g) => latest.get(g.name)).filter(Boolean)
  const pending = chosen.filter((r) => r.status !== 'completed').map((r) => r.name)
  if (missing.length) return { state: 'missing', missing, pending, failed: [], runs: chosen }
  if (pending.length) return { state: 'pending', missing, pending, failed: [], runs: chosen }
  const failed = []
  for (const run of chosen.filter((r) => r.conclusion !== 'success')) {
    const bad = (jobs[run.id] ?? []).filter((j) => j.conclusion && !['success', 'skipped', 'neutral'].includes(j.conclusion))
    if (!bad.length) failed.push({ workflow: run.name, run: run.id, runAttempt: run.runAttempt ?? 1, url: run.htmlUrl, job: null, step: null, conclusion: run.conclusion })
    for (const job of bad) {
      const step = (job.steps ?? []).find((s) => s.conclusion === 'failure')?.name ?? null
      failed.push({ workflow: run.name, run: run.id, runAttempt: run.runAttempt ?? 1, url: run.htmlUrl, job: job.name, step, conclusion: job.conclusion })
    }
  }
  return { state: failed.length ? 'red' : 'green', missing, pending, failed, runs: chosen }
}

/**
 * Q3: retry once, only when every failure is infrastructure (cancelled, timed out, a lost runner: no failed step)
 * or a named nondeterministic step/job/workflow; never a second attempt of a run (one retry per tree); and never a
 * job that also flaked in the previous batch (two flakes in a row are a real problem, not luck).
 */
export function retryDecision({ failed, flakedLastBatch = new Set() }) {
  if (!failed.length) return { retry: false, reason: 'nothing failed' }
  for (const f of failed) {
    const infra = INFRA_CONCLUSIONS.has(f.conclusion) || (f.conclusion === 'failure' && f.job && !f.step)
    const nondeterministic = NONDETERMINISTIC.some((re) => re.test(f.step ?? '') || re.test(f.job ?? '') || re.test(f.workflow ?? ''))
    if (!infra && !nondeterministic) return { retry: false, reason: `"${cleanName(f.job ?? f.workflow)}" failed in a deterministic step` }
    if (f.runAttempt >= 2) return { retry: false, reason: 'already retried once for this tree' }
    if (f.job && flakedLastBatch.has(f.job)) return { retry: false, reason: `"${cleanName(f.job)}" also flaked in the previous batch` }
  }
  return { retry: true, runs: [...new Set(failed.map((f) => f.run))] }
}

/** The jobs that flaked in a run: failed in attempt 1, while the run ended green on a later attempt. */
export function flakesOf(run, firstAttemptJobs) {
  if (!run || run.conclusion !== 'success' || (run.runAttempt ?? 1) < 2) return new Set()
  return new Set((firstAttemptJobs ?? []).filter((j) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped').map((j) => j.name))
}

/** A failure for a comment: workflow, job, step, run link. */
export function describeFailure(f) {
  const what = f.job ? `"${cleanName(f.job)}" (${cleanName(f.workflow)})` : cleanName(f.workflow)
  const where = f.step ? ` at step "${cleanName(f.step)}"` : ''
  const link = typeof f.url === 'string' && /^https:\/\/github\.com\//.test(f.url) ? ` (${f.url})` : ''
  return `${what} ${cleanName(f.conclusion ?? 'failed')}${where}${link}`
}

// ---------------------------------------------------------------------------------------------------------------
// R6: stop the line.

/**
 * Whether batching must pause: the latest completed main CI run is red, or main's tip is inside a batch that
 * stopped (trailer i/k with i < k) and has no completed green run of its own yet.
 * mainRuns: CI runs on main ({ headSha, status, conclusion, createdAt, htmlUrl }); tip: { sha, message }.
 * Returns { paused, reason, dispatch } (dispatch: main CI has no run at all on the tip).
 */
export function mainHealth({ mainRuns, tip }) {
  const runs = [...(mainRuns ?? [])].sort((a, b) => Date.parse(b.createdAt ?? 0) - Date.parse(a.createdAt ?? 0))
  const completed = runs.filter((r) => r.status === 'completed')
  const latest = completed[0]
  if (latest && latest.conclusion !== 'success') {
    return { paused: true, reason: `main CI is ${cleanName(latest.conclusion)} (${latest.htmlUrl ?? 'no link'})`, dispatch: false }
  }
  const trailer = parseBatchTrailer(tip?.message)
  if (trailer && trailer.index < trailer.count) {
    const onTip = runs.filter((r) => r.headSha === tip.sha)
    if (!onTip.some((r) => r.status === 'completed' && r.conclusion === 'success')) {
      return { paused: true, reason: `main stopped inside batch ${trailer.id} (${trailer.index}/${trailer.count}); waiting for a green CI run on ${short(tip.sha)}`, dispatch: onTip.length === 0 }
    }
  }
  return { paused: false, reason: '', dispatch: false }
}

// ---------------------------------------------------------------------------------------------------------------
// The batch API: v1's adapter plus git refs, commits, merges and runs.

export function createBatchApi(v1) {
  const { request, paginate, repo, base } = v1.raw
  const r = `/repos/${repo}`
  const enc = (name) => name.split('/').map(encodeURIComponent).join('/')
  const run = (data) => ({
    id: data.id,
    name: data.name,
    path: data.path,
    event: data.event,
    status: data.status,
    conclusion: data.conclusion,
    runAttempt: data.run_attempt ?? 1,
    headSha: data.head_sha,
    headBranch: data.head_branch,
    headRepo: data.head_repository?.full_name ?? null,
    htmlUrl: data.html_url,
    createdAt: data.created_at,
  })
  return {
    ...v1,
    repo,
    base,
    async listTrainRefs() {
      try {
        const refs = (await request('GET', `${r}/git/matching-refs/heads/${enc(REF_ROOT)}`)).data ?? []
        return refs.map((x) => ({ name: x.ref.replace(/^refs\/heads\//, ''), sha: x.object.sha }))
      } catch (error) {
        if (error.status === 404) return []
        throw error
      }
    },
    async createRef(name, sha) {
      await request('POST', `${r}/git/refs`, { ref: `refs/heads/${name}`, sha })
    },
    async deleteRef(name) {
      try {
        await request('DELETE', `${r}/git/refs/heads/${enc(name)}`)
      } catch (error) {
        if (error.status !== 404 && error.status !== 422) throw error
      }
    },
    async getRef(name) {
      return (await request('GET', `${r}/git/ref/heads/${enc(name)}`)).data.object.sha
    },
    async updateRef(name, sha) {
      await request('PATCH', `${r}/git/refs/heads/${enc(name)}`, { sha, force: false })
    },
    async mergeInto(name, head, message) {
      try {
        const { data } = await request('POST', `${r}/merges`, { base: name, head, commit_message: message })
        return { status: data ? 201 : 204 }
      } catch (error) {
        if (error.status === 409) return { status: 409 }
        throw error
      }
    },
    async getCommit(sha) {
      const { data } = await request('GET', `${r}/git/commits/${sha}`)
      return { sha: data.sha, tree: data.tree.sha, parents: data.parents.map((p) => p.sha), message: data.message, date: data.committer?.date }
    },
    async createCommit({ message, tree, parents }) {
      return (await request('POST', `${r}/git/commits`, { message, tree, parents })).data.sha
    },
    async prFiles(number) {
      const files = await paginate(`${r}/pulls/${number}/files?per_page=100`)
      // The files API stops at 3,000 files: a list that long may be cut short.
      return { files: files.map((f) => ({ filename: f.filename, previous_filename: f.previous_filename, status: f.status })), complete: files.length < 3000 }
    },
    async readFile(path, ref) {
      try {
        const { data } = await request('GET', `${r}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`)
        return Buffer.from(data.content ?? '', 'base64').toString('utf8')
      } catch (error) {
        if (error.status === 404) return null
        throw error
      }
    },
    async issueLabels(number) {
      return (await request('GET', `${r}/issues/${number}/labels`)).data.map((l) => l.name)
    },
    /** Runs the train dispatched on a merge-train ref's tip: this repository, workflow_dispatch, a train branch. */
    async tipRuns(sha) {
      const runs = await paginate(`${r}/actions/runs?head_sha=${sha}&event=workflow_dispatch&per_page=100`, (d) => d.workflow_runs)
      return runs.map(run).filter((x) => x.headRepo === repo && x.headSha === sha && String(x.headBranch).startsWith(REF_ROOT))
    },
    async getRun(id) {
      return run((await request('GET', `${r}/actions/runs/${Number(id)}`)).data)
    },
    async runJobs(id, attempt) {
      const path = attempt ? `${r}/actions/runs/${Number(id)}/attempts/${Number(attempt)}/jobs?per_page=100` : `${r}/actions/runs/${Number(id)}/jobs?per_page=100`
      const jobs = await paginate(path, (d) => d.jobs)
      return jobs.map((j) => ({ name: j.name, conclusion: j.conclusion, steps: (j.steps ?? []).map((s) => ({ name: s.name, conclusion: s.conclusion })) }))
    },
    async rerunFailedJobs(id) {
      await request('POST', `${r}/actions/runs/${Number(id)}/rerun-failed-jobs`)
    },
    async mainRuns() {
      const { data } = await request('GET', `${r}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(base)}&per_page=30`)
      return data.workflow_runs.map(run).filter((x) => x.headRepo === repo && (x.event === 'push' || x.event === 'workflow_dispatch'))
    },
    async recentBatchRuns() {
      const { data } = await request('GET', `${r}/actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=30`)
      return data.workflow_runs.map(run).filter((x) => x.headRepo === repo && String(x.headBranch).startsWith(BATCH_PREFIX))
    },
    async activeRunCount() {
      const count = async (status) => (await request('GET', `${r}/actions/runs?status=${status}&per_page=1`)).data.total_count ?? 0
      return (await count('in_progress')) + (await count('queued'))
    },
    async mergePull(number, sha, title, message) {
      await request('PUT', `${r}/pulls/${number}/merge`, { merge_method: 'merge', sha, commit_title: title, commit_message: message })
    },
    async postStatus(sha, status) {
      await request('POST', `${r}/statuses/${sha}`, status)
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The batch train.

/** Why a car may not be merged right now (R6, before every merge), or null. */
export async function carProblem(api, car, labeledBy) {
  const pr = await api.getPull(car.number)
  if (!pr || pr.state !== 'open') return 'it is no longer open'
  if (pr.isFork) return 'it is from a fork'
  if (pr.draft) return 'it is a draft'
  if (pr.headSha !== car.head) return `its head moved from ${short(car.head)} to ${short(pr.headSha)}`
  if (pr.mergeable === false) return 'it conflicts with main'
  if (!(await api.issueLabels(car.number)).includes(LABEL)) return `the ${LABEL} label was removed`
  if (await api.changesRequested(car.number)) return 'a review requests changes'
  if (labeledBy !== undefined) {
    const role = labeledBy ? await api.collaboratorRole(labeledBy).catch(() => null) : null
    if (!LABELER_ROLES.has(role)) return 'the label was added without write access'
  }
  return null
}

const comment = (api, number, message) => upsertComment(api, number, renderComment(message, null))

async function carInfo(api, entry, { now, timeoutMinutes, baseSha }) {
  const input = await loadInput(api, entry, { now, timeoutMinutes })
  if (!input) return null
  const pr = input.pr
  const why = !pr.labelerAllowed
    ? 'labeler without write access'
    : pr.draft
      ? 'draft'
      : pr.isFork
        ? 'fork'
        : pr.mergeable !== true || pr.mergeableState === 'dirty'
          ? 'not mergeable yet'
          : pr.changesRequested
            ? 'changes requested'
            : null
  const { files, complete } = await api.prFiles(entry.number)
  let migration = { kind: 'none' }
  if (files.some((f) => f.filename.startsWith(MIGRATION_DIR) || String(f.previous_filename ?? '').startsWith(MIGRATION_DIR))) {
    const latestOnBase = parseLatestDbVersion(await api.readFile(DB_INDEX, baseSha))
    const latestOnCar = parseLatestDbVersion(await api.readFile(DB_INDEX, pr.headSha))
    migration = classifyMigration(files, latestOnBase, latestOnCar)
  }
  return {
    number: entry.number,
    labeledBy: entry.labeledBy ?? null,
    head: pr.headSha,
    headRef: pr.headRef,
    files,
    eligible: why === null,
    why,
    cls: classifyCar({ headRef: pr.headRef, files, complete, migration }),
  }
}

/** Builds a batch ref for these cars on `baseSha` and dispatches its gates. Returns the manifest, or a stop. */
async function startBatch(api, { cars, baseSha, id, mode, rest = [], known = [], prefix, log }) {
  const ref = `${prefix}${id}`
  const chain = await buildChain(api, ref, baseSha, cars, (car) => `Merge #${car.number} into ${ref}`)
  const steps = chain.steps
  if (!steps.length) {
    await api.deleteRef(ref)
    return { stopped: chain.reason, stopAt: chain.stopAt }
  }
  const manifest = {
    v: 1,
    id,
    mode,
    base: baseSha,
    cars: steps.map(({ number, head, sha }) => ({ number, head, sha })),
    rest,
    known,
  }
  const last = steps[steps.length - 1]
  const tip = await api.createCommit({ message: renderManifest(manifest), tree: last.tree, parents: [last.sha] })
  await api.updateRef(ref, tip)
  const paths = cars.slice(0, steps.length).flatMap((c) => c.files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)))
  for (const gate of requiredGates(paths)) await api.dispatchWorkflow(gate.file, ref)
  log(`${mode} ${id}: ${manifest.cars.map((c) => `#${c.number}`).join(' ')} on ${short(baseSha)}, tip ${short(tip)}`)
  return { manifest, ref, tip, tree: last.tree, stopAt: chain.stopAt, stopReason: chain.reason }
}

/** Verified red verdicts by tree (R8): only a completed, failed train run whose commit has that tree counts. */
async function verifiedKnownRed(api, known) {
  const trees = new Set()
  for (const entry of known ?? []) {
    try {
      const run = await api.getRun(entry.run)
      if (run.headRepo !== api.repo || run.event !== 'workflow_dispatch' || !String(run.headBranch).startsWith(REF_ROOT)) continue
      if (run.status !== 'completed' || run.conclusion === 'success') continue
      if ((await api.getCommit(run.headSha)).tree === entry.tree) trees.add(entry.tree)
    } catch {
      // An entry that cannot be checked is ignored.
    }
  }
  return trees
}

/**
 * One run of the batch train (MERGE_TRAIN_BATCH 2 or 3). Bounded work per run, so it fits the job's 10 minutes;
 * every decision is re-read from GitHub, so a run that dies only costs time.
 */
export async function runBatchTrain(api, opts = {}) {
  const {
    now = Date.now(),
    size = 2,
    timeoutMinutes = DEFAULT_TIMEOUT_MINUTES,
    runId = '0',
    runAttempt = '1',
    log = () => {},
    owner = String(api.repo ?? '').split('/')[0],
  } = opts
  const actions = []
  const note = (type, message, number) => {
    actions.push({ type, message, ...(number ? { number } : {}) })
    log(`${number ? `#${number}: ` : ''}${type} — ${message}`)
  }
  const id = `${runId}-${runAttempt}`
  const base = api.base ?? 'main'

  // R7: scratch refs from a run that died are removed; more than one live batch means abort them all.
  const refs = await api.listTrainRefs()
  for (const stale of refs.filter((x) => x.name.startsWith(VERIFY_PREFIX))) await api.deleteRef(stale.name)
  const live = refs.filter((x) => x.name.startsWith(BATCH_PREFIX))
  if (live.length > 1) {
    for (const x of live) await api.deleteRef(x.name)
    note('abort', `${live.length} live batch refs; all aborted, the next run rebuilds`)
    return actions
  }

  // R6: stop the line.
  const mainSha = await api.getRef(base)
  const health = mainHealth({ mainRuns: await api.mainRuns(), tip: await api.getCommit(mainSha) })
  if (health.paused) {
    if (health.dispatch) await api.dispatchWorkflow('ci.yml', base)
    note('paused', health.reason)
    return actions
  }

  if (live.length === 1) {
    await driveBatch(api, live[0].name, { now, timeoutMinutes, id, owner, note, mainSha, size, log })
    return actions
  }

  // Plan from the head of the queue.
  const queue = orderQueue(await api.listQueue())
  if (!queue.length) {
    note('idle', `no pull request is labelled ${LABEL}`)
    return actions
  }
  const cars = []
  for (const entry of queue.slice(0, size)) {
    const info = await carInfo(api, entry, { now, timeoutMinutes, baseSha: mainSha })
    if (!info) break
    cars.push(info)
    if (!info.eligible || !info.cls.batchable || info.cls.solo || info.cls.leave) break
  }
  const plan = planBatch(cars, size)
  if (plan.idle) {
    note('idle', 'nothing to batch')
    return actions
  }
  if (plan.leave) {
    await comment(api, plan.leave.number, `left the queue: ${plan.leave.message}`)
    await api.removeLabel(plan.leave.number)
    note('unlabel', plan.leave.message, plan.leave.number)
    return actions
  }
  if (plan.delegate) {
    // The head car is not batchable (or not ready): v1's single-car path handles it, one step.
    note('single', `v1 path: ${plan.reason}`, plan.delegate)
    actions.push(...(await runTrain(api, { now, timeoutMinutes, maxSteps: 1, repo: api.repo, base, log })))
    return actions
  }
  const chosen = plan.cars.map((n) => cars.find((c) => c.number === n))
  const started = await startBatch(api, { cars: chosen, baseSha: mainSha, id, mode: 'batch', prefix: BATCH_PREFIX, log })
  if (started.stopped) {
    // R5: car 1 itself does not merge onto main: v1 takes it (it unlabels a conflict).
    note('single', `car 1 ${started.stopped}: v1 path`, chosen[0].number)
    actions.push(...(await runTrain(api, { now, timeoutMinutes, maxSteps: 1, repo: api.repo, base, log })))
    return actions
  }
  const k = started.manifest.cars.length
  for (const [i, car] of started.manifest.cars.entries()) {
    const with_ = started.manifest.cars.filter((c) => c.number !== car.number).map((c) => `#${c.number}`)
    await comment(api, car.number, `waiting: in batch ${id} (${i + 1}/${k}${with_.length ? ` with ${with_.join(' ')}` : ''}); CI runs on ${short(started.tip)}.`)
  }
  note('batch', `batch ${id}: ${started.manifest.cars.map((c) => `#${c.number}`).join(' ')}${started.stopAt !== undefined ? ` (car ${started.stopAt + 1} ${started.stopReason}: it waits)` : ''}`)
  return actions
}

/** Drives the live batch: wait, retry, fall back, or merge. */
async function driveBatch(api, ref, ctx) {
  const { now, timeoutMinutes, id, owner, note, mainSha, log } = ctx
  const abort = async (why) => {
    await api.deleteRef(ref)
    note('abort', `${ref}: ${why}`)
  }
  const tip = await api.getRef(ref)
  const tipCommit = await api.getCommit(tip)
  const manifest = parseManifest(tipCommit.message)
  if (!manifest || manifest.mode === 'shadow') return abort('no valid manifest')
  if (manifest.base !== mainSha) return abort(`main moved from ${short(manifest.base)} to ${short(mainSha)}; rebuilding`)
  for (const car of manifest.cars) {
    const why = await carProblem(api, car)
    if (why) return abort(`#${car.number}: ${why}`)
  }
  const files = []
  for (const car of manifest.cars) files.push(...(await api.prFiles(car.number)).files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)))
  const gates = requiredGates(files)
  const runs = await api.tipRuns(tip)
  const jobs = {}
  for (const run of runs.filter((x) => x.status === 'completed' && x.conclusion !== 'success')) jobs[run.id] = await api.runJobs(run.id)
  const verdict = evaluateBatchCI({ gates, runs, jobs })
  const age = now - Date.parse(tipCommit.date ?? new Date(now).toISOString())

  if (verdict.state === 'missing' || verdict.state === 'pending') {
    if (age > timeoutMinutes * 60_000) {
      await api.deleteRef(ref)
      if (manifest.cars.length > 1) {
        // A slow batch is nobody's fault: every car stays in the queue, labelled, and they are tested one at a time.
        note('fallback', `batch ${manifest.id} waited more than ${timeoutMinutes} minutes for CI; testing its cars one at a time`)
        for (const car of manifest.cars) await comment(api, car.number, `waiting: batch ${manifest.id} waited more than ${timeoutMinutes} minutes for CI, so its PRs are tested one at a time.`)
        await startFallback(api, { cars: manifest.cars.map((c) => c.number), known: manifest.known, mainSha, id, note, now, timeoutMinutes, log })
        return
      }
      // A car that timed out on its own leaves the queue, like v1's per-car timeout; the cars after it go on alone.
      const [car] = manifest.cars
      await comment(api, car.number, `left the queue: waited more than ${timeoutMinutes} minutes for CI on ${short(tip)} (batch ${manifest.id}). Label it again to retry.`)
      await api.removeLabel(car.number)
      note('unlabel', `timed out on its own in ${manifest.id}`, car.number)
      if (manifest.mode === 'fallback' && manifest.rest.length) {
        await startFallback(api, { cars: manifest.rest, known: manifest.known, mainSha, id, note, now, timeoutMinutes, log })
      }
      return
    }
    if (verdict.state === 'missing' && age >= BATCH_DISPATCH_GRACE_MS) {
      for (const gate of gates.filter((g) => verdict.missing.includes(g.name))) await api.dispatchWorkflow(gate.file, ref)
    }
    note('wait', `batch ${manifest.id}: ${verdict.state === 'missing' ? `waiting for ${verdict.missing.join(', ')} to start` : `${verdict.pending.join(', ')} running`}`)
    return
  }

  // R1: before the verdict counts, the train re-derives the chain.
  const derive = async (tag) => rederive(api, manifest.base, manifest.cars, `${id}-${tag}`)
  const carCommits = []
  for (const car of manifest.cars) carCommits.push(await api.getCommit(car.sha))
  const rederived = await derive('a')
  const mismatch = verifyChain({ manifest, tipCommit, carCommits, rederived })
  if (mismatch) return abort(`integrity: ${mismatch}`)

  if (verdict.state === 'red') {
    let flaked = new Set()
    const previous = (await api.recentBatchRuns()).filter((x) => x.headSha !== tip && x.status === 'completed')[0]
    if (previous && previous.runAttempt > 1) flaked = flakesOf(previous, await api.runJobs(previous.id, 1))
    const retry = retryDecision({ failed: verdict.failed, flakedLastBatch: flaked })
    if (retry.retry) {
      for (const runId of retry.runs) await api.rerunFailedJobs(runId)
      note('retry', `batch ${manifest.id}: rerunning failed jobs once (${verdict.failed.map(describeFailure).join('; ')})`)
      return
    }
    const failure = verdict.failed.map(describeFailure).join('; ')
    const ciRun = verdict.runs.find((x) => x.conclusion !== 'success')
    if (manifest.cars.length === 1) {
      const car = manifest.cars[0]
      const together = manifest.mode === 'fallback' ? ' after its batch failed' : ''
      await comment(api, car.number, `left the queue: ${failure} when tested on main${together} (batch ${manifest.id}). Fix it and label it again.`)
      await api.removeLabel(car.number)
      await api.deleteRef(ref)
      note('unlabel', `guilty in ${manifest.id}: ${retry.reason}`, car.number)
      return
    }
    // R8: the linear fallback. Car 1 alone first; the red tree is remembered so a later identical tree is not rerun.
    await api.deleteRef(ref)
    const known = [...manifest.known, { tree: tipCommit.tree, run: ciRun.id }].slice(-MAX_BATCH)
    await startFallback(api, { cars: manifest.cars.map((c) => c.number), known, mainSha, id, note, now, timeoutMinutes, log })
    note('fallback', `batch ${manifest.id} red (${failure}); testing #${manifest.cars[0].number} alone`)
    return
  }

  // Green. R1 again right before merging, then R6 for every car.
  const again = await derive('b')
  if (verifyChain({ manifest, tipCommit, carCommits, rederived: again })) return abort('integrity: the second re-derivation differs')
  const ciRun = verdict.runs.find((x) => x.name === CI_WORKFLOW) ?? verdict.runs[0]
  let prev = manifest.base
  const k = manifest.cars.length
  let merged = 0
  let stop = null
  for (let i = 0; i < k; i++) {
    const car = manifest.cars[i]
    const why = await carProblem(api, car)
    if (why) {
      stop = `#${car.number}: ${why}`
      break
    }
    if ((await api.getRef(api.base ?? 'main')) !== prev) {
      stop = 'main moved during the batch'
      break
    }
    const pull = await api.getPull(car.number)
    const text = mergeCommitMessage({ number: car.number, headRef: pull.headRef, owner, batchId: manifest.id, index: i + 1, count: k, testedRun: ciRun.htmlUrl })
    try {
      await api.mergePull(car.number, car.head, text.title, text.message)
    } catch (error) {
      stop = `#${car.number}: GitHub refused the merge (${cleanName(String(error?.message ?? error))})`
      break
    }
    const newMain = await api.getRef(api.base ?? 'main')
    const after = await api.getCommit(newMain)
    merged = i + 1
    if (after.parents.length !== 2 || after.parents[0] !== prev || after.parents[1] !== car.head) {
      stop = `incident: main ${short(newMain)} has parents ${after.parents.map(short).join(', ')}, not [${short(prev)}, ${short(car.head)}]`
      break
    }
    if (after.tree !== rederived[i]) {
      stop = `incident: main ${short(newMain)} has a tree that is not the derived one`
      break
    }
    await comment(api, car.number, `merged ${short(car.head)} in batch ${manifest.id} (${i + 1}/${k}), tested in ${ciRun.htmlUrl}.`)
    prev = newMain
  }
  await api.deleteRef(ref)
  if (merged > 0) await api.dispatchWorkflow('ci.yml', api.base ?? 'main')
  if (stop) {
    for (const car of manifest.cars.slice(merged)) await comment(api, car.number, `waiting: batch ${manifest.id} stopped before this PR (${stop}).`)
    note(merged > 0 ? 'stop-the-line' : 'abort', `batch ${manifest.id}: ${stop}; ${merged}/${k} merged${merged > 0 ? ', main CI dispatched and the train pauses until it is green' : ''}`)
    return
  }
  // R10: an informational status (never required) on the last car's main commit.
  await api.postStatus(prev, {
    state: 'success',
    context: 'merge-train',
    description: `Batch ${manifest.id}: ${k} PR(s), tested together`.slice(0, 140),
    target_url: ciRun.htmlUrl,
  })
  note('merge', `batch ${manifest.id}: merged ${manifest.cars.map((c) => `#${c.number}`).join(' ')}`)
  if (manifest.mode === 'fallback' && manifest.rest.length) {
    await startFallback(api, { cars: manifest.rest, known: manifest.known, mainSha: prev, id, note, now, timeoutMinutes, log })
  }
}

/**
 * R8: tests the first of `cars` alone on main, carrying the rest and the known red trees. A car whose tree on
 * main is a verified known red tree is guilty without a run (it is the car that turns the green prefix red).
 */
async function startFallback(api, { cars, known, mainSha, id, note, now, timeoutMinutes, log }) {
  const red = await verifiedKnownRed(api, known)
  const queue = orderQueue(await api.listQueue())
  let remaining = [...cars]
  while (remaining.length) {
    const [number, ...rest] = remaining
    const entry = queue.find((e) => e.number === number)
    if (!entry) return note('abort', `fallback stopped at #${number}: it left the queue`)
    const info = await carInfo(api, entry, { now, timeoutMinutes, baseSha: mainSha })
    if (!info || !info.eligible || !info.cls.batchable) return note('abort', `fallback stopped at #${number}: ${info?.why ?? info?.cls.reason ?? 'closed'}`)
    const started = await startBatch(api, { cars: [info], baseSha: mainSha, id, mode: 'fallback', rest, known, prefix: BATCH_PREFIX, log })
    if (started.stopped) return note('abort', `fallback stopped at #${number}: ${started.stopped}`)
    if (!red.has(started.tree)) {
      await comment(api, number, `waiting: its batch did not pass as a whole, so it is tested alone on main (linear mode); CI runs on ${short(started.tip)}.`)
      return
    }
    // Its tree on main is a red tree already tested: it is the car that turns the green prefix red. No new run.
    await api.deleteRef(started.ref)
    const entryRun = known.find((k) => k.tree === started.tree)?.run
    await comment(api, number, `left the queue: with the PRs before it merged, main plus this PR is exactly the tree that failed in https://github.com/${api.repo}/actions/runs/${entryRun}. Fix it and label it again.`)
    await api.removeLabel(number)
    note('unlabel', 'guilty by a known red tree (no new run)', number)
    remaining = rest
  }
}

/**
 * Shadow mode (MERGE_TRAIN_BATCH=1 and MERGE_TRAIN_BATCH_SHADOW=1): builds and tests the batch it would make, under
 * merge-train/shadow-*, only while few runs are active; never merges, comments, labels, retries or cancels. It logs
 * one `merge-train-shadow {json}` line per verdict for the rollout gates.
 */
export async function runShadow(api, opts = {}) {
  const { now = Date.now(), size = MAX_BATCH, maxActiveRuns = 4, runId = '0', runAttempt = '1', log = () => {}, timeoutMinutes = DEFAULT_TIMEOUT_MINUTES } = opts
  const refs = (await api.listTrainRefs()).filter((x) => x.name.startsWith(SHADOW_PREFIX))
  if (refs.length) {
    for (const extra of refs.slice(1)) await api.deleteRef(extra.name)
    const { name } = refs[0]
    const tip = await api.getRef(name)
    const tipCommit = await api.getCommit(tip)
    const manifest = parseManifest(tipCommit.message)
    if (!manifest) return api.deleteRef(name)
    const files = []
    for (const car of manifest.cars) files.push(...(await api.prFiles(car.number)).files.map((f) => f.filename))
    const runs = await api.tipRuns(tip)
    const jobs = {}
    for (const run of runs.filter((x) => x.status === 'completed' && x.conclusion !== 'success')) jobs[run.id] = await api.runJobs(run.id)
    const verdict = evaluateBatchCI({ gates: requiredGates(files), runs, jobs })
    const age = now - Date.parse(tipCommit.date ?? new Date(now).toISOString())
    if (verdict.state === 'green' || verdict.state === 'red' || age > 24 * 3_600_000) {
      const outcome = []
      for (const car of manifest.cars) {
        const pr = await api.getPull(car.number)
        outcome.push({ number: car.number, state: pr?.state ?? 'unknown' })
      }
      const mainTree = (await api.getCommit(await api.getRef(api.base ?? 'main'))).tree
      log(`merge-train-shadow ${JSON.stringify({ id: manifest.id, cars: manifest.cars.map((c) => c.number), verdict: verdict.state, failed: verdict.failed.map(describeFailure), treeMatchesMain: mainTree === tipCommit.tree, outcome, ageMinutes: Math.round(age / 60_000) })}`)
      await api.deleteRef(name)
    }
    return
  }
  if ((await api.activeRunCount()) >= maxActiveRuns) return log('merge-train-shadow skipped: runner queue busy')
  const mainSha = await api.getRef(api.base ?? 'main')
  const queue = orderQueue(await api.listQueue())
  const cars = []
  for (const entry of queue.slice(0, size)) {
    const info = await carInfo(api, entry, { now, timeoutMinutes, baseSha: mainSha })
    if (!info) break
    cars.push(info)
  }
  const plan = planBatch(cars, size)
  if (!plan.cars || plan.cars.length < 2) return
  const chosen = plan.cars.map((n) => cars.find((c) => c.number === n))
  const started = await startBatch(api, { cars: chosen, baseSha: mainSha, id: `${runId}-${runAttempt}`, mode: 'shadow', prefix: SHADOW_PREFIX, log })
  if (started.stopped) log(`merge-train-shadow not built: ${started.stopped}`)
}
