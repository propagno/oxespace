// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { MemoryRuntime } from '../../electron/main/services/memory/memory-runtime'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true,
  encryptString: (text: string) => Buffer.from(text), decryptString: (value: Buffer) => value.toString() } }))

const archive = process.env.OXESPACE_AI_MEMORY_V26_ARCHIVE
test.skipIf(!archive)('installs the verified 2.6.2 archive atomically and cleans failed staging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-install-test-'))
  const db = openInMemoryDatabase()
  const runtime = new MemoryRuntime(db, directory)
  const original = globalThis.fetch
  try {
    const bytes = await readFile(archive!)
    const digest = createHash('sha256').update(bytes).digest('hex')
    let body = Buffer.from('invalid archive')
    let checksum = digest
    const calls = vi.fn(async (url: string) => url.endsWith('.sha256')
      ? new Response(checksum)
      : new Response(body))
    globalThis.fetch = calls as typeof fetch
    await expect(runtime.install()).rejects.toThrow('checksum')
    expect(await readdir(directory)).toEqual([])
    checksum = createHash('sha256').update(body).digest('hex')
    await expect(runtime.install()).rejects.toThrow()
    expect(await readdir(directory)).toEqual([])
    body = bytes; checksum = digest
    const executable = await runtime.install()
    expect(executable).toContain('runtime-2.6.2')
    const manifest = JSON.parse(await readFile(join(directory, 'runtime-2.6.2', 'oxespace-verified.json'), 'utf8'))
    expect(manifest.archiveSha256).toBe(digest)
    expect(manifest.executableSha256).toBe(createHash('sha256').update(await readFile(executable)).digest('hex'))
    const before = calls.mock.calls.length
    expect(await runtime.install()).toBe(executable)
    expect(calls).toHaveBeenCalledTimes(before)
  } finally {
    globalThis.fetch = original
    await runtime.stop()
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 90_000)
