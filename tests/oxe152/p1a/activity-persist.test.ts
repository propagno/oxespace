// Frozen acceptance test for OXE-359 A6, A7, A8 (program 152p1a, phase F1). Written by the planner; the executor must not edit it.
// The window's store against main's real ActivityStore on an in-memory database. A reload is reset() plus hydrate().
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { ActivityStore } from '../../../electron/main/services/activity-store'
import { unreadActivityCount, useActivityStore, type ActivityInput } from '../../../src/store/activity.store'

const original = window.oxe
let db: ReturnType<typeof openInMemoryDatabase>
let main: ActivityStore
let release: (() => void) | null = null

function bridge(holdRecent = false): void {
  window.oxe = {
    ...original,
    activity: {
      recent: async () => {
        const stored = await main.recent()
        if (holdRecent) await new Promise<void>(resolve => { release = resolve })
        return stored
      },
      record: async (entries: unknown) => main.record(entries),
      seen: async (at: unknown) => main.seen(at),
      resolve: async (input: unknown) => main.resolve(input)
    }
  } as unknown as typeof window.oxe
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10))
const store = () => useActivityStore.getState()
const entry = (id: string, over: Partial<ActivityInput> = {}): ActivityInput =>
  ({ source: 'thread', id, kind: 'needs-you', target: { type: 'thread', threadId: id }, title: `Conversation ${id}`, at: Date.now() - 1_000, ...over })
async function reload(): Promise<void> {
  await settle()
  store().reset()
  await store().hydrate()
}

beforeEach(() => {
  db = openInMemoryDatabase()
  main = new ActivityStore(db)
  release = null
  bridge()
  store().reset()
})
afterEach(async () => {
  release?.()
  await settle()
  store().reset()
  window.oxe = original
  db.close()
})

describe('OXE-359 · activity survives a reload as the person left it', () => {
  it('an answered request does not come back after a reload', async () => {
    for (const outcome of ['allowed', 'denied', 'answered'] as const) {
      store().record(entry(outcome))
      store().record(entry(outcome, { outcome, read: true, at: Date.now() }))
    }
    expect(store().items.map(item => item.outcome).sort()).toEqual(['allowed', 'answered', 'denied'])
    await reload()
    expect(store().items.filter(item => item.kind === 'needs-you')).toEqual([])
    expect(unreadActivityCount(store().items)).toBe(0)
  })

  it('a new state of the same subject drops its stored request', async () => {
    store().record(entry('t1'))
    store().record(entry('t1', { kind: 'finished', at: Date.now() }))
    await settle()
    expect((await main.recent()).entries.map(item => item.kind)).toEqual(['finished'])
  })

  it('opening every item one by one stays read after a reload', async () => {
    store().record(entry('a', { kind: 'finished', at: Date.now() - 3_000 }))
    store().record(entry('b', { kind: 'failed', at: Date.now() - 2_000 }))
    store().markRead('thread', 'b')
    store().markRead('thread', 'a')
    await reload()
    expect(store().items).toHaveLength(2)
    expect(unreadActivityCount(store().items)).toBe(0)
  })

  it('reading one of two items does not mark the other read', async () => {
    store().record(entry('old', { kind: 'finished', at: Date.now() - 3_000 }))
    store().record(entry('new', { kind: 'finished', at: Date.now() - 2_000 }))
    store().markRead('thread', 'new')
    await reload()
    expect(store().items.find(item => item.id === 'old')?.read).toBe(false)
  })

  it('a resolve before hydration finishes wins over the stored entry', async () => {
    await main.record([entry('waiting')])
    bridge(true)
    const hydrating = store().hydrate()
    await settle()
    store().resolve('thread', 'waiting')
    release?.()
    await hydrating
    await settle()
    expect(store().items).toEqual([])
    expect((await main.recent()).entries).toEqual([])
  })

  it('mark all read before hydration finishes wins over the stored state', async () => {
    await main.record([entry('done', { kind: 'finished' })])
    bridge(true)
    const hydrating = store().hydrate()
    await settle()
    store().markAllRead()
    release?.()
    await hydrating
    expect(store().items).toHaveLength(1)
    expect(unreadActivityCount(store().items)).toBe(0)
    bridge()
    await reload()
    expect(unreadActivityCount(store().items)).toBe(0)
  })
})
