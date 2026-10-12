import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ThreadAttachmentStore } from '../electron/main/services/conversation/thread-attachments'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('oxe-thread-attachments-')) throw Error('Unsafe fixture path')
  await rm(root, { recursive: true, force: true })
} })

describe('ThreadAttachmentStore', () => {
  it('stores validated images behind thread-scoped opaque ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-thread-attachments-')); roots.push(root)
    const store = new ThreadAttachmentStore(root)
    const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])
    const added = await store.add('thread-a', { name: '../screen.png', mimeType: 'image/png', data: png })
    expect(added).toMatchObject({ name: 'screen.png', mimeType: 'image/png', bytes: png.length })
    expect((await store.resolve('thread-a', [added.id]))[0].path).toContain('thread-a')
    await expect(store.resolve('thread-b', [added.id])).rejects.toThrow()
    await store.remove('thread-a', added.id)
    await expect(store.resolve('thread-a', [added.id])).rejects.toThrow()
  })

  it('rejects spoofed and oversized payloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-thread-attachments-')); roots.push(root)
    const store = new ThreadAttachmentStore(root)
    await expect(store.add('thread', { name: 'fake.png', mimeType: 'image/png', data: new Uint8Array([1,2,3]) })).rejects.toThrow('Invalid')
    await expect(store.add('thread', { name: 'large.png', mimeType: 'image/png', data: new Uint8Array(10 * 1024 * 1024 + 1) })).rejects.toThrow('Invalid')
  })

  it('removes every private blob owned by a deleted thread without touching another thread', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-thread-attachments-')); roots.push(root)
    const store = new ThreadAttachmentStore(root)
    const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0])
    const removed = await store.add('thread-a', { name: 'removed.png', mimeType: 'image/png', data: png })
    const retained = await store.add('thread-b', { name: 'retained.png', mimeType: 'image/png', data: png })
    await store.removeThread('thread-a')
    await expect(store.resolve('thread-a', [removed.id])).rejects.toThrow()
    await expect(store.resolve('thread-b', [retained.id])).resolves.toHaveLength(1)
  })
})
