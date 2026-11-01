// @vitest-environment node
// Merge train v2: the batch flow and the ARCHITECT review (R1-R11, Q3).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import {
  BATCH_PREFIX,
  DB_INDEX,
  GENERATOR_GLOBS,
  VERIFY_PREFIX,
  WORKFLOW_GATES,
  buildChain,
  classifyCar,
  classifyMigration,
  evaluateBatchCI,
  flakesOf,
  mainHealth,
  parseBatchTrailer,
  parseManifest,
  planBatch,
  pullRequestOnlyGates,
  renderManifest,
  requiredGates,
  retryDecision,
  verifyChain,
  // @ts-expect-error -- a plain ES module script without type declarations
} from '../../scripts/merge-train-batch.mjs'
import { type Any, fakeGitHub, kinds, train } from '../helpers/merge-train-fake'

describe('batch train: the happy path', () => {
  it('batches three cars, tests the tip once, and merges them in order with trailers and a status', async () => {
    const gh = fakeGitHub()
    const heads = [gh.pr(1), gh.pr(2), gh.pr(3)]
    const first = await train(gh, 10)
    expect(first.map((a: Any) => a.type)).toEqual(['batch'])
    const ref = gh.batchRef()!
    expect(ref).toBe(`${BATCH_PREFIX}10-1`)
    const tip = gh.refs.get(ref)!
    const manifest = parseManifest(gh.commits.get(tip)!.message)!
    expect(manifest.cars.map((c: Any) => c.number)).toEqual([1, 2, 3])
    expect(manifest.cars.map((c: Any) => c.head)).toEqual(heads)
    // ci.yml always, axe for src changes; android and memory not touched.
    expect(kinds(gh.writes, 'dispatch')).toEqual([['dispatch', 'ci.yml', ref], ['dispatch', 'a11y-axe.yml', ref]])
    gh.ci(tip, ref)
    gh.tick(60_000)
    const second = await train(gh, 11)
    expect(second.map((a: Any) => a.type)).toEqual(['merge'])
    const merges = kinds(gh.writes, 'mergePull')
    expect(merges.map(([, n]) => n)).toEqual([1, 2, 3])
    // R10: trailers name the batch, the position and the tested run.
    expect(merges[1][4]).toMatch(/^Merge-Train-Batch: 10-1 2\/3\nTested-Run: https:\/\/github\.com\/o\/r\/actions\/runs\/\d+$/)
    expect(merges[0][3]).toBe('Merge pull request #1 from o/feat/1')
    const status = kinds(gh.writes, 'status')
    expect(status).toHaveLength(1)
    expect(status[0][1]).toBe(gh.refs.get('main'))
    expect(status[0][2]).toMatchObject({ state: 'success', context: 'merge-train' })
    // The final main tree is the tested tip's tree.
    expect(gh.commits.get(gh.refs.get('main')!)!.tree).toBe(gh.commits.get(tip)!.tree)
    expect(kinds(gh.writes, 'dispatch').at(-1)).toEqual(['dispatch', 'ci.yml', 'main'])
    expect(gh.batchRef()).toBeUndefined()
  })

  it('waits while CI runs, and dispatches a gate again only after the grace', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    const before = kinds(gh.writes, 'dispatch').length
    expect((await train(gh, 11)).map((a: Any) => a.type)).toEqual(['wait'])
    expect(kinds(gh.writes, 'dispatch').length).toBe(before)
    gh.tick(4 * 60_000)
    await train(gh, 12)
    expect(kinds(gh.writes, 'dispatch').length).toBe(before + 2)
    gh.ci(gh.refs.get(ref)!, ref, { pending: true })
    expect((await train(gh, 13))[0].message).toMatch(/running/)
  })
})

describe('R1: integrity is re-derived, never read from a ref', () => {
  it('aborts a batch ref whose tip was replaced by an evil merge with the right parents', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    const tip = gh.refs.get(ref)!
    const real = gh.commits.get(tip)!
    // Same parents and manifest, but a tree with content no PR has.
    const forged = gh.commit([...real.patches, 'evil'], real.parents, real.message)
    gh.refs.set(ref, forged)
    gh.ci(forged, ref)
    const actions = await train(gh, 11)
    expect(actions[0]).toMatchObject({ type: 'abort' })
    expect(actions[0].message).toMatch(/integrity/)
    expect(kinds(gh.writes, 'mergePull')).toEqual([])
    expect(gh.batchRef()).toBeUndefined()
  })

  it('aborts when a car commit in the manifest is not the derived one', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    const tip = gh.refs.get(ref)!
    const manifest = parseManifest(gh.commits.get(tip)!.message)!
    const fake = gh.commit(['m0', 'p1', 'sneaky'], [gh.refs.get('main')!, manifest.cars[0].head])
    const tampered = { ...manifest, cars: [{ ...manifest.cars[0], sha: fake }, manifest.cars[1]] }
    const tipCommit = await gh.api.getCommit(tip)
    const carCommits = [await gh.api.getCommit(fake), await gh.api.getCommit(manifest.cars[1].sha)]
    const rederived = [carCommits[0].tree, tipCommit.tree].map((t, i) => (i === 0 ? gh.treeOf(['m0', 'p1']) : t))
    expect(verifyChain({ manifest: tampered, tipCommit, carCommits, rederived })).toMatch(/car 1/)
    expect(verifyChain({ manifest, tipCommit, carCommits: [await gh.api.getCommit(manifest.cars[0].sha), carCommits[1]], rederived })).toBeNull()
  })

  it('re-derives on a scratch ref, before the verdict and again before merging, and removes it', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref)
    await train(gh, 11)
    const scratch = kinds(gh.writes, 'createRef').filter(([, n]) => n.startsWith(VERIFY_PREFIX))
    expect(scratch.map(([, n]) => n)).toEqual([`${VERIFY_PREFIX}11-1-a`, `${VERIFY_PREFIX}11-1-b`])
    expect([...gh.refs.keys()].some((k) => k.startsWith(VERIFY_PREFIX))).toBe(false)
  })

  it('a manifest that is not anchored or out of shape is ignored', () => {
    const good = { v: 1, id: '1-1', mode: 'batch', base: 'a'.repeat(40), cars: [{ number: 1, head: 'b'.repeat(40), sha: 'c'.repeat(40) }], rest: [], known: [] }
    expect(parseManifest(renderManifest(good))).toEqual(good)
    expect(parseManifest(`${renderManifest(good)}\nmore`)).toBeNull()
    expect(parseManifest(renderManifest({ ...good, cars: [] }))).toBeNull()
    expect(parseManifest(renderManifest({ ...good, base: 'main' }))).toBeNull()
    expect(parseManifest(renderManifest({ ...good, mode: 'yolo' }))).toBeNull()
    expect(parseManifest(renderManifest({ ...good, known: [{ tree: 'x', run: 1 }] }))).toBeNull()
  })
})

describe('R2: green means every path-matched gate passed on the tip', () => {
  const workflow = (file: string) => load(readFileSync(join('.github', 'workflows', file), 'utf8')) as Any

  it('the one path table matches the workflow files', () => {
    for (const gate of WORKFLOW_GATES) {
      const wf = workflow(gate.file)
      expect(wf.name).toBe(gate.name)
      const trigger = wf.on.pull_request ?? {}
      if (gate.paths) expect(trigger.paths).toEqual(gate.paths)
      if (gate.pathsIgnore) expect(trigger['paths-ignore']).toEqual(gate.pathsIgnore)
      if (gate.always) expect(trigger.paths ?? trigger['paths-ignore']).toBeUndefined()
      expect(wf.on.workflow_dispatch !== undefined || gate.coveredBy).toBeTruthy()
    }
    // Memory compatibility runs inside a dispatched ci.yml.
    const ci = workflow('ci.yml')
    expect(ci.jobs['memory-compatibility'].uses).toMatch(/memory-compatibility\.yml/)
  })

  it('L4: every workflow that runs on pull requests is a gate in the table', () => {
    const files = readdirSync(join('.github', 'workflows')).filter((f) => f.endsWith('.yml'))
    const onPullRequest = files.filter((f) => workflow(f).on?.pull_request !== undefined)
    expect(onPullRequest.sort()).toEqual(WORKFLOW_GATES.map((g: Any) => g.file).sort())
    // N1: Provider contract is a gate, but never dispatched: the car is not batched (v1 counts its own PR check).
    expect(requiredGates(['scripts/probe-providers.cjs']).map((g: Any) => g.name)).toEqual(['CI and Release', 'Accessibility scan (axe)'])
    expect(pullRequestOnlyGates(['scripts/probe-providers.cjs']).map((g: Any) => g.name)).toEqual(['Provider contract'])
  })

  it('picks the gates from the changed paths', () => {
    const names = (paths: string[]) => requiredGates(paths).map((g: Any) => g.name)
    expect(names(['src/a.ts'])).toEqual(['CI and Release', 'Accessibility scan (axe)'])
    expect(names(['mobile/android/app/x.kt'])).toEqual(['CI and Release', 'Android'])
    expect(names(['shared/remote/protocol.ts'])).toEqual(['CI and Release', 'Android'])
    expect(names(['docs/x.md', 'tests/a.test.ts'])).toEqual(['CI and Release'])
    expect(names(['src/a.ts', 'shared/locales/pt/mobile.json'])).toEqual(['CI and Release', 'Accessibility scan (axe)', 'Android'])
  })

  it('a missing, running or red Android run on the tip is not green', () => {
    const gates = [{ name: 'CI and Release' }, { name: 'Android' }]
    const ok = (name: string, over: Any = {}) => ({ id: name.length, name, status: 'completed', conclusion: 'success', createdAt: '2026-11-01T11:00:00Z', ...over })
    expect(evaluateBatchCI({ gates, runs: [ok('CI and Release')] }).state).toBe('missing')
    expect(evaluateBatchCI({ gates, runs: [ok('CI and Release'), ok('Android', { status: 'in_progress', conclusion: null })] }).state).toBe('pending')
    const red = evaluateBatchCI({ gates, runs: [ok('CI and Release'), ok('Android', { conclusion: 'failure' })], jobs: { 7: [{ name: 'gradle', conclusion: 'failure', steps: [{ name: 'Lint', conclusion: 'failure' }] }] } })
    expect(red).toMatchObject({ state: 'red', failed: [{ workflow: 'Android', job: 'gradle', step: 'Lint' }] })
    // The latest attempt counts.
    expect(evaluateBatchCI({ gates, runs: [ok('CI and Release'), ok('Android', { conclusion: 'failure', createdAt: '2026-11-01T10:00:00Z' }), ok('Android', { id: 9 })] }).state).toBe('green')
  })

  it('a batch touching the Android inputs waits for Android', async () => {
    const gh = fakeGitHub()
    gh.pr(1, ['mobile/android/app/a.kt'])
    await train(gh, 10)
    expect(gh.batchRef()).toBeDefined()
    expect(kinds(gh.writes, 'dispatch').map(([, f]) => f)).toEqual(['ci.yml', 'android.yml'])
  })
})

describe('R3: migrations', () => {
  const add = (filename: string) => ({ filename, status: 'added' })
  const mod = (filename: string) => ({ filename, status: 'modified' })
  const dir = 'electron/main/db/migrations/'

  it('only exactly LATEST_DB_VERSION + 1, with LATEST_DB_VERSION updated, and no existing migration touched', () => {
    expect(classifyMigration([add(`${dir}088_x.sql`), mod(DB_INDEX)], 87, 88)).toEqual({ kind: 'ok', number: 88 })
    expect(classifyMigration([add(`${dir}088_x_posix.sql`), add(`${dir}088_x_win.sql`), mod(DB_INDEX)], 87, 88)).toEqual({ kind: 'ok', number: 88 })
    expect(classifyMigration([add(`${dir}089_x.sql`), mod(DB_INDEX)], 87, 89)).toEqual({ kind: 'renumber', expected: 88, number: 89 })
    expect(classifyMigration([add(`${dir}087_x.sql`), mod(DB_INDEX)], 87, 87).kind).toBe('renumber')
    expect(classifyMigration([add(`${dir}088_x.sql`)], 87, 87)).toMatchObject({ kind: 'invalid', reason: 'LATEST_DB_VERSION must be 88' })
    expect(classifyMigration([add(`${dir}088_x.sql`), mod(DB_INDEX)], 87, 89).kind).toBe('invalid')
    expect(classifyMigration([mod(`${dir}087_activity_entries.sql`), add(`${dir}088_x.sql`), mod(DB_INDEX)], 87, 88)).toMatchObject({ kind: 'invalid', reason: 'it changes an existing migration' })
    expect(classifyMigration([add(`${dir}088_a.sql`), add(`${dir}089_b.sql`), mod(DB_INDEX)], 87, 89).kind).toBe('invalid')
    expect(classifyMigration([add(`${dir}088_a.sql`), add(`${dir}088_b.sql`), mod(DB_INDEX)], 87, 88).kind).toBe('invalid')
    expect(classifyMigration([mod('src/a.ts')], 87, 87)).toEqual({ kind: 'none' })
  })

  it('at most one migration car per batch; a wrong number leaves the queue with the next number', async () => {
    const mig = { batchable: true, solo: false, generator: false, migration: true }
    const plain = { batchable: true, solo: false, generator: false, migration: false }
    expect(planBatch([{ number: 1, eligible: true, cls: mig }, { number: 2, eligible: true, cls: plain }, { number: 3, eligible: true, cls: mig }])).toEqual({ cars: [1, 2] })
    const gh = fakeGitHub()
    gh.pr(1, [`${dir}089_x.sql`, DB_INDEX])
    gh.prs.get(1).files = [add(`${dir}089_x.sql`), mod(DB_INDEX)]
    const actions = await train(gh, 10)
    expect(actions[0]).toMatchObject({ type: 'unlabel', number: 1 })
    expect(gh.comments.get(1)![0].body).toMatch(/renumber the migration: main is at 87, so the next one is 088/)
  })
})

describe('R4, R9, L4 and workflow cars', () => {
  const cls = (paths: string[], headRef = 'feat/x') => classifyCar({ headRef, files: paths.map((filename) => ({ filename, status: 'modified' })), complete: true, migration: { kind: 'none' } })

  it('one generator car per batch, over every generator input', () => {
    expect(GENERATOR_GLOBS).toEqual(['shared/remote/**', 'src/design/tokens/**', 'shared/locales/*/mobile.json', 'scripts/android/**'])
    for (const path of ['shared/remote/protocol.ts', 'src/design/tokens/colors.json', 'shared/locales/en/mobile.json']) expect(cls([path]).generator).toBe(true)
    expect(cls(['shared/locales/en/desktop.json']).generator).toBe(false)
    const gen = cls(['shared/remote/protocol.ts'])
    const plain = cls(['src/a.ts'])
    expect(planBatch([{ number: 1, eligible: true, cls: gen }, { number: 2, eligible: true, cls: plain }, { number: 3, eligible: true, cls: gen }])).toEqual({ cars: [1, 2] })
  })

  it('a car that changes a gate, or a release, runs alone', () => {
    for (const path of ['package.json', 'vitest.config.ts', 'playwright.config.ts', 'eslint.config.mjs', 'tsconfig.json', 'scripts/check-file-size.mjs', 'scripts/android/generate.mjs'])
      expect(cls([path]).solo).toBe(true)
    expect(cls(['src/a.ts'], 'release/1.4.0').solo).toBe(true)
    const solo = cls(['package.json'])
    const plain = cls(['src/a.ts'])
    expect(planBatch([{ number: 1, eligible: true, cls: solo }, { number: 2, eligible: true, cls: plain }])).toEqual({ cars: [1] })
    expect(planBatch([{ number: 1, eligible: true, cls: plain }, { number: 2, eligible: true, cls: solo }, { number: 3, eligible: true, cls: plain }])).toEqual({ cars: [1] })
  })

  it('a workflow-file car or a cut-short file list is never batched: v1 takes it at the head', async () => {
    expect(cls(['.github/workflows/ci.yml']).batchable).toBe(false)
    expect(classifyCar({ headRef: 'x', files: [], complete: false }).batchable).toBe(false)
    const plain = cls(['src/a.ts'])
    expect(planBatch([{ number: 1, eligible: true, cls: cls(['.github/workflows/ci.yml']) }])).toMatchObject({ delegate: 1 })
    expect(planBatch([{ number: 1, eligible: true, cls: plain }, { number: 2, eligible: true, cls: cls(['.github/workflows/ci.yml']) }])).toEqual({ cars: [1] })
    const gh = fakeGitHub()
    gh.pr(1, ['.github/workflows/ci.yml'])
    const actions = await train(gh, 10)
    expect(actions[0]).toMatchObject({ type: 'single', number: 1 })
    expect(gh.batchRef()).toBeUndefined()
  })

  it('a car that is not ready stops the batch before it (no overtaking)', () => {
    const plain = cls(['src/a.ts'])
    expect(planBatch([{ number: 1, eligible: true, cls: plain }, { number: 2, eligible: false, why: 'draft', cls: plain }, { number: 3, eligible: true, cls: plain }])).toEqual({ cars: [1] })
    expect(planBatch([{ number: 1, eligible: false, why: 'draft', cls: plain }])).toEqual({ delegate: 1, reason: 'draft' })
    expect(planBatch([])).toEqual({ idle: true })
  })
})

describe('R5 and R11: building the chain', () => {
  it('a conflict at car i ends the batch at cars 1..i-1', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    gh.pr(3)
    gh.conflicts.add('p2|p3')
    await train(gh, 10)
    const manifest = parseManifest(gh.commits.get(gh.refs.get(gh.batchRef()!)!)!.message)!
    expect(manifest.cars.map((c: Any) => c.number)).toEqual([1, 2])
    // Car 3 waits, labelled, untouched.
    expect(gh.prs.get(3).labels.has('na-fila')).toBe(true)
    gh.conflicts.clear()
    gh.conflicts.add('p1|p2')
    const other = fakeGitHub()
    other.pr(1)
    other.pr(2)
    other.pr(3)
    other.conflicts.add('p1|p2')
    await train(other, 10)
    expect(parseManifest(other.commits.get(other.refs.get(other.batchRef()!)!)!.message)!.cars.map((c: Any) => c.number)).toEqual([1])
  })

  it('car 1 conflicting with main goes to v1, which unlabels it', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.conflicts.add('m0|p1')
    const actions = await train(gh, 10)
    expect(actions[0]).toMatchObject({ type: 'single', number: 1 })
    expect(gh.batchRef()).toBeUndefined()
  })

  it('accepts a merge commit or a fast-forward, and stops at a 204 or an unexpected result', async () => {
    const gh = fakeGitHub()
    const head = gh.pr(1)
    const main = gh.refs.get('main')!
    const chain = await buildChain(gh.api, 'merge-train/t1', main, [{ number: 1, head }])
    expect(chain.steps[0]).toMatchObject({ number: 1, head })
    expect(gh.commits.get(chain.steps[0].sha)!.parents).toEqual([main, head])
    gh.hooks.fastForward = true
    const ff = await buildChain(gh.api, 'merge-train/t2', main, [{ number: 1, head }])
    expect(ff.steps[0].sha).toBe(head)
    gh.hooks.fastForward = false
    const noop = await buildChain(gh.api, 'merge-train/t3', head, [{ number: 1, head }])
    expect(noop).toMatchObject({ stopAt: 0, reason: 'nothing to merge' })
    const odd = {
      ...gh.api,
      mergeInto: async (name: string) => {
        const weird = gh.commit(['x'], ['y'.repeat(40)])
        gh.refs.set(name, weird)
        return { status: 201, sha: weird }
      },
    }
    expect(await buildChain(odd, 'merge-train/t4', main, [{ number: 1, head }])).toMatchObject({ stopAt: 0, reason: 'unexpected merge result' })
  })

  it('M2: uses the commit POST /merges returned, and stops when the ref was swapped under it', async () => {
    const gh = fakeGitHub()
    const head = gh.pr(1)
    const main = gh.refs.get('main')!
    const evil = gh.commit(['m0', 'p1', 'evil'], [main, head])
    gh.hooks.afterMergeInto = (ref) => gh.refs.set(ref, evil)
    expect(await buildChain(gh.api, 'merge-train/t5', main, [{ number: 1, head }])).toMatchObject({ stopAt: 0, reason: 'the ref moved under the train', steps: [] })
    // The train never builds a batch on it: car 1 goes to v1, and nothing is dispatched on a train ref.
    const actions = await train(gh, 10)
    expect(actions[0]).toMatchObject({ type: 'single', number: 1 })
    expect(kinds(gh.writes, 'dispatch').filter(([, , ref]) => String(ref).startsWith('merge-train/'))).toEqual([])
  })

  it('M2: a batch tip swapped right after the train wrote it is not dispatched', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    const updateRef = gh.api.updateRef
    gh.api.updateRef = async (name: string, sha: string) => {
      await updateRef(name, sha)
      gh.refs.set(name, gh.commit(['m0', 'p1', 'p2', 'evil'], [sha]))
    }
    const actions = await train(gh, 10)
    expect(actions[0].type).toBe('single')
    expect(gh.batchRef()).toBeUndefined()
    expect(kinds(gh.writes, 'dispatch').filter(([, , ref]) => String(ref).startsWith('merge-train/'))).toEqual([])
  })
})

describe('R6: merging car by car, and stop the line', () => {
  const ready = async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    gh.pr(3)
    await train(gh, 10)
    const ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref)
    return gh
  }

  it('re-checks each car before its merge: a push to car 2 stops after car 1 and stops the line', async () => {
    const gh = await ready()
    gh.hooks.beforeMergePull = (n) => {
      if (n === 1) gh.prs.get(2).head = gh.commit(['m0', 'p2', 'p2b'], [gh.prs.get(2).head])
    }
    const actions = await train(gh, 11)
    expect(actions[0]).toMatchObject({ type: 'stop-the-line' })
    expect(actions[0].message).toMatch(/#2: its head moved/)
    expect(kinds(gh.writes, 'mergePull').map(([, n]) => n)).toEqual([1])
    expect(kinds(gh.writes, 'dispatch').at(-1)).toEqual(['dispatch', 'ci.yml', 'main'])
    // The next run pauses: main's tip is inside a batch (1/3) with no green run of its own.
    const paused = await train(gh, 12)
    expect(paused[0]).toMatchObject({ type: 'paused' })
    expect(paused[0].message).toMatch(/inside batch 10-1 \(1\/3\)/)
    // A person's dispatch on main never lifts the pause (M1); the train's own one does.
    const mainRun = (over: Any) => ({ headSha: gh.refs.get('main'), headRepo: 'o/r', headBranch: 'main', path: '.github/workflows/ci.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', createdAt: new Date(gh.now).toISOString(), ...over })
    gh.api.mainRunList = [mainRun({ triggeringActor: 'someone', displayTitle: 'Full check · main' })]
    expect((await train(gh, 13))[0].type).toBe('paused')
    gh.api.mainRunList = [mainRun({ triggeringActor: 'github-actions[bot]', displayTitle: 'Full check · main' })]
    expect((await train(gh, 13))[0].type).not.toBe('paused')
  })

  it('a removed label on car 2 stops the merge before it', async () => {
    const gh = await ready()
    gh.hooks.beforeMergePull = (n) => {
      if (n === 1) gh.prs.get(2).labels.delete('na-fila')
    }
    const actions = await train(gh, 11)
    expect(actions[0].message).toMatch(/#2: the na-fila label was removed/)
    expect(kinds(gh.writes, 'mergePull')).toHaveLength(1)
  })

  it('a main commit with other parents or another tree is an incident', async () => {
    const gh = await ready()
    gh.hooks.mergeTree = (patches) => [...patches, 'surprise']
    const actions = await train(gh, 11)
    expect(actions[0].type).toBe('stop-the-line')
    expect(actions[0].message).toMatch(/incident: main .* tree that is not the derived one/)
    expect(kinds(gh.writes, 'mergePull')).toHaveLength(1)
    // A hand merge that lands while car 2 merges: main's new commit is not [previous main, car head].
    const parents = await ready()
    parents.hooks.beforeMergePull = (n) => {
      if (n === 2) parents.refs.set('main', parents.commit(['m0', 'p1', 'hand'], [parents.refs.get('main')!]))
    }
    const again = await train(parents, 11)
    expect(again[0].type).toBe('stop-the-line')
    expect(again[0].message).toMatch(/incident: main \w+ has parents/)
    expect(kinds(parents.writes, 'mergePull').map(([, n]) => n)).toEqual([1, 2])
  })

  it('main moving before the batch merges aborts and rebuilds; a red main pauses', async () => {
    const gh = await ready()
    gh.refs.set('main', gh.commit(['m0', 'hotfix'], [gh.refs.get('main')!]))
    const actions = await train(gh, 11)
    expect(actions[0]).toMatchObject({ type: 'abort' })
    expect(actions[0].message).toMatch(/main moved/)
    expect(mainHealth({ mainRuns: [{ status: 'completed', conclusion: 'failure', createdAt: '2026-11-01T11:00:00Z', htmlUrl: 'https://github.com/o/r/actions/runs/1' }], tip: { sha: 'a', message: 'x' } })).toMatchObject({ paused: true })
    const tip = { sha: 'a'.repeat(40), message: 'Merge pull request #1\n\nMerge-Train-Batch: 9-1 1/2\nTested-Run: x' }
    expect(mainHealth({ mainRuns: [], tip })).toMatchObject({ paused: true, dispatch: true })
    expect(mainHealth({ mainRuns: [{ headSha: tip.sha, status: 'in_progress' }], tip })).toMatchObject({ paused: true, dispatch: false })
    // A finished batch (2/2) carries the train's success status; without it, the line stops (L1).
    expect(mainHealth({ mainRuns: [], tip: { ...tip, message: 'Merge-Train-Batch: 9-1 2/2' }, tipStatus: 'success' })).toMatchObject({ paused: false })
    expect(mainHealth({ mainRuns: [], tip: { ...tip, message: 'Merge-Train-Batch: 9-1 2/2' } })).toMatchObject({ paused: true })
    expect(parseBatchTrailer('x\nMerge-Train-Batch: 9-1 2/3\n')).toEqual({ id: '9-1', index: 2, count: 3 })
  })
})

describe('R7: state from the live refs', () => {
  it('two live batch refs are both aborted; scratch refs from a dead run are removed', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    const main = gh.refs.get('main')!
    gh.refs.set(`${BATCH_PREFIX}1-1`, main)
    gh.refs.set(`${BATCH_PREFIX}2-1`, main)
    gh.refs.set(`${VERIFY_PREFIX}1-1-a`, main)
    const actions = await train(gh, 10)
    expect(actions[0]).toMatchObject({ type: 'abort' })
    expect([...gh.refs.keys()].filter((k) => k.startsWith('merge-train/'))).toEqual([])
  })

  it('a batch that times out goes linear with every car kept; only a car that times out alone leaves', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    gh.pr(3)
    await train(gh, 10)
    gh.tick(61 * 60_000)
    const slow = await train(gh, 11)
    expect(slow[0]).toMatchObject({ type: 'fallback' })
    expect(slow[0].message).toMatch(/one at a time/)
    expect(kinds(gh.writes, 'unlabel')).toEqual([])
    for (const n of [1, 2, 3]) expect(gh.prs.get(n).labels.has('na-fila')).toBe(true)
    let manifest = parseManifest(gh.commits.get(gh.refs.get(gh.batchRef()!)!)!.message)!
    expect(manifest).toMatchObject({ mode: 'fallback', rest: [2, 3] })
    expect(manifest.cars.map((c: Any) => c.number)).toEqual([1])
    // Car 1 now times out on its own: it alone leaves, and car 2 is tested alone next.
    gh.tick(61 * 60_000)
    const alone = await train(gh, 12)
    expect(alone[0]).toMatchObject({ type: 'unlabel', number: 1 })
    expect(kinds(gh.writes, 'unlabel').map(([, n]) => n)).toEqual([1])
    expect(gh.comments.get(1)!.at(-1)!.body).toMatch(/^merge-train: left the queue: waited more than 60 minutes for CI/)
    expect(gh.prs.get(2).labels.has('na-fila')).toBe(true)
    manifest = parseManifest(gh.commits.get(gh.refs.get(gh.batchRef()!)!)!.message)!
    expect(manifest).toMatchObject({ mode: 'fallback', rest: [3] })
    expect(manifest.cars.map((c: Any) => c.number)).toEqual([2])
  })

  it('a solo car that times out leaves like v1', async () => {
    const gh = fakeGitHub()
    gh.pr(1, ['package.json'])
    gh.pr(2)
    await train(gh, 10)
    gh.tick(61 * 60_000)
    const actions = await train(gh, 11)
    expect(actions[0]).toMatchObject({ type: 'unlabel', number: 1 })
    expect(kinds(gh.writes, 'unlabel').map(([, n]) => n)).toEqual([1])
    expect(gh.batchRef()).toBeUndefined()
  })

  it('a ref with no valid manifest is aborted', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.refs.set(`${BATCH_PREFIX}1-1`, gh.refs.get('main')!)
    expect((await train(gh, 10))[0].message).toMatch(/no valid manifest/)
  })
})

describe('R8 and Q3: red batches', () => {
  it('falls back linearly and reuses the red verdict by tree: batch + 2 runs find the guilty third car', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    gh.pr(3)
    await train(gh, 10)
    let ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref, { red: 'CI and Release' })
    const testedTips = new Set([gh.refs.get(ref)!])
    const red = await train(gh, 11)
    expect(red.map((a: Any) => a.type)).toEqual(['fallback'])
    ref = gh.batchRef()!
    let manifest = parseManifest(gh.commits.get(gh.refs.get(ref)!)!.message)!
    expect(manifest).toMatchObject({ mode: 'fallback', rest: [2, 3] })
    expect(manifest.cars.map((c: Any) => c.number)).toEqual([1])
    testedTips.add(gh.refs.get(ref)!)
    gh.ci(gh.refs.get(ref)!, ref)
    await train(gh, 12)
    expect(kinds(gh.writes, 'mergePull').map(([, n]) => n)).toEqual([1])
    ref = gh.batchRef()!
    manifest = parseManifest(gh.commits.get(gh.refs.get(ref)!)!.message)!
    expect(manifest.cars.map((c: Any) => c.number)).toEqual([2])
    testedTips.add(gh.refs.get(ref)!)
    gh.ci(gh.refs.get(ref)!, ref)
    const last = await train(gh, 13)
    expect(kinds(gh.writes, 'mergePull').map(([, n]) => n)).toEqual([1, 2])
    // Main + #3 is exactly the red batch tree: #3 leaves with no new run.
    expect(last.some((a: Any) => a.type === 'unlabel' && a.number === 3)).toBe(true)
    expect(gh.comments.get(3)!.at(-1)!.body).toMatch(/exactly the tree that failed/)
    expect(gh.batchRef()).toBeUndefined()
    expect(testedTips.size).toBe(3)
  })

  it('a red first car alone is guilty; the rest are planned again normally', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    let ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref, { red: 'CI and Release' })
    await train(gh, 11)
    ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref, { red: 'CI and Release', step: 'Typecheck' })
    const actions = await train(gh, 12)
    expect(actions[0]).toMatchObject({ type: 'unlabel', number: 1 })
    expect(gh.comments.get(1)!.at(-1)!.body).toMatch(/at step "Typecheck" \(https:\/\/github\.com\/o\/r\/actions\/runs\/\d+\) when tested on main after its batch failed/)
    expect(gh.batchRef()).toBeUndefined()
    const next = await train(gh, 13)
    expect(next[0].type).toBe('batch')
  })

  it('an E2E failure is retried once; the same tree is never retried twice', async () => {
    const gh = fakeGitHub()
    gh.pr(1)
    gh.pr(2)
    await train(gh, 10)
    const ref = gh.batchRef()!
    gh.ci(gh.refs.get(ref)!, ref, { red: 'CI and Release', step: 'E2E smoke (Linux)' })
    const actions = await train(gh, 11)
    expect(actions[0]).toMatchObject({ type: 'retry' })
    expect(kinds(gh.writes, 'rerun')).toHaveLength(1)
    expect(retryDecision({ failed: [{ workflow: 'CI and Release', job: 'build', step: 'E2E smoke (Linux)', conclusion: 'failure', run: 1, runAttempt: 2 }] })).toMatchObject({ retry: false, reason: 'already retried once for this tree' })
  })

  it('retries only infrastructure and named nondeterministic steps, and not a job that flaked last batch', () => {
    const f = (over: Any) => ({ workflow: 'CI and Release', job: 'Typecheck, test and build (Linux)', step: 'Unit tests', conclusion: 'failure', run: 1, runAttempt: 1, ...over })
    expect(retryDecision({ failed: [f({})] }).retry).toBe(false)
    expect(retryDecision({ failed: [f({ step: 'Typecheck' })] }).retry).toBe(false)
    expect(retryDecision({ failed: [f({ step: 'E2E performance gate (Linux)' })] }).retry).toBe(true)
    expect(retryDecision({ failed: [f({ conclusion: 'cancelled' })] }).retry).toBe(true)
    expect(retryDecision({ failed: [f({ conclusion: 'timed_out' })] }).retry).toBe(true)
    expect(retryDecision({ failed: [f({ step: null })] }).retry).toBe(true)
    expect(retryDecision({ failed: [f({ job: 'OxeQuery live tests (docker; PostgreSQL)', step: 'Live tests' })] }).retry).toBe(true)
    expect(retryDecision({ failed: [f({ workflow: 'Accessibility scan (axe)', job: 'axe (Linux)', step: 'Scan' })] }).retry).toBe(true)
    expect(retryDecision({ failed: [f({ step: 'E2E smoke (Linux)' }), f({ step: 'Lint' })] }).retry).toBe(false)
    const flaked = new Set(['Typecheck, test and build (Linux)'])
    expect(retryDecision({ failed: [f({ step: 'E2E smoke (Linux)' })], flakedLastBatch: flaked })).toMatchObject({ retry: false })
    expect(flakesOf({ conclusion: 'success', runAttempt: 2 }, [{ name: 'a', conclusion: 'failure' }, { name: 'b', conclusion: 'success' }])).toEqual(new Set(['a']))
    expect(flakesOf({ conclusion: 'success', runAttempt: 1 }, [{ name: 'a', conclusion: 'failure' }])).toEqual(new Set())
    expect(flakesOf({ conclusion: 'failure', runAttempt: 2 }, [{ name: 'a', conclusion: 'failure' }])).toEqual(new Set())
  })
})
