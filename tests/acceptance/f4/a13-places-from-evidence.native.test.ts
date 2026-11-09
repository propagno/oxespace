// Frozen acceptance test for 1.5.0 A13 (OXE program, phase F4): a conversation records its places (checkout, worktree,
// outside folder) from tool evidence, with a base per place captured at first touch, up to 32 places + 16 outside.
// Written by the planner; the executor must not edit it. v2 (CR, TECH LEAD 08/11): a repository whose top level is the
// home folder (or a drive or filesystem root) is outside; the fixture sets GIT_CEILING_DIRECTORIES so the result is the
// same on every machine.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A13 (builds on ccr-t71-task-places.md §2.1–§2.3, §5) and DESIGN's
// 1.5.0-f4-design.md "Data each screen needs" (Places).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a13-places-from-evidence.native.test.ts
import { mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { THREAD_PLACE_LIMITS, type ThreadPlace } from '../../../shared/types/thread-places'
import { complete, git, repository, runCleanup, same, sandbox, settle, threadFixture, turn, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 })
afterEach(runCleanup)

const at = (places: ThreadPlace[], path: string): ThreadPlace | undefined => places.find(place => same(place.path, path))
const head = (repo: string): string => git(repo, 'rev-parse', 'HEAD').trim()

describe('A13 · places from evidence', () => {
  test('A13: the limits are 32 places plus 16 outside folders', () => {
    expect(THREAD_PLACE_LIMITS).toEqual({ places: 32, outside: 16 })
  })

  test('A13: migration 094 gives the place tables, with the kinds checked, on a fresh database', () => {
    const f = threadFixture(repository(sandbox()))
    // v3 (CR-F4-1, TECH LEAD 09/11): migrations follow merge order, and F4's thread_places is 094.
    expect(f.db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(94)
    const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name)
    expect(tables).toEqual(expect.arrayContaining(['thread_places', 'thread_place_writes', 'thread_turn_cwd', 'person_action_audit']))
    f.db.prepare("INSERT INTO person_action_audit (ts, actor, action, target, outcome) VALUES (1, 'person', 'place-read', 'x.md', 'ok')").run()
    expect(() => f.db.prepare("UPDATE person_action_audit SET outcome = 'refused'").run()).toThrow()
    expect(() => f.db.prepare("INSERT INTO person_action_audit (ts, actor, action, target, outcome) VALUES (1, 'person', 'git-push', 'x', 'ok')").run()).toThrow()
    const insert = f.db.prepare("INSERT INTO thread_places (thread_id, id, kind, path, first_seen_at) VALUES (?, ?, ?, '/x', 1)")
    expect(() => insert.run(f.id, 'bad', 'elsewhere')).toThrow()
    insert.run(f.id, 'ok', 'outside')
    // Places go with their conversation.
    f.db.prepare('DELETE FROM conversation_threads WHERE id = ?').run(f.id)
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM thread_places').get()).toEqual({ n: 0 })
  })

  test('A13: the root is a place even before any evidence; it is created lazily on the first read', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const f = threadFixture(repo)
    const result = await f.manager.places(f.id)
    expect(result.capped).toBe(false)
    expect(result.refused).toBe(0)
    expect(result.places).toHaveLength(1)
    expect(result.places[0]).toMatchObject({ kind: 'root', writes: 0, files: [], drift: null })
    expect(same(result.places[0].path, repo)).toBe(true)
    expect(result.places[0].current).toEqual({ branch: 'main', commit: head(repo) })
  })

  test('A13: a location into a worktree, a write in a second checkout and a write outside any repository give three places of the right kinds', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const tree = join(dir, 'repo-tree')
    git(repo, 'worktree', 'add', '-q', '-b', 'agent-fix', tree)
    const other = repository(dir, 'other')
    const outside = join(dir, 'notes')
    mkdirSync(outside)
    const f = threadFixture(repo)
    await turn(f)
    f.emit({ type: 'location', cwd: tree })
    // The provider reports a write after it happened, so the folder exists when the evidence arrives.
    write(join(other, 'src', 'x.ts'), 'x\n')
    f.wrote([join(other, 'src', 'x.ts')])
    write(join(outside, 'ROTEIRO.md'), '# r\n')
    f.wrote([join(outside, 'ROTEIRO.md')])
    await complete(f)

    const { places } = await f.manager.places(f.id)
    expect(at(places, repo)?.kind).toBe('root')
    expect(at(places, tree)?.kind).toBe('worktree')
    expect(at(places, other)?.kind).toBe('checkout')
    expect(at(places, outside)?.kind).toBe('outside')
    expect(at(places, other)).toMatchObject({ writes: 1, files: ['src/x.ts'] })
    expect(at(places, outside)).toMatchObject({ writes: 1, files: ['ROTEIRO.md'], base: null })
    // Ids are stable per thread and per canonical path.
    expect(new Set(places.map(place => place.id)).size).toBe(places.length)
    const again = await f.manager.places(f.id)
    expect(again.places.map(place => place.id).sort()).toEqual(places.map(place => place.id).sort())
  })

  test('A13 v2: a repository whose top level is the home folder is outside, never a checkout; the same repository when it is not the home folder is a checkout', async () => {
    // A home folder that is itself a git repository (a dotfile repo), with the project inside it.
    const dir = sandbox()
    const home = repository(dir, 'home')
    const repo = repository(home, 'repo')
    const notes = join(home, 'notes')
    // Injected as the home folder: a write there is outside, and its whole folder is never diffed as a checkout.
    const asHome = threadFixture(repo, { homeDir: home })
    await turn(asHome)
    write(join(notes, 'ROTEIRO.md'), '# r\n')
    asHome.wrote([join(notes, 'ROTEIRO.md')])
    await complete(asHome)
    const homePlaces = (await asHome.manager.places(asHome.id)).places
    expect(at(homePlaces, repo)?.kind).toBe('root')
    expect(homePlaces.some(place => same(place.path, home))).toBe(false)
    expect(at(homePlaces, notes)).toMatchObject({ kind: 'outside', base: null })
    // The same layout with another folder as home: the parent repository is a checkout, as git says.
    const elsewhere = threadFixture(repo, { homeDir: sandbox('oxe-f4-home-') })
    await turn(elsewhere)
    write(join(notes, 'ROTEIRO2.md'), '# r\n')
    elsewhere.wrote([join(notes, 'ROTEIRO2.md')])
    await complete(elsewhere)
    const places = (await elsewhere.manager.places(elsewhere.id)).places
    expect(at(places, home)).toMatchObject({ kind: 'checkout', files: ['notes/ROTEIRO2.md'] })
    expect(places.some(place => place.kind === 'outside')).toBe(false)
  })

  test('A13: a path named only in the agent\'s message text never creates a place', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const other = repository(dir, 'other')
    const third = repository(dir, 'third')
    const f = threadFixture(repo)
    await turn(f)
    f.said(`I changed ${join(other, 'a.txt')} and ${join(dir, 'elsewhere', 'b.md')}`)
    f.wrote([join(third, 'a.txt')], { kind: 'update' })
    await complete(f)
    const { places, refused } = await f.manager.places(f.id)
    expect(places.map(place => place.kind).sort()).toEqual(['checkout', 'root'])
    expect(places.some(place => same(place.path, third))).toBe(true)
    expect(places.some(place => same(place.path, other))).toBe(false)
    expect(refused).toBe(0)
  })

  test('A13: a link out of the folder, a UNC path, a relative escape and a missing folder are refused and counted, never stored', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const target = join(dir, 'target')
    mkdirSync(target)
    const link = join(repo, 'link-out')
    symlinkSync(target, link, 'junction')
    const f = threadFixture(repo)
    await turn(f)
    f.wrote([join(link, 'x.txt')])
    f.wrote(['\\\\server\\share\\x.txt'])
    f.wrote(['../../escape.txt'])
    f.wrote([join(dir, 'missing-folder', 'deep', 'x.txt')])
    f.wrote([`${join(repo, 'a.txt')}\u0000`])
    await complete(f)
    const result = await f.manager.places(f.id)
    expect(result.places.map(place => place.kind)).toEqual(['root'])
    expect(result.places.some(place => same(place.path, target))).toBe(false)
    expect(result.refused).toBe(5)
  })

  test('A13: the base is captured at first touch; when the turn\'s checkpoint for that root opened, it is that checkpoint\'s base commit', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const before = head(repo)
    const f = threadFixture(repo)
    await turn(f)
    f.wrote([join(repo, 'a.txt')], { kind: 'update' })
    write(join(repo, 'a.txt'), 'changed\n')
    await complete(f)
    const checkpoints = f.db.prepare('SELECT root_path, base_commit FROM conversation_checkpoints WHERE thread_id = ?').all(f.id) as Array<{ root_path: string; base_commit: string | null }>
    const root = at((await f.manager.places(f.id)).places, repo)
    expect(root?.base).toMatchObject({ commit: before, branch: 'main' })
    expect(root?.base?.turnId).toBeTruthy()
    expect(checkpoints.some(checkpoint => same(checkpoint.root_path, repo) && checkpoint.base_commit === before)).toBe(true)

    // A later commit on the same branch never moves the base on its own.
    git(repo, 'commit', '-qam', 'more')
    expect(at((await f.manager.places(f.id)).places, repo)?.base?.commit).toBe(before)
  })

  test('A13: a write into a new checkout mid-turn opens that place\'s base then', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const other = repository(dir, 'other')
    const otherHead = head(other)
    const f = threadFixture(repo)
    await turn(f)
    f.wrote([join(other, 'a.txt')], { kind: 'update' })
    await settle()
    // The other checkout moves after first touch: the base stays where it was touched.
    write(join(other, 'c.txt'), 'c\n'); git(other, 'add', '.'); git(other, 'commit', '-qm', 'c')
    await complete(f)
    expect(at((await f.manager.places(f.id)).places, other)?.base).toMatchObject({ commit: otherHead, branch: 'main' })
  })

  test('A13: an unborn branch gives a null base commit', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const fresh = repository(dir, 'fresh', { unborn: true })
    const f = threadFixture(repo)
    await turn(f)
    write(join(fresh, 'new.txt'), 'n\n')
    f.wrote([join(fresh, 'new.txt')])
    await complete(f)
    expect(at((await f.manager.places(f.id)).places, fresh)?.base).toMatchObject({ commit: null, branch: 'main' })
  })

  test('A13: the caps hold: 32 places plus 16 outside folders, then capped with no new place', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const f = threadFixture(repo)
    await turn(f)
    // 16 outside folders, then one more.
    for (let i = 0; i < 17; i++) { const folder = join(dir, `out-${i}`); mkdirSync(folder); f.wrote([join(folder, 'n.md')]) }
    await settle()
    let result = await f.manager.places(f.id)
    expect(result.places.filter(place => place.kind === 'outside')).toHaveLength(16)
    expect(result.capped).toBe(true)
    // Checkouts fill the 32 other places (the root included); the 33rd is not created.
    for (let i = 0; i < 32; i++) f.wrote([join(repository(dir, `co-${i}`, { unborn: true }), 'x.txt')])
    await complete(f)
    result = await f.manager.places(f.id)
    expect(result.places.filter(place => place.kind !== 'outside')).toHaveLength(THREAD_PLACE_LIMITS.places)
    expect(result.places.filter(place => place.kind === 'outside')).toHaveLength(THREAD_PLACE_LIMITS.outside)
    expect(result.places).toHaveLength(48)
    expect(result.capped).toBe(true)
  })

  test('A13: places survive a restart (they are stored), and current is read now, never stored', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const other = repository(dir, 'other')
    const f = threadFixture(repo)
    await turn(f)
    f.wrote([join(other, 'a.txt')], { kind: 'update' })
    await complete(f)
    const rows = f.db.prepare('SELECT kind, path, base_commit FROM thread_places WHERE thread_id = ?').all(f.id) as Array<{ kind: string; path: string; base_commit: string | null }>
    expect(rows.map(row => row.kind).sort()).toEqual(['checkout', 'root'])
    const columns = (f.db.prepare('PRAGMA table_info(thread_places)').all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).not.toContain('current_commit')
    git(other, 'switch', '-q', '-c', 'later')
    expect(at((await f.manager.places(f.id)).places, other)?.current?.branch).toBe('later')
  })
})
