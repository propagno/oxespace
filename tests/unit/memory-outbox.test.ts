// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryOutbox, type MemoryOutboxRecord } from '../../electron/main/services/memory/memory-outbox'
import { MemoryDeliveryWorker } from '../../electron/main/services/memory/memory-delivery'
import type { AiMemoryClient } from '../../electron/main/services/memory/ai-memory.client'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function queue() {
  const directory = await mkdtemp(join(tmpdir(), 'oxe-outbox-test-'))
  directories.push(directory)
  return new MemoryOutbox(directory)
}
function record(id: string, sessionId = 'native-1', createdAt = Date.now()): MemoryOutboxRecord {
  const key = MemoryOutbox.ingestKey(['project', 'codex', sessionId, 'user-prompt-submit', id])
  return { key, projectId: 'project', sessionId, createdAt, policy: 'keep', item: {
    url: `/hook?event=user-prompt-submit&agent=codex&ingest_key=${key}`,
    body: { session_id: sessionId, cwd: '/synthetic/project', prompt: 'Synthetic prompt.' }
  } }
}

describe('durable memory outbox', () => {
  test('preserves admission order across restart when timestamps tie or move backwards', async () => {
    const outbox = await queue()
    const time = Date.now()
    const events = Array.from({ length: 12 }, (_, index) => record(`event-${index}`, 'same-session', time - Math.floor(index / 4)))
    for (const event of events) await outbox.admit(event)
    const reopened = new MemoryOutbox(outbox.directory)
    const last = record('last', 'same-session', time - 100)
    await reopened.admit(last)
    expect((await new MemoryOutbox(outbox.directory).pending()).map(row => row.key)).toEqual([...events, last].map(row => row.key))
  })

  test('accounts a failed atomic rename immediately without requiring restart', async () => {
    const base = await queue()
    const outbox = new MemoryOutbox(base.directory, { maxBytes: 64 * 1024 * 1024, maxEvents: 1 })
    await outbox.init()
    const initial = outbox.stats().bytes
    const event = record('failed-rename')
    await mkdir(join(outbox.directory, `${event.key}.json`))
    await expect(outbox.admit(event)).rejects.toThrow()
    expect(outbox.stats()).toMatchObject({ pending: 0, quarantined: 1 })
    expect(outbox.stats().bytes).toBeGreaterThan(initial)
    expect(await outbox.admit(record('cannot-evict-orphan'))).toBe(false)
    const reopened = new MemoryOutbox(outbox.directory)
    await reopened.init()
    expect(reopened.stats()).toEqual(outbox.stats())
  })
  test('recovers admitted events, preserves ordering and distinct equal-content identities', async () => {
    const first = await queue()
    const a = record('event-a', 'native-1', Date.now() - 1000)
    const b = record('event-b', 'native-1', a.createdAt + 1)
    expect(a.key).not.toBe(b.key)
    expect(await first.admit(a)).toBe(true)
    expect(await first.admit(b)).toBe(true)
    expect(await first.admit(a)).toBe(true)
    const reopened = new MemoryOutbox(first.directory)
    expect((await reopened.pending()).map(value => value.key)).toEqual([a.key, b.key])
    await reopened.settle(a.key, 'ack')
    expect((await new MemoryOutbox(first.directory).pending()).map(value => value.key)).toEqual([b.key])
  })

  test('counts auxiliary files in the physical budget and quarantines expired events', async () => {
    const outbox = await queue()
    await outbox.init()
    const auxiliary = await open(join(outbox.directory, 'orphan.tmp'), 'w')
    try { for (let i = 0; i < 64; i++) await auxiliary.write(Buffer.alloc(1024 * 1024, 1)) }
    finally { await auxiliary.close() }
    const reopened = new MemoryOutbox(outbox.directory)
    expect(await reopened.admit(record('overflow'))).toBe(false)
    expect(reopened.stats().bytes).toBeGreaterThanOrEqual(64 * 1024 * 1024)
    const another = await queue()
    expect(await another.admit(record('old', 'native-old', Date.now() - 8 * 86400_000))).toBe(true)
    expect(await another.pending()).toEqual([])
    expect(another.stats().quarantined).toBe(1)
    expect((await readdir(join(another.directory, 'quarantine'))).length).toBe(1)
  })

  test('suspends admission at the event cap without evicting pending records', async () => {
    const base = await queue()
    const outbox = new MemoryOutbox(base.directory, { maxBytes: 64 * 1024 * 1024, maxEvents: 2 })
    expect(await outbox.admit(record('a'))).toBe(true)
    expect(await outbox.admit(record('b'))).toBe(true)
    expect(await outbox.admit(record('c'))).toBe(false)
    expect(outbox.stats()).toMatchObject({ pending: 2, refused: 1 })
    expect((await outbox.pending()).map(value => value.key)).toEqual([record('a').key, record('b').key])
    const reopened = new MemoryOutbox(base.directory, { maxBytes: 64 * 1024 * 1024, maxEvents: 2 })
    await reopened.init()
    expect(reopened.stats()).toMatchObject({ pending: 2, refused: 1 })
  })

  test('quarantines malformed records rather than transmitting them', async () => {
    const outbox = await queue()
    await writeFile(join(outbox.directory, `${'a'.repeat(64)}.json`), '{"prompt":"secret"}')
    expect(await outbox.pending()).toEqual([])
    expect(outbox.stats().quarantined).toBe(1)
  })
})

describe('batch delivery', () => {
  test('does not lose a wakeup admitted while an empty scan is completing', async () => {
    const outbox = await queue()
    let release!: () => void
    const scanned = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(outbox, 'pending').mockImplementationOnce(async () => { await scanned; return [] })
    const hookBatch = vi.fn(async () => ({ status: 200, body: { accepted: 1 } }))
    const worker = new MemoryDeliveryWorker(outbox, () => ({ hookBatch }) as unknown as AiMemoryClient)
    try {
      const flush = worker.flush()
      await outbox.admit(record('arrived-during-scan'))
      worker.wake()
      release()
      await flush
      await vi.waitFor(() => expect(hookBatch).toHaveBeenCalledTimes(1))
      expect(await outbox.pending()).toEqual([])
    } finally { release(); await worker.stop() }
  })

  test('reconciles 429 non-prefix acknowledgements and retries unchanged keys', async () => {
    const outbox = await queue()
    const a = record('a'), b = record('b')
    await outbox.admit(a); await outbox.admit(b)
    const sent: string[][] = []
    const client = { hookBatch: async (items: { url: string }[]) => {
      sent.push(items.map(item => new URL(item.url, 'http://localhost').searchParams.get('ingest_key')!))
      return sent.length === 1
        ? { status: 429, body: { accepted: 0, accepted_indices: [1], results: [{ index: 1, outcome: 'stored' }] } }
        : { status: 200, body: { accepted: 1, results: [{ index: 0, outcome: 'replayed' }] } }
    } } as unknown as AiMemoryClient
    let now = Date.now()
    const worker = new MemoryDeliveryWorker(outbox, () => client, undefined, () => now)
    expect(await worker.flush()).toBe(true)
    expect((await outbox.pending()).map(value => value.key)).toEqual([a.key])
    expect(await worker.flush()).toBe(false)
    now += 2000
    expect(await worker.flush()).toBe(true)
    expect(await outbox.pending()).toEqual([])
    expect(sent).toEqual([[a.key, b.key], [a.key]])
    expect(worker.stats()).toMatchObject({ stored: 1, replayed: 1 })
    await worker.stop()
  })

  test('does not discard a timeout; quarantines terminal collisions', async () => {
    const outbox = await queue()
    const a = record('a')
    await outbox.admit(a)
    let calls = 0
    const client = { hookBatch: async () => {
      if (++calls === 1) throw Error('response lost after remote commit')
      return { status: 200, body: { accepted: 1, results: [{ index: 0, outcome: 'dropped_collision' }] } }
    } } as unknown as AiMemoryClient
    let now = Date.now()
    const worker = new MemoryDeliveryWorker(outbox, () => client, undefined, () => now)
    expect(await worker.flush()).toBe(false)
    expect((await outbox.pending()).map(value => value.key)).toEqual([a.key])
    expect(await worker.flush()).toBe(false)
    now += 2000
    expect(await worker.flush()).toBe(true)
    expect(await outbox.pending()).toEqual([])
    expect(outbox.stats().quarantined).toBe(1)
    await worker.stop()
  })

  test('quarantines a permanently invalid failed index while preserving siblings', async () => {
    const outbox = await queue()
    const a = record('a'), b = record('b')
    await outbox.admit(a); await outbox.admit(b)
    const client = { hookBatch: async () => ({ status: 422, body: { accepted: 0, failed_index: 0, results: [] } }) } as unknown as AiMemoryClient
    const worker = new MemoryDeliveryWorker(outbox, () => client)
    expect(await worker.flush()).toBe(true)
    expect((await outbox.pending()).map(value => value.key)).toEqual([b.key])
    expect(outbox.stats().quarantined).toBe(1)
    await worker.stop()
  })

  test('keeps pending events when project capture is disabled', async () => {
    const outbox = await queue()
    const a = record('a')
    await outbox.admit(a)
    let requests = 0
    const client = { hookBatch: async () => { requests++; return { status: 200, body: { accepted: 1 } } } } as unknown as AiMemoryClient
    const worker = new MemoryDeliveryWorker(outbox, () => client, () => false)
    expect(await worker.flush()).toBe(false)
    expect(requests).toBe(0)
    expect((await outbox.pending()).map(value => value.key)).toEqual([a.key])
    await worker.stop()
  })

  test('isolates retry backoff and lets other sessions advance with concurrency bounded to two', async () => {
    const outbox = await queue()
    for (const session of ['failing-a', 'failing-b', 'healthy-c', 'healthy-d']) await outbox.admit(record('turn', session))
    const sent: string[] = []
    let concurrent = 0, maximum = 0, now = Date.now()
    const client = { hookBatch: async (items: { body: { session_id: string } }[]) => {
      const session = items[0].body.session_id
      sent.push(session)
      maximum = Math.max(maximum, ++concurrent)
      await new Promise(resolve => setTimeout(resolve, 5))
      concurrent--
      if (session.startsWith('failing')) throw Error('offline session')
      return { status: 200, body: { accepted: items.length } }
    } } as unknown as AiMemoryClient
    const worker = new MemoryDeliveryWorker(outbox, () => client, undefined, () => now)
    try {
      expect(await worker.flush()).toBe(false)
      expect(await worker.flush()).toBe(true)
      expect(sent).toEqual(['failing-a', 'failing-b', 'healthy-c', 'healthy-d'])
      await outbox.admit(record('second', 'healthy-c'))
      expect(await worker.flush()).toBe(true)
      expect(await worker.flush()).toBe(false)
      expect(sent.filter(session => session.startsWith('failing'))).toHaveLength(2)
      now += 2000
      expect(await worker.flush()).toBe(false)
      expect(sent.filter(session => session.startsWith('failing'))).toHaveLength(4)
      now += 1999
      expect(await worker.flush()).toBe(false)
      expect(sent.filter(session => session.startsWith('failing'))).toHaveLength(4)
      expect(maximum).toBe(2)
    } finally { await worker.stop() }
  })
})
