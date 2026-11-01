// @vitest-environment node
// Merge train v2: the SECURITY reviews of #379 and rollout (run identity is in merge-train-runs.test.ts).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  DB_INDEX,
  batchAge,
  SHADOW_PREFIX,
  classifyCar,
  classifyMigration,
  countedMainRuns,
  countedTipRuns,
  isDeterministicRed,
  isTrainDispatch,
  mainHealth,
  mergeCommitMessage,
  parseManifest,
  replanMatches,
  runShadow,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train-batch.mjs'
import { type Any, NOW, fakeGitHub, forge, kinds, train } from '../helpers/merge-train-fake'

describe('SECURITY review of #379', () => {
  it('M1: only the train-dispatched "Full check · <ref>" run, on that ref and commit, counts', () => {
    const base = { event: 'workflow_dispatch', triggeringActor: 'github-actions[bot]', path: '.github/workflows/ci.yml', displayTitle: 'Full check · merge-train/batch-1-1', headRepo: 'o/r', headSha: 'a'.repeat(40), headBranch: 'merge-train/batch-1-1' }
    const at = { sha: 'a'.repeat(40), ref: 'merge-train/batch-1-1', repo: 'o/r' }
    expect(isTrainDispatch(base, at.ref)).toBe(true)
    expect(isTrainDispatch({ ...base, triggeringActor: 'propagno' }, at.ref)).toBe(false)
    expect(isTrainDispatch({ ...base, displayTitle: 'Full check · green-branch' }, at.ref)).toBe(false)
    expect(isTrainDispatch({ ...base, displayTitle: 'Publish · merge-train/batch-1-1' }, at.ref)).toBe(false)
    expect(isTrainDispatch({ ...base, event: 'push' }, at.ref)).toBe(false)
    expect(isTrainDispatch({ ...base, path: '.github/workflows/a11y-axe.yml', displayTitle: 'Accessibility scan (axe)' }, at.ref)).toBe(true)
    expect(countedTipRuns([base, { ...base, headBranch: 'other' }, { ...base, headSha: 'b'.repeat(40) }, { ...base, headRepo: 'fork/r' }], at)).toEqual([base])
    const main = { ...base, displayTitle: 'Full check · main', headBranch: 'main' }
    expect(countedMainRuns([main, { ...main, triggeringActor: 'propagno' }, { ...main, event: 'push', triggeringActor: 'propagno' }], { repo: 'o/r', base: 'main' })).toHaveLength(2)
  })

  it('M1: a newer green run dispatched by a person cannot replace the train run that failed', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    const tip = gh.refs.get(ref)!
    gh.ci(tip, ref, { red: 'CI and Release' })
    gh.tick(60_000)
    gh.ci(tip, ref, { actor: 'propagno' })
    expect((await train(gh, 11))[0].type).toBe('fallback')
    expect(kinds(gh.writes, 'mergePull')).toEqual([])
  })

  it('M1: ci.yml builds the dispatched commit, not the ref by name, and pastes no value into the script', () => {
    const ci = load(readFileSync(join('.github', 'workflows', 'ci.yml'), 'utf8')) as Any
    const step = ci.jobs.build.steps.find((s: Any) => s.id === 'ref')
    expect(step.env).toMatchObject({ RUN_SHA: '${{ github.sha }}', BRANCH_INPUT: '${{ inputs.branch }}', REF_NAME: '${{ github.ref_name }}' })
    expect(step.run).not.toContain('${{')
    expect(step.run).toContain('$override -and $override -ne $env:REF_NAME')
    expect(step.run).toMatch(/else \{ \$env:RUN_SHA \}/)
  })

  it('M4: a forged batch of two migration cars is aborted', async () => {
    const gh = fakeGitHub()
    const dir = 'electron/main/db/migrations/'
    for (const n of [1, 2]) {
      gh.pr(n)
      gh.prs.get(n).files = [{ filename: `${dir}088_m${n}.sql`, status: 'added' }, { filename: DB_INDEX, status: 'modified' }]
      gh.fs.set(`${DB_INDEX}@${gh.prs.get(n).head}`, 'export const LATEST_DB_VERSION = 88')
    }
    const { ref, tip } = await forge(gh, [1, 2])
    gh.trainRun(5)
    gh.ci(tip, ref)
    const actions = await train(gh, 11)
    expect(actions[0]).toMatchObject({ type: 'abort' })
    expect(actions[0].message).toMatch(/the live queue plans #1, not #1 #2/)
    expect(kinds(gh.writes, 'mergePull')).toEqual([])
  })

  it('M4: cars out of queue order, or a car labelled by a triage user, are aborted', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    const out = await forge(gh, [2, 1])
    gh.trainRun(5)
    gh.ci(out.tip, out.ref)
    expect((await train(gh, 11))[0].message).toMatch(/plans #1 #2, not #2 #1/)
    const other = fakeGitHub()
    other.pr(1)
    other.pr(2, ['src/f2.ts'], { labeledBy: 'drive-by' })
    other.api.roles['drive-by'] = 'triage'
    const forged = await forge(other, [1, 2])
    other.trainRun(5)
    other.ci(forged.tip, forged.ref)
    const actions = await train(other, 11)
    expect(actions[0].message).toMatch(/plans #1, not #1 #2/)
    expect(kinds(other.writes, 'mergePull')).toEqual([])
    // replanMatches on its own: a fallback whose rest is not in queue order.
    const third = fakeGitHub()
    for (const n of [1, 2, 3]) third.pr(n)
    const fallback = await forge(third, [1], { mode: 'fallback', rest: [3, 2] })
    const manifest = parseManifest(third.commits.get(fallback.tip)!.message)
    const queue = await third.api.listQueue()
    expect(await replanMatches(third.api, manifest, queue, { now: third.now, size: 3, baseSha: third.refs.get('main') })).toMatchObject({ problem: /ordered part of the queue/ })
    const ok = parseManifest(third.commits.get((await forge(third, [1], { id: '6-1', mode: 'fallback', rest: [2, 3] })).tip)!.message)
    expect((await replanMatches(third.api, ok, queue, { now: third.now, size: 3, baseSha: third.refs.get('main') })).infos).toHaveLength(1)
  })

  it('L1: an incident at the last car pauses the line; so does a 1/1 or k/k commit without the success status', async () => {
    const tip = (count: string) => ({ sha: 'a'.repeat(40), message: `Merge pull request #1\n\nMerge-Train-Batch: 9-1 ${count}\nTested-Run: x` })
    expect(mainHealth({ mainRuns: [], tip: tip('2/2') }).paused).toBe(true)
    expect(mainHealth({ mainRuns: [], tip: tip('1/1'), tipStatus: 'failure' }).paused).toBe(true)
    expect(mainHealth({ mainRuns: [], tip: tip('2/2'), tipStatus: 'success' }).paused).toBe(false)
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref)
    gh.hooks.mergeTree = (patches) => (patches.includes('p2') ? [...patches, 'surprise'] : patches)
    const actions = await train(gh, 11)
    expect(actions[0].message).toMatch(/incident/)
    expect(kinds(gh.writes, 'mergePull')).toHaveLength(2)
    expect(kinds(gh.writes, 'status').at(-1)![2]).toMatchObject({ state: 'failure', context: 'merge-train' })
    expect((await train(gh, 12))[0].type).toBe('paused')
  })

  it('L2: only a deterministic failure becomes a reusable red verdict', async () => {
    const f = (over: Any) => ({ workflow: 'CI and Release', job: 'build', step: 'Unit tests', conclusion: 'failure', ...over })
    expect(isDeterministicRed([f({})])).toBe(true)
    expect(isDeterministicRed([f({ conclusion: 'cancelled' })])).toBe(false)
    expect(isDeterministicRed([f({ conclusion: 'timed_out' })])).toBe(false)
    expect(isDeterministicRed([f({ step: 'E2E smoke (Linux)' })])).toBe(false)
    expect(isDeterministicRed([f({ step: null })])).toBe(false)
    expect(isDeterministicRed([])).toBe(false)
    // A batch red only in E2E after its retry: the fallback carries no known red, so every car gets its own run.
    const gh = fakeGitHub()
    for (const n of [1, 2, 3]) gh.pr(n)
    await train(gh, 10)
    const ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref, { red: 'CI and Release', step: 'E2E smoke (Linux)', attempt: 2 })
    expect((await train(gh, 11))[0].type).toBe('fallback')
    expect(parseManifest(gh.commits.get(gh.refs.get(gh.batchRef()!)!)!.message)!.known).toEqual([])
  })

  it('L3: GitHub refusing car 1 takes it out of the queue instead of rebuilding the same batch forever', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref)
    gh.api.mergePull = async () => {
      throw Object.assign(new Error('Pull Request is not mergeable'), { status: 405 })
    }
    const actions = await train(gh, 11)
    expect(actions[0].type).toBe('abort')
    expect(kinds(gh.writes, 'unlabel').map(([, n]) => n)).toEqual([1])
    expect(gh.comments.get(1)!.at(-1)!.body).toMatch(/GitHub refused the merge \(Pull Request is not mergeable\)/)
    expect(gh.prs.get(2).labels.has('na-fila')).toBe(true)
  })

  it('L5: a change to the migration ladder without a migration file is a migration car that is never batched', () => {
    expect(classifyMigration([{ filename: DB_INDEX, status: 'modified' }], 87, 88)).toMatchObject({ kind: 'invalid' })
    const cls = classifyCar({ headRef: 'x', files: [{ filename: DB_INDEX, status: 'modified' }], complete: true, migration: classifyMigration([{ filename: DB_INDEX, status: 'modified' }], 87, 88) })
    expect(cls.batchable).toBe(false)
  })

  it('L6: a forged shadow ref is logged as unverified and never as a verdict', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    gh.trainRun(20)
    const lines: string[] = []
    await runShadow(gh.api, { now: gh.now, runId: '20', log: (l: string) => lines.push(l) })
    const ref = [...gh.refs.keys()].find((k) => k.startsWith(SHADOW_PREFIX))!
    const real = gh.commits.get(gh.refs.get(ref)!)!
    const forged = gh.commit([...real.patches, 'evil'], real.parents, real.message)
    gh.refs.set(ref, forged)
    gh.ci(forged, ref)
    await runShadow(gh.api, { now: gh.now, runId: '21', log: (l: string) => lines.push(l) })
    expect(lines.some((l) => l.startsWith('merge-train-shadow unverified'))).toBe(true)
    expect(lines.some((l) => l.startsWith('merge-train-shadow {'))).toBe(false)
  })

  it('L8: an integrity failure is an abort before any timeout, and the age comes from the train run, not a commit date', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.trainRun(5, NOW - 10 * 3_600_000)
    const real = await forge(gh, [1])
    const tree = gh.treeOf(['m0', 'p1', 'evil'])
    gh.refs.delete(real.ref)
    await forge(gh, [1], { tree })
    const actions = await train(gh, 11)
    expect(actions[0].message).toMatch(/integrity/)
    expect(kinds(gh.writes, 'unlabel')).toEqual([])
    // A valid ref whose manifest names a run that is not a train run is aborted, not timed out.
    const other = fakeGitHub()
    other.pr(1)
    await forge(other, [1], { id: '777-1' })
    other.runs.push({ id: 777, path: '.github/workflows/ci.yml', headRepo: 'o/r', createdAt: new Date(NOW - 10 * 3_600_000).toISOString() })
    const aborted = await train(other, 11)
    expect(aborted[0].message).toMatch(/start could not be established/)
    expect(kinds(other.writes, 'unlabel')).toEqual([])
  })
})

describe('SECURITY re-review of #379 (N1, L8 residual)', () => {
  it('N1: a car that touches the probes is never batched, and the train never dispatches Provider contract', async () => {
    const cls = classifyCar({ headRef: 'x', files: [{ filename: 'scripts/provider-contract-report.mjs', status: 'modified' }], complete: true, migration: { kind: 'none' } })
    expect(cls).toMatchObject({ batchable: false, reason: expect.stringMatching(/Provider contract, which only its own pull request runs/) })
    const gh = fakeGitHub()
    gh.pr(1, ['scripts/probe-providers.cjs'])
    gh.pr(2)
    const actions = await train(gh, 10)
    expect(actions[0]).toMatchObject({ type: 'single', number: 1 })
    expect(gh.batchRef()).toBeUndefined()
    expect(kinds(gh.writes, 'dispatch').some(([, file]) => file === 'provider-contract.yml')).toBe(false)
  })

  it('N1: Provider contract publishes and edits the issue only on its schedule or a manual run on main, with pinned actions', () => {
    const wf = load(readFileSync(join('.github', 'workflows', 'provider-contract.yml'), 'utf8')) as Any
    const publish = "(github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'))"
    const steps = wf.jobs.report.steps as Any[]
    const named = (name: string) => steps.find((s) => s.name === name)
    expect(named('Publish compatibility.json').if).toBe(publish)
    expect(named('Open or update the issue').if).toBe(`steps.summary.outputs.ok == 'false' && ${publish}`)
    expect(named('Close the issue when the contract holds again').if).toBe(`steps.summary.outputs.ok == 'true' && ${publish}`)
    expect(named('Fail the check without publishing').if).toBe(`steps.summary.outputs.ok == 'false' && !${publish}`)
    expect(steps[0].with['persist-credentials']).toBe(false)
    for (const job of Object.values(wf.jobs) as Any[]) {
      for (const step of job.steps) if (step.uses) expect(step.uses).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/)
      for (const step of job.steps) if (step.run) expect(step.run).not.toContain('${{ inputs.')
    }
  })

  it('L8: a batch is as old as the later of its train run and its tip; a tip dated in the future aborts', async () => {
    expect(batchAge({ builtAt: NOW - 10 * 3_600_000, tipDate: new Date(NOW - 60_000).toISOString(), now: NOW })).toBe(60_000)
    expect(batchAge({ builtAt: NOW - 120_000, tipDate: new Date(NOW - 10 * 3_600_000).toISOString(), now: NOW })).toBe(120_000)
    expect(batchAge({ builtAt: NOW, tipDate: new Date(NOW + 10 * 60_000).toISOString(), now: NOW })).toBeNull()
    expect(batchAge({ builtAt: null, tipDate: new Date(NOW).toISOString(), now: NOW })).toBeNull()
    // A forged single-car ref naming an old, real train run: it waits instead of timing the car out.
    const gh = fakeGitHub()
    gh.pr(1)
    gh.trainRun(5, NOW - 10 * 3_600_000)
    await forge(gh, [1])
    const actions = await train(gh, 11)
    expect(actions[0].type).toBe('wait')
    expect(kinds(gh.writes, 'unlabel')).toEqual([])
  })
})

describe('rollout', () => {
  it('shadow mode builds and tests a batch, logs the verdict, and never merges, comments or labels', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    const lines: string[] = []
    gh.trainRun(20)
    await runShadow(gh.api, { now: gh.now, size: 3, runId: '20', log: (l: string) => lines.push(l) })
    const ref = [...gh.refs.keys()].find((k) => k.startsWith(SHADOW_PREFIX))!
    expect(ref).toBe(`${SHADOW_PREFIX}20-1`)
    gh.ci(gh.refs.get(ref)!, ref)
    await runShadow(gh.api, { now: gh.now, size: 3, runId: '21', log: (l: string) => lines.push(l) })
    const verdict = lines.find((l) => l.startsWith('merge-train-shadow {'))!
    expect(JSON.parse(verdict.slice('merge-train-shadow '.length))).toMatchObject({ verdict: 'green', cars: [1, 2] })
    for (const kind of ['mergePull', 'comment', 'unlabel', 'rerun', 'status']) expect(kinds(gh.writes, kind)).toEqual([])
    expect([...gh.refs.keys()].some((k) => k.startsWith(SHADOW_PREFIX))).toBe(false)
  })

  it('shadow skips a single car and a busy runner queue', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    await runShadow(gh.api, { now: gh.now })
    expect(gh.writes).toEqual([])
    gh.pr(2)
    gh.api.activeRunCount = async () => 10
    const lines: string[] = []
    await runShadow(gh.api, { now: gh.now, log: (l: string) => lines.push(l) })
    expect(lines).toEqual(['merge-train-shadow skipped: runner queue busy'])
  })

  it('batching is off by default: the workflow passes MERGE_TRAIN_BATCH=1 unless the variable says otherwise', () => {
    const wf = load(readFileSync(join('.github', 'workflows', 'merge-train.yml'), 'utf8')) as Any
    const env = wf.jobs.train.steps.at(-1).env
    expect(env.MERGE_TRAIN_BATCH).toBe("${{ vars.MERGE_TRAIN_BATCH || '1' }}")
    expect(env.MERGE_TRAIN_BATCH_SHADOW).toBe("${{ vars.MERGE_TRAIN_BATCH_SHADOW || '0' }}")
    expect(wf.jobs.train.steps[0].with['sparse-checkout']).toContain('scripts/merge-train-batch.mjs')
    const script = readFileSync(join('scripts', 'merge-train.mjs'), 'utf8')
    expect(script).toMatch(/if \(size === 2 \|\| size === 3\)/)
  })

  it('the merge commit message carries the batch and the tested run', () => {
    expect(mergeCommitMessage({ number: 5, headRef: 'feat/x', owner: 'o', batchId: '1-1', index: 1, count: 2, testedRun: 'https://github.com/o/r/actions/runs/9' })).toEqual({
      title: 'Merge pull request #5 from o/feat/x',
      message: 'Merge-Train-Batch: 1-1 1/2\nTested-Run: https://github.com/o/r/actions/runs/9',
    })
  })
})
