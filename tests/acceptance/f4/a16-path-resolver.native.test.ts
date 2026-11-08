// Frozen acceptance test for 1.5.0 A16 (OXE program, phase F4): one path resolver in main, in the order absolute →
// turn cwd → checkoutRoot → task worktree → project root → other places → sibling worktrees. It answers found,
// ambiguous (the window asks) or missing (with where it looked).
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A16 (ccr-t71-task-places.md §3) and DESIGN's 1.5.0-f4-design.md (Resolver).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a16-path-resolver.native.test.ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { THREAD_PATH_STEPS, type ThreadPathResolution } from '../../../shared/types/thread-places'
import { complete, git, repository, runCleanup, same, sandbox, threadFixture, turn, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

function found(result: ThreadPathResolution): Extract<ThreadPathResolution, { kind: 'found' }> {
  if (result.kind !== 'found') throw new Error(`expected found, got ${JSON.stringify(result)}`)
  return result
}

/**
 * repo (the thread's root) with a worktree `tree` the task moved into in turn 1, a subfolder `tree/sub` it worked in
 * during turn 2, an outside folder it wrote in, and a sibling worktree `side` it never touched.
 */
async function layout() {
  const dir = sandbox()
  const repo = repository(dir)
  const tree = join(dir, 'tree'); git(repo, 'worktree', 'add', '-q', '-b', 'agent-fix', tree)
  const side = join(dir, 'side'); git(repo, 'worktree', 'add', '-q', '-b', 'side', side)
  const outside = join(dir, 'notes'); mkdirSync(outside)
  const sub = join(tree, 'sub'); mkdirSync(sub)
  write(join(sub, 'in-cwd.txt'), 'cwd\n')
  write(join(tree, 'in-tree-root.txt'), 'tree root\n')
  write(join(repo, 'in-project-root.txt'), 'project\n')
  write(join(outside, 'ROTEIRO.md'), '# r\n')
  write(join(side, 'only-in-side.txt'), 'side\n')
  write(join(sub, 'both.txt'), 'cwd copy\n'); write(join(repo, 'both.txt'), 'project copy\n')
  const f = threadFixture(repo)
  await turn(f, 'One')
  f.emit({ type: 'location', cwd: tree })
  f.wrote([join(outside, 'ROTEIRO.md')])
  await complete(f)
  await turn(f, 'Two')
  f.emit({ type: 'location', cwd: sub })
  await complete(f)
  return { dir, repo, tree, side, outside, sub, f }
}

describe('A16 · one path resolver', () => {
  test('A16: the steps, in order', () => {
    expect(THREAD_PATH_STEPS).toEqual(['absolute', 'turn-cwd', 'checkout-root', 'task-worktree', 'project-root', 'task-place', 'sibling-worktree'])
  })

  test('A16: each step is hit when the earlier ones miss', async () => {
    const { repo, tree, side, outside, sub, f } = await layout()
    const resolve = async (raw: string) => found(await f.manager.resolvePath(f.id, raw))
    expect(await resolve(join(repo, 'a.txt'))).toMatchObject({ via: 'absolute' })
    const cwd = await resolve('in-cwd.txt')
    expect(cwd.via).toBe('turn-cwd'); expect(same(cwd.path, join(sub, 'in-cwd.txt'))).toBe(true)
    const checkout = await resolve('in-tree-root.txt')
    expect(checkout.via).toBe('checkout-root'); expect(same(checkout.path, join(tree, 'in-tree-root.txt'))).toBe(true)
    const project = await resolve('in-project-root.txt')
    expect(project.via).toBe('project-root'); expect(same(project.path, join(repo, 'in-project-root.txt'))).toBe(true)
    const place = await resolve('ROTEIRO.md')
    expect(place.via).toBe('task-place'); expect(same(place.path, join(outside, 'ROTEIRO.md'))).toBe(true)
    expect(place.placeId).toBeTruthy()
    const sibling = await resolve('only-in-side.txt')
    expect(sibling.via).toBe('sibling-worktree'); expect(same(sibling.path, join(side, 'only-in-side.txt'))).toBe(true)
    expect(sibling.placeId).toBeNull()
  })

  test('A16: the task worktree is tried when the turn\'s cwd and its checkout miss', async () => {
    const { repo, tree, f } = await layout()
    await turn(f, 'Three')
    f.emit({ type: 'location', cwd: join(repo) })
    await complete(f)
    write(join(tree, 'tree-only.txt'), 't\n')
    const hit = found(await f.manager.resolvePath(f.id, 'tree-only.txt'))
    expect(hit.via).toBe('task-worktree')
    expect(same(hit.path, join(tree, 'tree-only.txt'))).toBe(true)
  })

  test('A16: the first hit wins', async () => {
    const { sub, f } = await layout()
    const hit = found(await f.manager.resolvePath(f.id, 'both.txt'))
    expect(hit.via).toBe('turn-cwd')
    expect(same(hit.path, join(sub, 'both.txt'))).toBe(true)
  })

  test('A16: a turn id picks that turn\'s cwd', async () => {
    const { tree, f } = await layout()
    write(join(tree, 'both.txt'), 'tree copy\n')
    const first = f.read().turns?.[0]?.id
    expect(first).toBeTruthy()
    const hit = found(await f.manager.resolvePath(f.id, 'both.txt', { turnId: first }))
    expect(same(hit.path, join(tree, 'both.txt'))).toBe(true)
    expect(hit.via).toBe('turn-cwd')
  })

  test('A16: a line suffix is kept apart from the path', async () => {
    const { sub, f } = await layout()
    const hit = found(await f.manager.resolvePath(f.id, 'in-cwd.txt:12'))
    expect(same(hit.path, join(sub, 'in-cwd.txt'))).toBe(true)
    expect(hit.line).toBe(12)
  })

  test('A16: the same relative path in two places, or two sibling worktrees, is ambiguous and opens nothing', async () => {
    const { dir, repo, outside, f } = await layout()
    const second = join(dir, 'drafts'); mkdirSync(second)
    write(join(second, 'PLAN.md'), 'b\n'); write(join(outside, 'PLAN.md'), 'a\n')
    await turn(f, 'Four')
    f.wrote([join(second, 'PLAN.md')])
    await complete(f)
    const twoPlaces = await f.manager.resolvePath(f.id, 'PLAN.md')
    expect(twoPlaces.kind).toBe('ambiguous')
    if (twoPlaces.kind === 'ambiguous') {
      expect(twoPlaces.candidates).toHaveLength(2)
      expect(twoPlaces.candidates.every(candidate => candidate.via === 'task-place' && candidate.placeId)).toBe(true)
    }
    const third = join(dir, 'third'); git(repo, 'worktree', 'add', '-q', '-b', 'third', third)
    write(join(third, 'twin.txt'), '1\n'); write(join(dir, 'side', 'twin.txt'), '2\n')
    const siblings = await f.manager.resolvePath(f.id, 'twin.txt')
    expect(siblings.kind).toBe('ambiguous')
    if (siblings.kind === 'ambiguous') expect(siblings.candidates.map(candidate => candidate.via)).toEqual(['sibling-worktree', 'sibling-worktree'])
  })

  test('A16: a miss is missing, listing every step it tried and where', async () => {
    const { f } = await layout()
    const result = await f.manager.resolvePath(f.id, 'nowhere.txt')
    expect(result.kind).toBe('missing')
    if (result.kind !== 'missing') return
    const steps = [...new Set(result.looked.map(entry => entry.step))]
    expect(steps).toEqual(['turn-cwd', 'checkout-root', 'task-worktree', 'project-root', 'task-place', 'sibling-worktree'])
    expect(result.looked.every(entry => typeof entry.path === 'string' && entry.path.length > 0)).toBe(true)
  })

  test('A16: a .. escape out of a base is refused at that step and listed, never found', async () => {
    const { dir, f } = await layout()
    write(join(dir, 'secret.txt'), 's\n')
    const result = await f.manager.resolvePath(f.id, '../../secret.txt')
    expect(result.kind).toBe('missing')
  })

  test('A16: input is bounded: more than 4096 characters or a NUL is refused', async () => {
    const { f } = await layout()
    await expect(f.manager.resolvePath(f.id, 'a'.repeat(4097))).rejects.toThrow()
    await expect(f.manager.resolvePath(f.id, 'a\u0000b')).rejects.toThrow()
  })

  test('A16: resolving a path never creates a place', async () => {
    const { side, f } = await layout()
    const before = (await f.manager.places(f.id)).places.length
    await f.manager.resolvePath(f.id, 'only-in-side.txt')
    const after = await f.manager.places(f.id)
    expect(after.places).toHaveLength(before)
    expect(after.places.some(place => same(place.path, side))).toBe(false)
  })
})
