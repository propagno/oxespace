// Frozen acceptance test for 1.5.0 A17 (OXE program, phase F4): a file outside the repository opens read only, and
// only when its place came from tool evidence. thread:place-read has no write twin and is forbidden to MCP.
// Written by the planner; the executor must not edit it. SECURITY review is mandatory (TECH LEAD).
// Spec: docs/roadmap-1.5/ccr-f4-places-pr.md §A17 (ccr-t71-task-places.md §4.1 "Read-only files outside the repository").
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f4/a17-place-read.native.test.ts
import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { workspaceRootResolver } from '../../../electron/main/ipc/file-system.ipc'
import { FileSystemService } from '../../../electron/main/services/file-system.service'
import { messageFromError } from '../../../shared/messages'
import type { ThreadPlace } from '../../../shared/types/thread-places'
import { complete, repository, runCleanup, same, sandbox, threadFixture, turn, write } from './fixtures/thread-fixture'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
afterEach(runCleanup)

const at = (places: ThreadPlace[], path: string): ThreadPlace => {
  const place = places.find(entry => same(entry.path, path))
  if (!place) throw new Error(`no place at ${path}`)
  return place
}
const code = async (promise: Promise<unknown>): Promise<string | undefined> => {
  const error = await promise.then(() => null, (cause: unknown) => cause)
  return messageFromError(error)?.code
}

async function outsidePlace() {
  const dir = sandbox()
  const repo = repository(dir)
  const outside = join(dir, 'notes')
  mkdirSync(outside)
  write(join(outside, 'ROTEIRO.md'), '# roteiro\n')
  write(join(outside, 'deep', 'more.md'), 'more\n')
  const f = threadFixture(repo)
  await turn(f)
  f.wrote([join(outside, 'ROTEIRO.md')])
  await complete(f)
  return { dir, repo, outside, f, place: at((await f.manager.places(f.id)).places, outside) }
}

describe('A17 · read-only files outside the repository', () => {
  test('A17: a file in an outside place created from a Write event opens read only, in fs:read-file\'s shape', async () => {
    const { f, place } = await outsidePlace()
    const result = await f.manager.readPlaceFile(f.id, place.id, 'ROTEIRO.md')
    expect(result).toMatchObject({ relativePath: 'ROTEIRO.md', content: '# roteiro\n', size: 10, readOnly: true })
    expect(typeof result.mtimeMs).toBe('number')
    // Any file under the place, not only the written one.
    expect(await f.manager.readPlaceFile(f.id, place.id, 'deep/more.md')).toMatchObject({ content: 'more\n', readOnly: true })
  })

  test('A17: fs:read-file still refuses the same path: nothing widens the workspace roots', async () => {
    const { f, outside } = await outsidePlace()
    const fs = new FileSystemService(workspaceRootResolver(f.db))
    await expect(fs.readFile({ workspaceId: 'A', rootPath: outside, relativePath: 'ROTEIRO.md' })).rejects.toThrow()
  })

  test('A17: a folder named only in the agent\'s text is not a place, so it cannot be read', async () => {
    const dir = sandbox()
    const repo = repository(dir)
    const said = join(dir, 'said'); mkdirSync(said); write(join(said, 'x.md'), 'x\n')
    const f = threadFixture(repo)
    await turn(f)
    f.said(`See ${join(said, 'x.md')}`)
    await complete(f)
    const resolution = await f.manager.resolvePath(f.id, join(said, 'x.md'))
    // The resolver may point at it for display, but there is no place behind it.
    if (resolution.kind === 'found') expect(resolution.placeId).toBeNull()
    expect((await f.manager.places(f.id)).places.some(place => same(place.path, said))).toBe(false)
  })

  test('A17: a place that is not from evidence is refused with thread.place.notEvidence; an unknown one with thread.place.gone', async () => {
    const { f, repo } = await outsidePlace()
    // The root place is the thread's own project, read through fs:read-file; place-read serves outside and checkout places only.
    const root = at((await f.manager.places(f.id)).places, repo)
    expect(await code(f.manager.readPlaceFile(f.id, root.id, 'a.txt'))).toBe('thread.place.notEvidence')
    expect(await code(f.manager.readPlaceFile(f.id, 'no-such', 'a.txt'))).toBe('thread.place.gone')
  })

  test('A17: a .. escape, an absolute path, a NUL and a link out of the folder are refused with thread.place.outside', async () => {
    const { dir, outside, f, place } = await outsidePlace()
    write(join(dir, 'secret.txt'), 'secret\n')
    const target = join(dir, 'target'); mkdirSync(target); write(join(target, 'loot.txt'), 'loot\n')
    symlinkSync(target, join(outside, 'link'), 'junction')
    for (const relative of ['../secret.txt', 'deep/../../secret.txt', join(dir, 'secret.txt'), 'link/loot.txt', 'ROTEIRO.md\u0000.txt']) {
      expect(await code(f.manager.readPlaceFile(f.id, place.id, relative))).toBe('thread.place.outside')
    }
    await expect(f.manager.readPlaceFile(f.id, place.id, 'a'.repeat(4097))).rejects.toThrow()
  })

  test('A17: a directory, or a file above the 2 MiB text limit, is refused; binary text is refused like fs:read-file', async () => {
    const { outside, f, place } = await outsidePlace()
    await expect(f.manager.readPlaceFile(f.id, place.id, 'deep')).rejects.toThrow()
    writeFileSync(join(outside, 'big.log'), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61))
    await expect(f.manager.readPlaceFile(f.id, place.id, 'big.log')).rejects.toThrow()
    writeFileSync(join(outside, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 0]))
    await expect(f.manager.readPlaceFile(f.id, place.id, 'blob.bin')).rejects.toThrow()
  })

  test('A17: a FIFO is refused (POSIX only)', async () => {
    if (process.platform === 'win32') return
    const { outside, f, place } = await outsidePlace()
    execFileSync('mkfifo', [join(outside, 'pipe')])
    await expect(f.manager.readPlaceFile(f.id, place.id, 'pipe')).rejects.toThrow()
  })
})
