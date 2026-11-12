/**
 * HML-F11-7: after a Restore that puts the files back, the conversation's places stop listing what the undone turns
 * wrote, so the Changes tab does not count a change that is no longer on disk. Redo brings it back.
 */
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { complete, repository, runCleanup, sandbox, threadFixture, turn, write } from '../acceptance/f4/fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

test('a pending Restore with files hides the writes of the turns it undid; Redo shows them again', async () => {
  const repo = repository(sandbox('oxe-restore-places-'))
  const f = threadFixture(repo)
  const files = async (): Promise<string[]> => (await f.manager.places(f.id)).places.flatMap(place => place.files).sort()

  await turn(f, 'First change')
  write(join(repo, 'first.ts'), 'one\n')
  f.wrote([join(repo, 'first.ts')])
  await complete(f)
  await turn(f, 'Second change')
  write(join(repo, 'second.ts'), 'two\n')
  f.wrote([join(repo, 'second.ts')])
  await complete(f)
  expect(await files()).toEqual(['first.ts', 'second.ts'])

  const second = f.read().turns!.at(-1)!.id
  await f.manager.rewind(f.id, second, { restoreFiles: true })
  expect(f.read().thread.rewind?.redoCheckpointIds?.length).toBeGreaterThan(0)
  // The second turn's file went back; the first turn still stands.
  expect(await files()).toEqual(['first.ts'])

  await f.manager.redoRewind(f.id)
  expect(await files()).toEqual(['first.ts', 'second.ts'])
})

test('a file the undone turn wrote last stays listed when a turn that stands wrote it too (CHAT-3)', async () => {
  const repo = repository(sandbox('oxe-restore-places-'))
  const f = threadFixture(repo)
  const files = async (): Promise<string[]> => (await f.manager.places(f.id)).places.flatMap(place => place.files).sort()

  await turn(f, 'First change')
  write(join(repo, 'shared.ts'), 'one\n')
  write(join(repo, 'first.ts'), 'one\n')
  f.wrote([join(repo, 'shared.ts'), join(repo, 'first.ts')])
  await complete(f)
  await turn(f, 'Second change')
  write(join(repo, 'shared.ts'), 'one\ntwo\n')
  f.wrote([join(repo, 'shared.ts')])
  await complete(f)
  expect(await files()).toEqual(['first.ts', 'shared.ts'])

  await f.manager.rewind(f.id, f.read().turns!.at(-1)!.id, { restoreFiles: true })
  // shared.ts is back to what the first turn wrote, which is still a change of this conversation.
  expect(await files()).toEqual(['first.ts', 'shared.ts'])
})

test('a Restore that keeps the files keeps listing them', async () => {
  const repo = repository(sandbox('oxe-restore-places-'))
  const f = threadFixture(repo)
  await turn(f, 'Only change')
  write(join(repo, 'kept.ts'), 'kept\n')
  f.wrote([join(repo, 'kept.ts')])
  await complete(f)

  await f.manager.rewind(f.id, f.read().turns!.at(-1)!.id, { restoreFiles: false })
  expect((await f.manager.places(f.id)).places.flatMap(place => place.files)).toEqual(['kept.ts'])
})
