/** What a conversation's places count as its changes, beyond the files of its project. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { complete, repository, runCleanup, sandbox, threadFixture, turn, write } from '../acceptance/f4/fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

test("the agent's own plan file is not counted as a change of the conversation (CHAT-8)", async () => {
  const repo = repository(sandbox('oxe-plan-places-'))
  const home = sandbox('oxe-plan-home-')
  const plans = join(home, 'plans')
  mkdirSync(plans, { recursive: true })
  const before = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = home
  try {
    const f = threadFixture(repo)
    await turn(f, 'Plan, then change the price')
    write(join(plans, 'make-total-respect-quantity.md'), '# Plan\n')
    f.wrote([join(plans, 'make-total-respect-quantity.md')])
    const afterPlan = await f.manager.places(f.id)
    expect(afterPlan.places.flatMap(place => place.files)).toEqual([])
    expect(afterPlan.places.map(place => place.kind)).toEqual(['root'])
    write(join(repo, 'price.ts'), 'one\n')
    f.wrote([join(repo, 'price.ts')])
    await complete(f)
    expect((await f.manager.places(f.id)).places.flatMap(place => place.files)).toEqual(['price.ts'])
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = before
  }
})
