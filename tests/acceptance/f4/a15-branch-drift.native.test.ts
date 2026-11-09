// Frozen acceptance test for 1.5.0 A15 (OXE program, phase F4): branch drift is seen once, saved as a place-drift
// event naming "probably your terminal X" (never certain), and answered: Switch back refused on a dirty tree or a
// detached base; Follow moves the base; Dismiss keeps it and splits the list. HML 704-1..4: any HEAD move inside this
// conversation's own running shell tool is its own; carried files stay the task's; Switch back waits for the turn; a
// rebase or bisect in progress is no drift; a gone base branch is a refusal; a fast-forward is no drift. TECH LEAD S5:
// every Switch back writes one audit row.
// Written by the planner; the executor must not edit it. SECURITY: Switch back is a git write from the UI. v2 (CR-F4-2,
// 09/11): no fixed sleeps against background drift work; tests wait on the in-order queue or poll the events.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A15 (ccr-t71-task-places.md §2.4, §4.1 thread:place-drift-answer, §4.2).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a15-branch-drift.native.test.ts
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ThreadEvent } from '../../../shared/types/thread'
import type { ThreadPlace } from '../../../shared/types/thread-places'
import { complete, git, repository, runCleanup, same, sandbox, settle, threadFixture, turn, until, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

type Fixture = ReturnType<typeof threadFixture>
const at = (places: ThreadPlace[], path: string): ThreadPlace => {
  const place = places.find(entry => same(entry.path, path))
  if (!place) throw new Error(`no place at ${path}`)
  return place
}
const drifts = (f: Fixture): Array<Extract<ThreadEvent, { type: 'place-drift' }>> =>
  f.read().events.filter((event): event is Extract<ThreadEvent, { type: 'place-drift' }> => event.type === 'place-drift')
const branch = (repo: string): string => git(repo, 'branch', '--show-current').trim()
const head = (repo: string): string => git(repo, 'rev-parse', 'HEAD').trim()

/** A repository with a second branch `other` (b.txt changed), and a conversation that touched it on main. */
async function touched(options: { taskFile?: 'uncommitted' | 'committed'; preCommit?: boolean } = {}) {
  const dir = sandbox()
  const repo = repository(dir)
  git(repo, 'switch', '-q', '-c', 'other'); write(join(repo, 'b.txt'), 'b on other\n'); git(repo, 'commit', '-qam', 'other b'); git(repo, 'switch', '-q', 'main')
  if (options.preCommit) { write(join(repo, 'c.txt'), 'c\n'); git(repo, 'add', 'c.txt'); git(repo, 'commit', '-qm', 'pre') }
  const base = head(repo)
  const f = threadFixture(repo)
  await turn(f)
  write(join(repo, 'a.txt'), 'task\n'); f.wrote([join(repo, 'a.txt')], { kind: 'update' })
  await complete(f)
  if (options.taskFile === 'committed') git(repo, 'commit', '-qam', 'task commit')
  return { dir, repo, base, f }
}

describe('A15 · branch drift', () => {
  test('A15: a branch switch by another process gives one place-drift event; reading again does not repeat it', async () => {
    const { repo, base, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', 'other')
    const first = at((await f.manager.places(f.id)).places, repo)
    expect(first.drift).toMatchObject({ from: { branch: 'main' }, to: { branch: 'other', commit: head(repo) }, certain: false, dirty: false, detached: false })
    expect(first.drift?.answer).toBeUndefined()
    expect(first.base?.commit).toBe(base)
    await f.manager.places(f.id)
    expect(drifts(f)).toHaveLength(1)
    expect(drifts(f)[0]).toMatchObject({ placeId: first.id, certain: false, to: { branch: 'other' } })
  })

  test('A15: the task\'s own commit on the same branch is not drift', async () => {
    const { repo, base, f } = await touched({ taskFile: 'committed' })
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.base?.commit).toBe(base)
    expect(place.current?.commit).toBe(head(repo))
    expect(place.current?.commit).not.toBe(base)
    expect(place.drift).toBeNull()
    expect(drifts(f)).toHaveLength(0)
  })

  test('A15: a reset that leaves the base unreachable is drift, on the same branch', async () => {
    // The base is the 'pre' commit; resetting to the commit before it leaves the base unreachable from HEAD.
    const { repo, f } = await touched({ taskFile: 'committed', preCommit: true })
    await f.manager.places(f.id)
    git(repo, 'reset', '-q', '--hard', 'HEAD~2')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.drift).toMatchObject({ from: { branch: 'main' }, to: { branch: 'main', commit: head(repo) } })
  })

  test('A15: a branch switch the conversation ran itself (an approved git switch) is not drift', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    await turn(f, 'Switch')
    f.emit({ type: 'tool', id: 'sh-1', name: 'Bash', state: 'running', detail: 'git switch other' })
    git(repo, 'switch', '-q', 'other')
    f.emit({ type: 'tool', id: 'sh-1', name: 'Bash', state: 'completed', detail: 'git switch other', exitCode: 0 })
    await complete(f)
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.current?.branch).toBe('other')
    expect(place.base?.branch).toBe('main')
    expect(place.drift).toBeNull()
  })

  test('A15: drift is seen at a turn\'s begin and end, without opening Changes', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', 'other')
    await turn(f, 'Next')
    await complete(f)
    // v2 (CR-F4-2): the turn-end read runs in the background, so wait for it (10 s at most) without asking for the
    // places or a diff, which would be a read point of their own; then it is still one event, not repeated.
    await until(() => drifts(f).length > 0, 'the drift seen at the turn\'s end')
    await settle(300)
    expect(drifts(f)).toHaveLength(1)
  })

  test('A15: by names the one pane in that place as a hint, never certain; with two panes there, both, and with none, nobody', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    f.panes.push({ paneId: 'p-report', title: 'report', workspaceId: 'A', launchDir: repo, agent: false })
    f.panes.push({ paneId: 'p-far', title: 'far', workspaceId: 'A', launchDir: sandbox(), agent: false })
    git(repo, 'switch', '-q', 'other')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.drift?.by).toEqual([{ kind: 'pane', id: 'p-report', title: 'report' }])
    expect(place.drift?.certain).toBe(false)
  })

  test('A15: Switch back runs git switch to the base branch on a clean tree', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', 'other')
    const place = at((await f.manager.places(f.id)).places, repo)
    const answer = await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')
    expect(answer.ok).toBe(true)
    expect(branch(repo)).toBe('main')
    if (answer.ok) expect(answer.place.drift).toMatchObject({ answer: 'switched-back' })
  })

  test('A15: Switch back is refused with thread.place.dirty on a dirty tree, and nothing changes', async () => {
    const { repo, f } = await touched({ taskFile: 'uncommitted' })
    git(repo, 'switch', '-q', 'other')
    const before = head(repo)
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.drift).toMatchObject({ dirty: true })
    const answer = await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')
    expect(answer).toEqual({ ok: false, refusal: { code: 'thread.place.dirty', params: {} } })
    expect(branch(repo)).toBe('other')
    expect(head(repo)).toBe(before)
    expect(git(repo, 'stash', 'list').trim()).toBe('')
  })

  test('A15: Switch back is refused with thread.place.detached when the base had no branch', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    git(repo, 'switch', '-q', '--detach')
    const f = threadFixture(repo)
    await turn(f)
    write(join(repo, 'a.txt'), 'task\n'); f.wrote([join(repo, 'a.txt')], { kind: 'update' })
    await complete(f)
    git(repo, 'commit', '-qam', 'detached commit')
    git(repo, 'switch', '-q', 'main')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.base?.branch).toBeNull()
    expect(place.drift).toMatchObject({ detached: true })
    expect(await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')).toEqual({ ok: false, refusal: { code: 'thread.place.detached', params: {} } })
    expect(branch(repo)).toBe('main')
  })

  test('A15: Follow sets the base to the drift\'s target and keeps the record; no repository change', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', 'other')
    const target = head(repo)
    const place = at((await f.manager.places(f.id)).places, repo)
    const answer = await f.manager.answerPlaceDrift(f.id, place.id, 'followed')
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.place.base).toMatchObject({ commit: target, branch: 'other' })
    expect(answer.place.drift).toMatchObject({ answer: 'followed' })
    expect(branch(repo)).toBe('other')
    // Reading again sees no new drift: the base is the new branch now.
    await settle()
    await f.manager.places(f.id)
    expect(drifts(f)).toHaveLength(1)
  })

  test('A15: Dismiss keeps the base; the diff keeps the task\'s files apart from the switch\'s', async () => {
    const { repo, base, f } = await touched({ taskFile: 'uncommitted' })
    git(repo, 'switch', '-q', 'other')
    const place = at((await f.manager.places(f.id)).places, repo)
    const answer = await f.manager.answerPlaceDrift(f.id, place.id, 'dismissed')
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.place.base?.commit).toBe(base)
    const diff = await f.manager.placeDiff(f.id, place.id)
    if (!('task' in diff.groups)) throw new Error('git place')
    expect(diff.groups.task.files.map(file => file.path)).toEqual(['a.txt'])
    expect(diff.groups.branchSwitch?.files.map(file => file.path)).toEqual(['b.txt'])
  })

  test('A15: an answer outside the closed list, or for a place without drift, is refused', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    const place = at((await f.manager.places(f.id)).places, repo)
    await expect(f.manager.answerPlaceDrift(f.id, place.id, 'force' as never)).rejects.toThrow()
    expect(await f.manager.answerPlaceDrift(f.id, place.id, 'followed')).toEqual({ ok: false, refusal: { code: 'thread.place.noDrift', params: {} } })
    expect(await f.manager.answerPlaceDrift(f.id, 'gone-place', 'followed')).toEqual({ ok: false, refusal: { code: 'thread.place.gone', params: {} } })
  })

  test('A15: the place-drift event round-trips through the portable export; imported places have no bases', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', 'other')
    await f.manager.places(f.id)
    const portable = f.manager.exportPortable(f.id)
    const target = f.create()
    f.manager.importPortable(target, portable)
    expect(f.read(target).events.filter(event => event.type === 'place-drift')).toHaveLength(1)
    const imported = await f.manager.places(target)
    expect(imported.places.every(place => place.base === null || place.kind === 'root')).toBe(true)
  })
})

describe('A15 · HML 704 and SECURITY S5', () => {
  test('HML 704-1: a HEAD move inside the conversation\'s own running shell tool is its own, whatever the command', async () => {
    for (const command of ['gh pr checkout 12', 'git fetch && git switch -c pr-x', 'cd sub && git checkout -b y', "bash -c 'git switch other'"]) {
      const { repo, f } = await touched({ taskFile: 'committed' })
      await turn(f, 'Move')
      f.emit({ type: 'tool', id: 'sh-own', name: 'Bash', state: 'running', detail: command })
      // v2 (CR-F4-2): wait until OXESpace has taken in the tool's start; drift work runs in the order it was asked,
      // so a places() read returns only after it. A fixed sleep raced it when several phases ran at once.
      await f.manager.places(f.id)
      git(repo, 'switch', '-q', '-c', `moved-${Date.now()}`)
      f.emit({ type: 'tool', id: 'sh-own', name: 'Bash', state: 'completed', detail: command, exitCode: 0 })
      await complete(f)
      const place = at((await f.manager.places(f.id)).places, repo)
      expect(place.current?.branch, command).not.toBe('main')
      expect(place.drift, command).toBeNull()
    }
  })

  test('HML 704-1: the same move after the tool completed is drift', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    await turn(f, 'Move')
    f.emit({ type: 'tool', id: 'sh-done', name: 'Bash', state: 'running', detail: 'ls' })
    f.emit({ type: 'tool', id: 'sh-done', name: 'Bash', state: 'completed', detail: 'ls', exitCode: 0 })
    // v2 (CR-F4-2): the tool has ended for OXESpace (its bookkeeping ran) before the person switches.
    await f.manager.places(f.id)
    git(repo, 'switch', '-q', 'other')
    await complete(f)
    expect(at((await f.manager.places(f.id)).places, repo).drift).toMatchObject({ to: { branch: 'other' } })
  })

  test('HML 704-2: files the task left uncommitted, carried by a person\'s switch, stay the task\'s, also after Follow', async () => {
    const { repo, f } = await touched({ taskFile: 'uncommitted' })
    git(repo, 'switch', '-q', 'other')
    const place = at((await f.manager.places(f.id)).places, repo)
    let diff = await f.manager.placeDiff(f.id, place.id)
    if (!('task' in diff.groups)) throw new Error('git place')
    expect(diff.groups.task.files.map(file => file.path)).toEqual(['a.txt'])
    expect(diff.groups.branchSwitch?.files.map(file => file.path)).toEqual(['b.txt'])
    expect((await f.manager.answerPlaceDrift(f.id, place.id, 'followed')).ok).toBe(true)
    diff = await f.manager.placeDiff(f.id, place.id)
    if (!('task' in diff.groups)) throw new Error('git place')
    expect(diff.groups.task.files.map(file => file.path)).toEqual(['a.txt'])
    expect(diff.groups.branchSwitch).toBeUndefined()
  })

  test('HML 704-3: Switch back while the conversation\'s turn runs is thread.place.busy with nothing changed, then works after the turn', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', 'other')
    const place = at((await f.manager.places(f.id)).places, repo)
    await turn(f, 'Busy')
    expect(await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')).toEqual({ ok: false, refusal: { code: 'thread.place.busy', params: {} } })
    expect(branch(repo)).toBe('other')
    await complete(f)
    expect((await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')).ok).toBe(true)
    expect(branch(repo)).toBe('main')
  })

  test('HML 704-4: a rebase or a bisect in progress at turn end is no drift; once it ends where it started, still none', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    // A rebase that stops on a conflict leaves HEAD detached mid-way.
    write(join(repo, 'b.txt'), 'b on main\n'); git(repo, 'commit', '-qam', 'main b')
    await turn(f, 'During a rebase')
    try { git(repo, 'rebase', 'other') } catch { /* stops on the b.txt conflict */ }
    await complete(f)
    expect(at((await f.manager.places(f.id)).places, repo).drift).toBeNull()
    git(repo, 'rebase', '--abort')
    expect(at((await f.manager.places(f.id)).places, repo).drift).toBeNull()
    git(repo, 'bisect', 'start'); git(repo, 'bisect', 'bad'); git(repo, 'bisect', 'good', 'HEAD~2')
    await turn(f, 'During a bisect')
    await complete(f)
    expect(at((await f.manager.places(f.id)).places, repo).drift).toBeNull()
    git(repo, 'bisect', 'reset')
    expect(drifts(f)).toHaveLength(0)
  })

  test('HML 704-4: a fast-forward of the same branch (a pull) is no drift', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', '-c', 'ahead'); write(join(repo, 'c.txt'), 'c\n'); git(repo, 'add', 'c.txt'); git(repo, 'commit', '-qm', 'ahead'); git(repo, 'switch', '-q', 'main')
    git(repo, 'merge', '-q', '--ff-only', 'ahead')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.current?.commit).not.toBe(place.base?.commit)
    expect(place.drift).toBeNull()
  })

  test('HML 704-4: Switch back to a base branch that was deleted is thread.place.branchGone, not a thrown error', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    git(repo, 'switch', '-q', '-c', 'feature')
    const f = threadFixture(repo)
    await turn(f)
    write(join(repo, 'a.txt'), 'task\n'); f.wrote([join(repo, 'a.txt')], { kind: 'update' })
    await complete(f)
    git(repo, 'checkout', '-q', '--', 'a.txt'); git(repo, 'switch', '-q', 'main'); git(repo, 'branch', '-q', '-D', 'feature')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.drift).not.toBeNull()
    expect(await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')).toEqual({ ok: false, refusal: { code: 'thread.place.branchGone', params: { branch: 'feature' } } })
    expect(branch(repo)).toBe('main')
  })

  test('S5: every Switch back writes one audit row (who, place, branch, outcome), refusals included', async () => {
    const { repo, f } = await touched({ taskFile: 'uncommitted' })
    git(repo, 'switch', '-q', 'other')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect((await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')).ok).toBe(false)
    git(repo, 'checkout', '-q', '--', 'a.txt') // the person cleans the tree
    expect((await f.manager.answerPlaceDrift(f.id, place.id, 'switched-back')).ok).toBe(true)
    const rows = f.db.prepare('SELECT actor, action, thread_id, place_id, target, outcome, code FROM person_action_audit ORDER BY id').all()
    expect(rows).toEqual([
      { actor: 'person', action: 'place-switch-back', thread_id: f.id, place_id: place.id, target: 'main', outcome: 'refused', code: 'thread.place.dirty' },
      { actor: 'person', action: 'place-switch-back', thread_id: f.id, place_id: place.id, target: 'main', outcome: 'ok', code: null }
    ])
  })
})
