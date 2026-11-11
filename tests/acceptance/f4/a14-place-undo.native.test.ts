// Frozen acceptance test for 1.5.0 A14 (OXE program, phase F4), TECH LEAD's decision on HML-705-1: Undo a file or a hunk
// of a place, Restore it once, and Discard a place, all person-only, on safe git. Outside places have no Undo; a stale
// hunk is refused; files the task did not change are never touched; the restore data never reaches the database.
// Written by the planner; the executor must not edit it. SECURITY conditions 1–6 of 08/11.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A14 Undo.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a14-place-undo.native.test.ts
import { existsSync, mkdirSync, readFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ThreadPlace } from '../../../shared/types/thread-places'
import { complete, git, repository, runCleanup, same, sandbox, threadFixture, turn, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(async () => { vi.useRealTimers(); await runCleanup() })

const at = (places: ThreadPlace[], path: string): ThreadPlace => {
  const place = places.find(entry => same(entry.path, path))
  if (!place) throw new Error(`no place at ${path}`)
  return place
}
const LONG = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n') + '\n'

/** A task that edited a.txt (two far-apart hunks) and created new.txt; the person edited c.txt themselves. */
async function edited() {
  const dir = sandbox()
  const repo = repository(dir)
  write(join(repo, 'a.txt'), LONG); write(join(repo, 'c.txt'), 'c\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'long')
  const f = threadFixture(repo)
  await turn(f)
  write(join(repo, 'a.txt'), LONG.replace('line 2\n', 'TASK-HUNK-ONE\n').replace('line 35\n', 'TASK-HUNK-TWO\n'))
  write(join(repo, 'new.txt'), 'created by the task\n')
  f.wrote([join(repo, 'a.txt')], { kind: 'update' })
  f.wrote([join(repo, 'new.txt')], { kind: 'add' })
  await complete(f)
  write(join(repo, 'c.txt'), 'the person\'s own edit\n')
  write(join(repo, 'mine.txt'), 'the person\'s untracked file\n')
  const place = at((await f.manager.places(f.id)).places, repo)
  const diff = await f.manager.placeDiff(f.id, place.id)
  if (!('task' in diff.groups)) throw new Error('git place')
  const file = diff.groups.task.files.find(entry => entry.path === 'a.txt')
  if (!file) throw new Error('a.txt is not in the task group')
  return { dir, repo, f, place, file }
}
const read = (repo: string, name: string) => readFileSync(join(repo, name), 'utf8')

describe('A14 · Undo, Restore and Discard per place', () => {
  test('A14: Undo a file puts it back as it was at the base; Restore puts the task\'s version back once', async () => {
    const { repo, f, place, file } = await edited()
    const undo = await f.manager.placeUndo(f.id, place.id, { path: 'a.txt', seenMtime: file.mtime })
    expect(undo.ok).toBe(true)
    if (!undo.ok) return
    expect(read(repo, 'a.txt')).toBe(LONG)
    expect(read(repo, 'c.txt')).toBe('the person\'s own edit\n')
    expect(undo.restoreToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(await f.manager.placeRestore(f.id, undo.restoreToken)).toEqual({ ok: true })
    expect(read(repo, 'a.txt')).toContain('TASK-HUNK-ONE')
    expect(read(repo, 'a.txt')).toContain('TASK-HUNK-TWO')
    // Single use.
    expect(await f.manager.placeRestore(f.id, undo.restoreToken)).toEqual({ ok: false, refusal: { code: 'thread.place.restoreGone', params: {} } })
  })

  test('A14: Undo one hunk reverts only that hunk', async () => {
    const { repo, f, place, file } = await edited()
    expect(file.hunks.length).toBeGreaterThanOrEqual(2)
    const first = file.hunks.find(hunk => hunk.lines.some(line => JSON.stringify(line).includes('TASK-HUNK-ONE')))
    if (!first) throw new Error('no first hunk')
    expect((await f.manager.placeUndo(f.id, place.id, { path: 'a.txt', hunk: first.header, seenMtime: file.mtime })).ok).toBe(true)
    expect(read(repo, 'a.txt')).not.toContain('TASK-HUNK-ONE')
    expect(read(repo, 'a.txt')).toContain('line 2\n')
    expect(read(repo, 'a.txt')).toContain('TASK-HUNK-TWO')
  })

  test('A14: a file changed again after the diff was read is refused with thread.place.stale, and nothing changes', async () => {
    const { repo, f, place, file } = await edited()
    write(join(repo, 'a.txt'), `${read(repo, 'a.txt')}later edit\n`)
    const later = new Date(Date.now() + 5000); utimesSync(join(repo, 'a.txt'), later, later)
    const before = read(repo, 'a.txt')
    expect(await f.manager.placeUndo(f.id, place.id, { path: 'a.txt', seenMtime: file.mtime })).toEqual({ ok: false, refusal: { code: 'thread.place.stale', params: {} } })
    expect(read(repo, 'a.txt')).toBe(before)
    expect(await f.manager.placeUndo(f.id, place.id, { path: 'a.txt', hunk: '@@ -1,1 +1,1 @@ not a hunk of it', seenMtime: null })).toMatchObject({ ok: false })
    expect(read(repo, 'a.txt')).toBe(before)
  })

  test('A14: a file the task did not change is refused with thread.place.notTask and never touched', async () => {
    const { repo, f, place } = await edited()
    expect(await f.manager.placeUndo(f.id, place.id, { path: 'c.txt', seenMtime: null })).toEqual({ ok: false, refusal: { code: 'thread.place.notTask', params: {} } })
    expect(read(repo, 'c.txt')).toBe('the person\'s own edit\n')
  })

  test('A14: Discard needs confirmed: true; then it reverts only the task\'s files, removing the file it created and nothing else', async () => {
    const { repo, f, place } = await edited()
    expect(await f.manager.placeDiscard(f.id, place.id, {})).toEqual({ ok: false, refusal: { code: 'thread.place.confirm', params: {} } })
    expect(read(repo, 'a.txt')).toContain('TASK-HUNK-ONE')
    expect((await f.manager.placeDiscard(f.id, place.id, { confirmed: true })).ok).toBe(true)
    expect(read(repo, 'a.txt')).toBe(LONG)
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    expect(read(repo, 'c.txt')).toBe('the person\'s own edit\n')
    expect(read(repo, 'mine.txt')).toBe('the person\'s untracked file\n')
  })

  test('A14: an outside place has no Undo and no Discard: thread.place.outside', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const outside = join(dir, 'notes'); mkdirSync(outside); write(join(outside, 'n.md'), 'n\n')
    const f = threadFixture(repo)
    await turn(f)
    f.wrote([join(outside, 'n.md')])
    await complete(f)
    const place = at((await f.manager.places(f.id)).places, outside)
    expect(await f.manager.placeUndo(f.id, place.id, { path: 'n.md', seenMtime: null })).toEqual({ ok: false, refusal: { code: 'thread.place.outside', params: {} } })
    expect(await f.manager.placeDiscard(f.id, place.id, { confirmed: true })).toEqual({ ok: false, refusal: { code: 'thread.place.outside', params: {} } })
    expect(read(outside, 'n.md')).toBe('n\n')
  })

  test('A14: a restore token is bound to its thread and place, ends at the next turn, and expires after 10 minutes', async () => {
    const { f, place, file, repo } = await edited()
    const other = f.create()
    const undo = await f.manager.placeUndo(f.id, place.id, { path: 'a.txt', seenMtime: file.mtime })
    if (!undo.ok) throw new Error('undo refused')
    expect(await f.manager.placeRestore(other, undo.restoreToken)).toEqual({ ok: false, refusal: { code: 'thread.place.restoreGone', params: {} } })
    await turn(f, 'Next turn')
    expect(await f.manager.placeRestore(f.id, undo.restoreToken)).toEqual({ ok: false, refusal: { code: 'thread.place.restoreGone', params: {} } })
    await complete(f)
    // A second undo of the same task file, after it changed again, then ten minutes pass.
    write(join(repo, 'a.txt'), LONG.replace('line 2\n', 'AGAIN\n'))
    const fresh = await f.manager.placeDiff(f.id, place.id)
    const again = 'task' in fresh.groups ? fresh.groups.task.files.find(entry => entry.path === 'a.txt') : undefined
    expect(again).toBeDefined()
    const second = await f.manager.placeUndo(f.id, place.id, { path: 'a.txt', seenMtime: again?.mtime ?? null })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 10 * 60 * 1000 + 1000 })
    expect(await f.manager.placeRestore(f.id, second.restoreToken)).toEqual({ ok: false, refusal: { code: 'thread.place.restoreGone', params: {} } })
  })

  test('A14: the restore data never reaches the database; each undo, restore and discard writes one audit row without content', async () => {
    const { f, place, file } = await edited()
    const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(entry => entry.name)
    const everything = () => tables.map(name => JSON.stringify(f.db.prepare(`SELECT * FROM "${name}"`).all())).join('\n')
    const count = () => everything().split('TASK-HUNK-TWO').length
    // The turn's checkpoints already hold file images; the undo adds no copy of the undone lines anywhere.
    const before = count()
    const undo = await f.manager.placeUndo(f.id, place.id, { path: 'a.txt', seenMtime: file.mtime })
    if (!undo.ok) throw new Error('undo refused')
    expect(count()).toBe(before)
    await f.manager.placeRestore(f.id, undo.restoreToken)
    await f.manager.placeDiscard(f.id, place.id, {})
    await f.manager.placeDiscard(f.id, place.id, { confirmed: true })
    const rows = f.db.prepare("SELECT action, target, outcome, code FROM person_action_audit WHERE action LIKE 'place-%' AND action <> 'place-read' ORDER BY id").all()
    expect(rows).toEqual([
      { action: 'place-undo', target: 'a.txt', outcome: 'ok', code: null },
      { action: 'place-restore', target: 'a.txt', outcome: 'ok', code: null },
      { action: 'place-discard', target: place.path, outcome: 'refused', code: 'thread.place.confirm' },
      { action: 'place-discard', target: place.path, outcome: 'ok', code: null }
    ])
    expect(JSON.stringify(f.db.prepare('SELECT * FROM person_action_audit').all())).not.toContain('TASK-HUNK')
  })
})
