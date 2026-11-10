// Frozen acceptance test for 1.5.0 A54 / N3 (OXE program, phase F4): when two conversations have uncommitted edits to
// the same file in the same checkout, both get a collision with the path. A different checkout does not collide; the
// collision clears when either side's edit is committed or undone.
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A54 and DESIGN's 1.5.0-f4-design.md U4.5 (Collision).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a54-collision.native.test.ts
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { complete, git, repository, runCleanup, sandbox, threadFixture, turn, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

/** Two conversations on one repository; each wrote the given files (relative to its checkout). */
async function two(options: { secondIn?: 'same' | 'worktree' } = {}) {
  const dir = sandbox()
  const repo = repository(dir)
  write(join(repo, 'src', 'x.ts'), 'x\n'); write(join(repo, 'src', 'y.ts'), 'y\n'); git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'src')
  const tree = join(dir, 'tree')
  if (options.secondIn === 'worktree') git(repo, 'worktree', 'add', '-q', '-b', 'agent-two', tree)
  const f = threadFixture(repo)
  const second = f.create(options.secondIn === 'worktree' ? tree : repo)
  const secondRoot = options.secondIn === 'worktree' ? tree : repo
  await turn(f, 'Fix login')
  write(join(repo, 'src', 'x.ts'), 'x by one\n'); f.wrote([join(repo, 'src', 'x.ts')], { kind: 'update' })
  await complete(f)
  await turn(f, 'Refactor auth', second, 1)
  write(join(secondRoot, 'src', 'x.ts'), 'x by two\n'); f.wrote([join(secondRoot, 'src', 'x.ts')], { kind: 'update', adapter: 1 })
  await complete(f, 1)
  return { dir, repo, tree, f, first: f.id, second }
}

describe('A54 · collision warning', () => {
  test('A54: two conversations editing src/x.ts in the same checkout both see the other, with the path', async () => {
    const { f, first, second } = await two()
    const one = await f.manager.collisions(first)
    const other = await f.manager.collisions(second)
    expect(one).toEqual([{ file: 'src/x.ts', checkoutId: expect.any(String), others: [{ conversationId: second, title: 'Refactor auth' }] }])
    expect(other).toEqual([{ file: 'src/x.ts', checkoutId: one[0].checkoutId, others: [{ conversationId: first, title: 'Fix login' }] }])
  })

  test('A54: a different checkout of the same repository does not collide', async () => {
    const { repo, f, first, second } = await two({ secondIn: 'worktree' })
    expect(await f.manager.collisions(first)).toEqual([])
    expect(await f.manager.collisions(second)).toEqual([])
    // A third conversation in the main checkout collides with the first, and still not with the worktree one.
    const third = f.create(repo)
    await turn(f, 'Third', third, 2)
    write(join(repo, 'src', 'x.ts'), 'x by three\n'); f.wrote([join(repo, 'src', 'x.ts')], { kind: 'update', adapter: 2 })
    await complete(f, 2)
    expect((await f.manager.collisions(first)).flatMap(collision => collision.others.map(other => other.conversationId))).toEqual([third])
    expect(await f.manager.collisions(second)).toEqual([])
  })

  test('A54: undoing the file clears both sides', async () => {
    const { repo, f, first, second } = await two()
    expect(await f.manager.collisions(first)).toHaveLength(1)
    git(repo, 'checkout', '--', 'src/x.ts')
    expect(await f.manager.collisions(first)).toEqual([])
    expect(await f.manager.collisions(second)).toEqual([])
  })

  test('A54: committing the file clears both sides', async () => {
    const { repo, f, first, second } = await two()
    expect(await f.manager.collisions(second)).toHaveLength(1)
    git(repo, 'commit', '-qam', 'both')
    expect(await f.manager.collisions(first)).toEqual([])
    expect(await f.manager.collisions(second)).toEqual([])
  })

  test('A54: a file only one side wrote is no collision, even when dirty', async () => {
    const { repo, f, first } = await two()
    write(join(repo, 'src', 'y.ts'), 'y by one\n')
    await turn(f, 'More')
    f.wrote([join(repo, 'src', 'y.ts')], { kind: 'update' })
    await complete(f)
    expect((await f.manager.collisions(first)).map(collision => collision.file)).toEqual(['src/x.ts'])
  })

  test('A54: an archived conversation no longer collides', async () => {
    const { f, first, second } = await two()
    expect(await f.manager.collisions(first)).toHaveLength(1)
    // Archiving is the /archive command, as the sidebar and the MCP tool run it.
    await f.manager.command(second, '/archive confirm')
    expect(await f.manager.collisions(first)).toEqual([])
  })
})
