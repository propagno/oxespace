// Frozen acceptance test for 1.5.0 A18 (OXE program, phase F4), the Terminal tab half: a pane belongs to a task when its
// newest known cwd (shell OSC, else the agent hook's location, else its launch folder) is inside one of the task's
// places. Computed in main, never stored. Grouped "Agent's" and "Yours".
// Written by the planner; the executor must not edit it.
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A18 (ccr-t71-task-places.md §6, thread:panes) and DESIGN's U4.4/U4.8.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a18-thread-panes.native.test.ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { complete, git, repository, runCleanup, same, sandbox, threadFixture, turn } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

async function task() {
  const dir = sandbox()
  const repo = repository(dir)
  const tree = join(dir, 'tree'); git(repo, 'worktree', 'add', '-q', '-b', 'agent-fix', tree)
  const far = join(dir, 'far'); mkdirSync(far)
  const f = threadFixture(repo)
  await turn(f)
  f.emit({ type: 'location', cwd: tree })
  await complete(f)
  const places = (await f.manager.places(f.id)).places
  const treePlace = places.find(place => same(place.path, tree))
  if (!treePlace) throw new Error('no worktree place')
  return { dir, repo, tree, far, f, treePlace }
}

describe('A18 · the task\'s Terminal tab', () => {
  test('A18: panes launched in a place, or whose agent reported a cwd there, or whose shell said so, are listed with how', async () => {
    const { tree, far, f, treePlace } = await task()
    f.panes.push(
      { paneId: 'p-launch', title: 'build', workspaceId: 'A', launchDir: tree, agent: false },
      { paneId: 'p-agent', title: 'claude', workspaceId: 'A', launchDir: far, agentCwd: join(tree), agent: true },
      { paneId: 'p-osc', title: 'shell', workspaceId: 'A', launchDir: far, shellCwd: tree, agent: false },
      { paneId: 'p-far', title: 'far', workspaceId: 'A', launchDir: far, agent: false }
    )
    const panes = await f.manager.panes(f.id)
    expect(panes.map(pane => pane.paneId).sort()).toEqual(['p-agent', 'p-launch', 'p-osc'])
    expect(panes.find(pane => pane.paneId === 'p-launch')).toEqual({ paneId: 'p-launch', title: 'build', workspaceId: 'A', placeId: treePlace.id, via: 'launch', group: 'yours' })
    expect(panes.find(pane => pane.paneId === 'p-agent')).toMatchObject({ via: 'agent-location', group: 'agent', placeId: treePlace.id })
    expect(panes.find(pane => pane.paneId === 'p-osc')).toMatchObject({ via: 'shell-osc', group: 'yours' })
  })

  test('A18: a pane whose shell cd\'d out of the places leaves the tab; its launch folder no longer counts', async () => {
    const { tree, far, f } = await task()
    const pane: { paneId: string; title: string; workspaceId: string; launchDir: string; shellCwd?: string; agent: boolean } = { paneId: 'p1', title: 'shell', workspaceId: 'A', launchDir: tree, agent: false }
    f.panes.push(pane)
    expect((await f.manager.panes(f.id)).map(entry => entry.paneId)).toEqual(['p1'])
    pane.shellCwd = far
    expect(await f.manager.panes(f.id)).toEqual([])
  })

  test('A18: a subfolder of a place counts; a sibling folder with a shared prefix does not', async () => {
    const { tree, f } = await task()
    mkdirSync(join(tree, 'src'))
    const prefix = `${tree}-copy`; mkdirSync(prefix)
    f.panes.push(
      { paneId: 'p-sub', title: 'sub', workspaceId: 'A', launchDir: join(tree, 'src'), agent: false },
      { paneId: 'p-prefix', title: 'prefix', workspaceId: 'A', launchDir: prefix, agent: false }
    )
    expect((await f.manager.panes(f.id)).map(pane => pane.paneId)).toEqual(['p-sub'])
  })
})
