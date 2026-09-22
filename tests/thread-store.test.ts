import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreadStore } from '../src/store/thread.store'
import type { ThreadSnapshot } from '../shared/types/thread'
const snapshot = (id: string, workspaceId = 'ws'): ThreadSnapshot => ({ thread: { id, workspaceId, projectId: 'project', rootPath: '/repo', provider: 'codex', title: id, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] })
beforeEach(() => useThreadStore.setState({ threads: [], selectedId: null, snapshot: null, secondaryId: null, activeCell: 'primary', snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, errors: {}, loading: false, hiddenProjects: [] }))
describe('Thread navigation store', () => {
  it('hides projects without losing conversations or drafts and restores them explicitly', async () => {
    const item = snapshot('saved')
    useThreadStore.setState({ threads: [item.thread], selectedId: 'saved', snapshot: item, drafts: { saved: 'Keep me' } })
    await useThreadStore.getState().hideProject('project')
    expect(useThreadStore.getState().selectedId).toBeNull()
    expect(useThreadStore.getState().threads).toHaveLength(1)
    expect(useThreadStore.getState().drafts.saved).toBe('Keep me')
    expect(useThreadStore.getState().hiddenProjects).toEqual(['project'])
    useThreadStore.getState().restoreProjects()
    expect(useThreadStore.getState().hiddenProjects).toEqual([])
  })
  it('ignores a late read after another conversation is selected', async () => {
    let resolve!: (s: ThreadSnapshot) => void
    const late = new Promise<ThreadSnapshot>(r => { resolve = r })
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { read: vi.fn((id: string) => id === 'first' ? late : Promise.resolve(snapshot(id))) } } })
    const first = useThreadStore.getState().select('first')
    await useThreadStore.getState().select('second')
    resolve(snapshot('first')); await first
    expect(useThreadStore.getState().snapshot?.thread.id).toBe('second')
  })
  it('renders a cached conversation immediately and reconciles it in the background', async () => {
    let resolve!: (value: ThreadSnapshot) => void
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { read: vi.fn(() => new Promise<ThreadSnapshot>(done => { resolve = done })) } } })
    const cached = { ...snapshot('warm'), events: [{ type: 'message' as const, id: 'cached', role: 'assistant' as const, text: 'Cached result' }] }
    useThreadStore.setState({ threads: [cached.thread], snapshotCache: { warm: cached }, snapshotCacheOrder: ['warm'] })
    const selecting = useThreadStore.getState().select('warm')
    expect(useThreadStore.getState().snapshot?.events).toEqual(cached.events)
    const fresh = { ...cached, events: [{ type: 'message' as const, id: 'fresh', role: 'assistant' as const, text: 'Fresh result' }] }
    resolve(fresh); await selecting
    expect(useThreadStore.getState().snapshot?.events).toEqual(fresh.events)
  })
  it('keeps the warm snapshot cache bounded to four conversations', () => {
    for (let index = 0; index < 6; index++) useThreadStore.getState().adopt(snapshot(`thread-${index}`))
    expect(useThreadStore.getState().snapshotCacheOrder).toEqual(['thread-5', 'thread-4', 'thread-3', 'thread-2'])
    expect(Object.keys(useThreadStore.getState().snapshotCache)).toHaveLength(4)
  })
  it('keeps other projects available after a partial load failure', async () => {
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: {
      list: vi.fn(async (id: string) => { if (id === 'bad') throw Error(); return [snapshot('available').thread] }),
      read: vi.fn(async (id: string) => snapshot(id))
    } } })
    await useThreadStore.getState().load(['ws', 'bad'])
    expect(useThreadStore.getState().threads.map(t => t.id)).toEqual(['available'])
    expect(useThreadStore.getState().errors.bad).toBeDefined()
    expect(useThreadStore.getState().selectedId).toBe('available')
  })
  it('clears selection and drafts after the owning workspace is removed', async () => {
    useThreadStore.setState({ threads: [snapshot('removed').thread], selectedId: 'removed', snapshot: snapshot('removed'), drafts: { removed: 'draft' } })
    await useThreadStore.getState().load([])
    expect(useThreadStore.getState().selectedId).toBeNull()
    expect(useThreadStore.getState().snapshot).toBeNull()
    expect(useThreadStore.getState().drafts).toEqual({})
  })
  it('prepends an older history page without changing the selected conversation', async () => {
    const current = { ...snapshot('paged'), events: [{ type: 'message' as const, id: 'new', role: 'assistant' as const, text: 'New' }], page: { before: 4, hasMore: true, total: 5 } }
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { history: vi.fn(async () => ({ events: [{ type: 'message' as const, id: 'old', role: 'user' as const, text: 'Old' }], before: 3, hasMore: true, total: 5 })) } } })
    useThreadStore.setState({ selectedId: 'paged', snapshot: current, threads: [current.thread] })
    expect(await useThreadStore.getState().loadEarlier('paged')).toBe(1)
    expect(useThreadStore.getState().snapshot?.events.map(event => 'id' in event ? event.id : '')).toEqual(['old', 'new'])
    expect(useThreadStore.getState().snapshot?.page?.before).toBe(3)
  })
  it('opens a second cached conversation without replacing the primary selection', async () => {
    const primary = snapshot('primary'), secondary = snapshot('secondary')
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { read: vi.fn(async () => secondary) } } })
    useThreadStore.setState({ threads: [primary.thread, secondary.thread], selectedId: 'primary', snapshot: primary })
    await useThreadStore.getState().openSecondary('secondary')
    expect(useThreadStore.getState().selectedId).toBe('primary')
    expect(useThreadStore.getState().snapshot?.thread.id).toBe('primary')
    expect(useThreadStore.getState().secondaryId).toBe('secondary')
    expect(useThreadStore.getState().snapshotCache.secondary?.thread.id).toBe('secondary')
    expect(useThreadStore.getState().activeCell).toBe('secondary')
  })
  it('prevents the same conversation from occupying both cells', async () => {
    const primary = snapshot('primary')
    useThreadStore.setState({ threads: [primary.thread], selectedId: 'primary', snapshot: primary, secondaryId: 'secondary', activeCell: 'secondary' })
    await useThreadStore.getState().openSecondary('primary')
    expect(useThreadStore.getState().secondaryId).toBeNull()
    expect(useThreadStore.getState().activeCell).toBe('primary')
  })
})
