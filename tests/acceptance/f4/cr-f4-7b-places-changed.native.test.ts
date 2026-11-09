// Frozen acceptance test for CR-F4-7b (TECH LEAD 09/11, OXE program phase F4): main tells the window when a
// conversation's places change, through the real ThreadManager. Spec: ccr-f4-places-pr.md §Contract (placesChanged)
// and ccr-t71-task-places.md §4.1: "pushed to the renderer when a place is added, or a drift is seen or answered".
// The emitter is ThreadManager.subscribePlaces(id | '*', listener), shaped like subscribe(): '*' hears every
// conversation, and the listener gets the thread id and nothing else (no path, place or file). The window side
// (registerThreadPlacesIpc sending thread:places-changed with { threadId }) is in cr-f4-7-place-ipc.test.ts.
// Written by the planner; the executor must not edit it.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/cr-f4-7b-places-changed.native.test.ts
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { complete, git, repository, runCleanup, sandbox, settle, threadFixture, turn, until, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 })
afterEach(runCleanup)

type Fixture = ReturnType<typeof threadFixture>
type PlacesEmitter = { subscribePlaces(id: string, listener: (...args: unknown[]) => void): () => void }

/** Every call a listener gets, with all its arguments, so an extra argument (a path, a place) shows. */
function listen(f: Fixture, id: string): unknown[][] {
  const calls: unknown[][] = []
  const off = (f.manager as unknown as PlacesEmitter).subscribePlaces(id, (...args: unknown[]) => { calls.push(args) })
  expect(typeof off).toBe('function')
  return calls
}

describe('CR-F4-7b · places-changed from main', () => {
  test('CR-F4-7b: a turn that writes a file in a new place fires the event once, with the thread id only; a turn that writes nothing fires none', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const outside = join(dir, 'notes')
    mkdirSync(outside)
    const f = threadFixture(repo)
    await f.manager.places(f.id) // the root place is created lazily on this first read; what it fires is not counted
    await settle(100)
    const all = listen(f, '*'), mine = listen(f, f.id)

    await turn(f)
    write(join(outside, 'ROTEIRO.md'), '# r\n')
    f.wrote([join(outside, 'ROTEIRO.md')])
    await until(() => all.length > 0, 'places-changed after the write')
    await complete(f)
    expect(all).toEqual([[f.id]])
    expect(mine).toEqual([[f.id]])

    await turn(f, 'Explain only')
    f.said(`See ${join(outside, 'ROTEIRO.md')}`)
    await complete(f)
    await f.manager.places(f.id)
    await settle()
    expect(all).toEqual([[f.id]])
  })

  test('CR-F4-7b: a drift fires once when seen, not again on the next read, and once when answered', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    git(repo, 'switch', '-q', '-c', 'other'); write(join(repo, 'b.txt'), 'b on other\n'); git(repo, 'commit', '-qam', 'other b'); git(repo, 'switch', '-q', 'main')
    const f = threadFixture(repo)
    await turn(f)
    write(join(repo, 'a.txt'), 'task\n'); f.wrote([join(repo, 'a.txt')], { kind: 'update' })
    await complete(f)
    git(repo, 'commit', '-qam', 'task commit')
    await f.manager.places(f.id)
    await settle()
    const calls = listen(f, f.id)

    git(repo, 'switch', '-q', 'other')
    const place = (await f.manager.places(f.id)).places.find(entry => entry.drift && !entry.drift.answer)
    expect(place, 'the drift is seen on this read').toBeDefined()
    await until(() => calls.length > 0, 'places-changed after the drift is seen')
    await f.manager.places(f.id)
    await settle()
    expect(calls).toEqual([[f.id]])

    expect(await f.manager.answerPlaceDrift(f.id, place!.id, 'dismissed')).toMatchObject({ ok: true })
    await until(() => calls.length > 1, 'places-changed after the answer')
    await settle()
    expect(calls).toEqual([[f.id], [f.id]])
  })

  test('CR-F4-7b: another conversation\'s change reaches \'*\' with its own id, not this conversation\'s listener; unsubscribing stops the calls', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const outside = join(dir, 'other-notes')
    mkdirSync(outside)
    const f = threadFixture(repo)
    const second = f.create()
    await f.manager.places(f.id)
    await f.manager.places(second)
    await settle(100)
    const all = listen(f, '*'), mine = listen(f, f.id)
    const stopped: unknown[][] = []
    const off = (f.manager as unknown as PlacesEmitter).subscribePlaces(second, (...args: unknown[]) => { stopped.push(args) })
    off()

    await turn(f, 'Second task', second, 0)
    write(join(outside, 'x.md'), 'x\n')
    f.wrote([join(outside, 'x.md')])
    await until(() => all.length > 0, 'places-changed for the second conversation')
    await complete(f)
    expect(all).toEqual([[second]])
    expect(mine).toEqual([])
    expect(stopped).toEqual([])
  })
})
