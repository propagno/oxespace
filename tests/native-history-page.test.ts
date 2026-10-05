import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { readNativeHistoryPage, type NativeHistoryCursor } from '../electron/main/services/conversation/native-history-page'

async function removeFixture(root: string): Promise<void> {
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw Error('Unsafe test cleanup')
  await rm(root, { recursive: true, force: true })
}

describe('native history byte pages', () => {
  it('bounds retained page text without dropping the message at the byte budget boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-pages-'))
    try {
      const path = join(root, 'session.jsonl')
      await writeFile(path, Array.from({ length: 24 }, (_, id) => JSON.stringify({ id, text: 'x'.repeat(200_000) })).join('\n'))
      let cursor: NativeHistoryCursor | undefined
      let ids: number[] = []
      do {
        const page = await readNativeHistoryPage(path, value => ({ id: Number(value.id), text: String(value.text) }), cursor)
        expect(Buffer.byteLength(JSON.stringify(page.items))).toBeLessThanOrEqual(2 * 1024 * 1024)
        ids = [...page.items.map(item => item.id), ...ids]
        cursor = page.cursor
      } while (cursor)
      expect(ids).toEqual(Array.from({ length: 24 }, (_, id) => id))
    } finally {
      await removeFixture(root)
    }
  })
  it('keeps a snapshot across append, rejects replacement and honors cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-pages-'))
    try {
      const path = join(root, 'session.jsonl')
      const data = Array.from({ length: 10 }, (_, id) => JSON.stringify({ id })).join('\n') + '\n'
      await writeFile(path, data)
      const first = await readNativeHistoryPage(path, value => value.id, undefined, 3)
      expect(first.items).toEqual([7, 8, 9])
      await appendFile(path, JSON.stringify({ id: 10 }) + '\n')
      const second = await readNativeHistoryPage(path, value => value.id, first.cursor, 10)
      expect(second.items).toEqual([0, 1, 2, 3, 4, 5, 6])
      const controller = new AbortController()
      controller.abort()
      await expect(readNativeHistoryPage(path, value => value.id, undefined, 10, controller.signal)).rejects.toThrow()
      await writeFile(path, data.replace('"id":0', '"id":8'))
      await expect(readNativeHistoryPage(path, value => value.id, first.cursor)).rejects.toThrow('changed')
    } finally {
      await removeFixture(root)
    }
  })
  it('crosses giant outputs and UTF-8 block boundaries without losing or duplicating messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oxe-native-pages-'))
    try {
      const path = join(root, 'session.jsonl')
      const messages = Array.from({ length: 300 }, (_, id) => JSON.stringify({ id, text: 'ação 🐂 '.repeat(130) }))
      await writeFile(path, [...messages.slice(0, 150), JSON.stringify({ tool: 'x'.repeat(34 * 1024 * 1024) }), ...messages.slice(150)].join('\n'))
      let cursor: NativeHistoryCursor | undefined
      let collected: number[] = [], calls = 0
      do {
        const page = await readNativeHistoryPage(path, value => typeof value.id === 'number' ? value.id : undefined, cursor, 37)
        expect(page.bytesRead).toBeLessThanOrEqual(8 * 1024 * 1024)
        if (cursor && page.cursor) expect(page.cursor.before).toBeLessThan(cursor.before)
        collected = [...page.items, ...collected]; cursor = page.cursor
        expect(++calls).toBeLessThan(30)
      } while (cursor)
      expect(collected).toEqual(Array.from({ length: 300 }, (_, index) => index))
      const first = await readNativeHistoryPage(path, value => value.id, undefined, 2)
      await writeFile(path, '{}\n')
      await expect(readNativeHistoryPage(path, value => value.id, first.cursor)).rejects.toThrow('changed')
    } finally {
      await removeFixture(root)
    }
  })
})
