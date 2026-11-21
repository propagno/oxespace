// Frozen acceptance test for 1.5.2 Atividade persistente (OXE program 152acc2, phase F1, Jira OXE-345, A2). Written by
// the planner; the executor must not edit it. The main side exists since 376c20762 (shared/types/activity.ts, table
// 088_activity_entries, activity.ipc.ts, window.oxe.activity in the preload); the window never called it, so the bell
// came back empty after a restart (acceptance F30, red since 31/10).
// Contract (src/store/activity.store.ts; T1):
// - New action `hydrate(): Promise<void>`. It reads `window.oxe.activity.recent()` once and puts the stored entries in
//   `items`, newest first, at most ACTIVITY_LIMIT, each with `read: lastSeenAt !== null && at <= lastSeenAt`. An entry
//   recorded in this session before `hydrate` settles wins over a stored one of the same source and id. Calling it again
//   reads nothing more, until `reset()`, which also forgets that it hydrated.
// - `record` also sends the entry to `window.oxe.activity.record([entry])`, with only main's fields: source, id, kind,
//   target, title, detail (when present) and at — never place, outcome or read. A source main does not store (`query`)
//   is not sent.
// - `resolve(source, id, kind)` also sends `window.oxe.activity.resolve({ source, id, kind })` when an entry was dropped.
// - `markAllRead()` also sends `window.oxe.activity.seen(<the newest entry's at>)` when there are entries.
// - Without `window.oxe.activity` (or one of its methods), and when a call rejects, the store works as before and nothing
//   throws.
// - The app calls `useActivityStore.getState().hydrate()` once at start, after the first paint (A1, the F30 e2e, proves
//   it end to end; nothing on the synchronous boot path, OXE-105).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useActivityStore } from '../../../src/store/activity.store'

type Fn = ReturnType<typeof vi.fn>
type Hydrating = { hydrate: () => Promise<void> }
let api: { recent: Fn; record: Fn; seen: Fn; resolve: Fn }

const stored = (i: number, at: number, kind: 'needs-you' | 'finished' = 'finished') =>
  ({ source: 'thread', id: `t${i}`, kind, target: { type: 'thread', threadId: `t${i}` }, title: `Entry ${i}`, at })
const hydrate = () => (useActivityStore.getState() as unknown as Hydrating).hydrate()
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  useActivityStore.getState().reset()
  api = {
    recent: vi.fn(async () => ({ entries: [], lastSeenAt: null })),
    record: vi.fn(async () => ({ ok: true, recorded: 1, ignored: 0 })),
    seen: vi.fn(async (at: number) => ({ ok: true, lastSeenAt: at })),
    resolve: vi.fn(async () => ({ ok: true, removed: true }))
  }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { activity: api } })
})
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(window, 'oxe', { configurable: true, value: undefined }) })

describe('OXE-345 · the activity center is kept by main', () => {
  test('the window records, reads and resolves through window.oxe.activity, and hydrates on start', async () => {
    const now = 1_000_000
    const entries = [5, 4, 3, 2, 1].map(i => stored(i, now - (6 - i) * 60_000, i <= 2 ? 'needs-you' : 'finished'))
    api.recent.mockResolvedValueOnce({ entries, lastSeenAt: now - 3 * 60_000 })
    await hydrate()
    expect(api.recent).toHaveBeenCalledTimes(1)
    const items = useActivityStore.getState().items
    expect(items.map(item => item.id)).toEqual(['t5', 't4', 't3', 't2', 't1'])
    expect(items.filter(item => !item.read).map(item => item.id)).toEqual(['t5', 't4'])

    useActivityStore.getState().record({ source: 'thread', id: 't9', kind: 'needs-you', target: { type: 'thread', threadId: 't9' }, title: 'Fix the login bug',
      detail: 'Waiting for you', at: now + 1, place: { project: 'shop', mode: 'chat' } })
    expect(api.record).toHaveBeenCalledWith([{ source: 'thread', id: 't9', kind: 'needs-you', target: { type: 'thread', threadId: 't9' }, title: 'Fix the login bug', detail: 'Waiting for you', at: now + 1 }])

    useActivityStore.getState().resolve('thread', 't9', 'needs-you')
    expect(api.resolve).toHaveBeenCalledWith({ source: 'thread', id: 't9', kind: 'needs-you' })

    useActivityStore.getState().markAllRead()
    expect(api.seen).toHaveBeenCalledWith(now - 60_000)
  })

  test('an entry recorded before the stored list arrives wins over the stored one of the same subject', async () => {
    let release: (value: unknown) => void = () => undefined
    api.recent.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
    const pending = hydrate()
    useActivityStore.getState().record({ source: 'thread', id: 't1', kind: 'needs-you', target: { type: 'thread', threadId: 't1' }, title: 'Now', at: 2_000 })
    release({ entries: [stored(1, 1_000), stored(2, 500)], lastSeenAt: null })
    await pending
    const items = useActivityStore.getState().items
    expect(items.map(item => `${item.id}:${item.title}`)).toEqual(['t1:Now', 't2:Entry 2'])
    expect(items.every(item => !item.read)).toBe(true)
    await hydrate()
    expect(api.recent).toHaveBeenCalledTimes(1)
  })

  test('an OxeQuery entry stays in the window: main does not store that source', () => {
    useActivityStore.getState().record({ source: 'query', id: 'r1', kind: 'needs-you', target: { type: 'pane', workspaceId: 'w', paneId: 'p' }, title: 'Claude reads orders' } as never)
    expect(useActivityStore.getState().items).toHaveLength(1)
    expect(api.record).not.toHaveBeenCalled()
  })

  test('without the main API, or when it fails, the bell works as before and nothing throws', async () => {
    api.record.mockRejectedValue(new Error('main is gone'))
    api.seen.mockRejectedValue(new Error('main is gone'))
    useActivityStore.getState().record({ source: 'thread', id: 't1', kind: 'finished', target: { type: 'thread', threadId: 't1' }, title: 'Done' })
    useActivityStore.getState().markAllRead()
    await flush()
    expect(useActivityStore.getState().items[0]?.read).toBe(true)

    useActivityStore.getState().reset()
    Object.defineProperty(window, 'oxe', { configurable: true, value: {} })
    await expect(hydrate()).resolves.toBeUndefined()
    expect(() => useActivityStore.getState().record({ source: 'thread', id: 't2', kind: 'finished', target: { type: 'thread', threadId: 't2' }, title: 'Done' })).not.toThrow()
    expect(useActivityStore.getState().items.map(item => item.id)).toEqual(['t2'])
  })
})
