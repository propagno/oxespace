// Frozen acceptance test for 1.5.0 A14 (OXE program, phase F4): Changes groups by place, each against its own base. A
// branch switch made by a terminal does not change the task's diff; outside folders list written files with no diff.
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A14 (ccr-t71-task-places.md §2.5, §2.6, §4.1 thread:place-diff).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a14-place-diff.native.test.ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { messageFromError } from '../../../shared/messages'
import type { ThreadPlace } from '../../../shared/types/thread-places'
import { complete, git, repository, runCleanup, same, sandbox, threadFixture, turn, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

const at = (places: ThreadPlace[], path: string): ThreadPlace => {
  const place = places.find(entry => same(entry.path, path))
  if (!place) throw new Error(`no place at ${path}`)
  return place
}
const paths = (diff: { files: Array<{ path: string }> } | undefined): string[] => (diff?.files ?? []).map(file => file.path).sort()

describe('A14 · Changes per place, each against its base', () => {
  test('A14: two checkouts each diff against their own base, and only their own files', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const other = repository(dir, 'other')
    const f = threadFixture(repo)
    await turn(f)
    write(join(repo, 'a.txt'), 'task change\n'); f.wrote([join(repo, 'a.txt')], { kind: 'update' })
    write(join(other, 'b.txt'), 'other change\n'); f.wrote([join(other, 'b.txt')], { kind: 'update' })
    await complete(f)
    const { places } = await f.manager.places(f.id)
    const root = await f.manager.placeDiff(f.id, at(places, repo).id)
    const second = await f.manager.placeDiff(f.id, at(places, other).id)
    expect('groups' in root && 'task' in root.groups).toBe(true)
    if (!('task' in root.groups) || !('task' in second.groups)) throw new Error('git places diff')
    expect(paths(root.groups.task)).toEqual(['a.txt'])
    expect(paths(second.groups.task)).toEqual(['b.txt'])
    expect(root.groups.branchSwitch).toBeUndefined()
    expect(same(root.place.path, repo)).toBe(true)
  })

  test('A14: the task\'s own commits stay its changes: the diff is against the base, not HEAD', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const f = threadFixture(repo)
    await turn(f)
    write(join(repo, 'a.txt'), 'committed by the task\n'); f.wrote([join(repo, 'a.txt')], { kind: 'update' })
    await complete(f)
    git(repo, 'commit', '-qam', 'task commit')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.drift).toBeNull()
    const diff = await f.manager.placeDiff(f.id, place.id)
    if (!('task' in diff.groups)) throw new Error('git place')
    expect(paths(diff.groups.task)).toEqual(['a.txt'])
  })

  test('A14: a terminal\'s branch switch does not change the task\'s diff; the switch\'s files are a separate group', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    // A branch that changes b.txt, made before the task starts.
    git(repo, 'switch', '-q', '-c', 'other'); write(join(repo, 'b.txt'), 'b on other\n'); git(repo, 'commit', '-qam', 'other b'); git(repo, 'switch', '-q', 'main')
    const f = threadFixture(repo)
    await turn(f)
    write(join(repo, 'a.txt'), 'task change\n'); f.wrote([join(repo, 'a.txt')], { kind: 'update' })
    await complete(f)
    // The person's terminal switches the checkout; the task's uncommitted a.txt is carried along.
    git(repo, 'switch', '-q', 'other')
    const place = at((await f.manager.places(f.id)).places, repo)
    expect(place.drift).not.toBeNull()
    const diff = await f.manager.placeDiff(f.id, place.id)
    if (!('task' in diff.groups)) throw new Error('git place')
    expect(paths(diff.groups.task)).toEqual(['a.txt'])
    expect(paths(diff.groups.branchSwitch)).toEqual(['b.txt'])
  })

  test('A14: an unborn branch diffs against the empty tree', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const fresh = repository(dir, 'fresh', { unborn: true })
    const f = threadFixture(repo)
    await turn(f)
    write(join(fresh, 'new.txt'), 'n\n'); git(fresh, 'add', 'new.txt'); f.wrote([join(fresh, 'new.txt')])
    await complete(f)
    const diff = await f.manager.placeDiff(f.id, at((await f.manager.places(f.id)).places, fresh).id)
    if (!('task' in diff.groups)) throw new Error('git place')
    expect(paths(diff.groups.task)).toEqual(['new.txt'])
  })

  test('A14: an outside folder lists the written files, with their kind and counts, and no diff base', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const outside = join(dir, 'notes')
    mkdirSync(outside)
    const f = threadFixture(repo)
    await turn(f)
    write(join(outside, 'ROTEIRO.md'), '# r\n')
    f.emit({ type: 'tool', id: 'w1', name: 'Write', state: 'completed', detail: 'ROTEIRO', files: [{ path: join(outside, 'ROTEIRO.md'), kind: 'add', source: 'tool-input', state: 'completed', additions: 1, deletions: 0 }] })
    await complete(f)
    const place = at((await f.manager.places(f.id)).places, outside)
    expect(place.kind).toBe('outside')
    const diff = await f.manager.placeDiff(f.id, place.id)
    expect('written' in diff.groups).toBe(true)
    if (!('written' in diff.groups)) throw new Error('outside place')
    expect(diff.groups.written).toEqual([expect.objectContaining({ path: 'ROTEIRO.md', kind: 'add', additions: 1, deletions: 0 })])
  })

  test('A14: an unknown place id is refused with thread.place.gone', async () => {
    const dir = sandbox()
    const f = threadFixture(repository(dir))
    const error = await f.manager.placeDiff(f.id, 'no-such-place').then(() => null, (cause: unknown) => cause)
    expect(messageFromError(error)).toEqual({ code: 'thread.place.gone', params: {} })
  })
})
