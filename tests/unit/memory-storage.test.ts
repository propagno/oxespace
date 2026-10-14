// @vitest-environment node
import { afterEach, expect, test } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { measureMemoryStorage } from '../../electron/main/services/memory/memory-storage'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oxe-memory-storage-'))
  roots.push(root)
  return root
}

test('groups physical bytes by top-level entry and never changes the store', async () => {
  const root = await fixture()
  await mkdir(join(root, 'data', 'db'), { recursive: true })
  await mkdir(join(root, 'outbox'))
  await writeFile(join(root, 'data', 'db', 'memory.sqlite'), Buffer.alloc(3000))
  await writeFile(join(root, 'data', 'wiki.md'), Buffer.alloc(1000))
  await writeFile(join(root, 'outbox', 'a.json'), Buffer.alloc(500))
  await writeFile(join(root, 'settings.json'), Buffer.alloc(10))
  const usage = await measureMemoryStorage(root, () => 42)
  expect(usage).toMatchObject({ categories: { data: 4000, outbox: 500, 'settings.json': 10 }, totalBytes: 4510, truncated: false, measuredAt: 42 })
})

test('does not follow links out of the store and tolerates a missing directory', async () => {
  const root = await fixture()
  const outside = await fixture()
  await writeFile(join(outside, 'big.bin'), Buffer.alloc(100_000))
  await mkdir(join(root, 'data'))
  await writeFile(join(root, 'data', 'x'), Buffer.alloc(7))
  let linked = true
  await symlink(outside, join(root, 'data', 'link'), 'junction').catch(() => { linked = false })
  const usage = await measureMemoryStorage(root)
  expect(usage.totalBytes).toBe(7)
  expect(linked || usage.totalBytes === 7).toBe(true)
  expect((await measureMemoryStorage(join(root, 'absent'))).totalBytes).toBe(0)
})
