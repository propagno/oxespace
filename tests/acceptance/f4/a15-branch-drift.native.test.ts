// Frozen acceptance test for 1.5.0 A15 (OXE program, phase F4): branch drift is seen once, saved as a place-drift
// event naming "probably your terminal X" (never certain), and answered: Switch back refused on a dirty tree or a
// detached base; Follow moves the base; Dismiss keeps it and splits the list.
// Written by the planner; the executor must not edit it. SECURITY: Switch back is a git write from the UI.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A15 (ccr-t71-task-places.md §2.4, §4.1 thread:place-drift-answer, §4.2).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a15-branch-drift.native.test.ts
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ThreadEvent } from '../../../shared/types/thread'
import type { ThreadPlace } from '../../../shared/types/thread-places'
import { complete, git, repository, runCleanup, same, sandbox, settle, threadFixture, turn, write } from './fixtures/thread-fixture'

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
    const { repo, f } = await touched({ taskFile: 'committed' })
    expect(at((await f.manager.places(f.id)).places, repo).drift).toBeNull()
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
    expect(at((await f.manager.places(f.id)).places, repo).drift).toBeNull()
  })

  test('A15: drift is seen at a turn\'s begin and end, without opening Changes', async () => {
    const { repo, f } = await touched({ taskFile: 'committed' })
    git(repo, 'switch', '-q', 'other')
    await turn(f, 'Next')
    await complete(f)
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
