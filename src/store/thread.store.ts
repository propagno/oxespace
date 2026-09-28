import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConversationThread, ThreadAttachment, ThreadProjectSummary, ThreadSnapshot } from '../../shared/types/thread'
import { cacheThreadSnapshot, retainThreadSnapshots } from './threadSnapshotCache'

interface ThreadState {
  threads: ConversationThread[]; projects: ThreadProjectSummary[]
  selectedId: string | null; snapshot: ThreadSnapshot | null
  secondaryId: string | null; activeCell: 'primary' | 'secondary'
  snapshotCache: Record<string, ThreadSnapshot>; snapshotCacheOrder: string[]
  drafts: Record<string, string>; scrollPositions: Record<string, { top: number; following: boolean }>
  attachments: Record<string, ThreadAttachment[]>
  expanded: Record<string, boolean>; errors: Record<string, string>; loading: boolean
  hiddenProjects: string[]
  unreadIds: string[]
  markUnread: (id: string) => void
  markRead: (id: string) => void
  hideProject: (id: string) => Promise<void>
  restoreProject: (id: string) => void
  select: (id: string | null, markRead?: boolean) => Promise<void>
  openSecondary: (id: string) => Promise<void>
  closeSecondary: () => void
  setActiveCell: (cell: 'primary' | 'secondary') => void
  loadEarlier: (id: string) => Promise<number>
  load: (workspaceIds: string[], preferred?: string | null) => Promise<void>
  refresh: (id: string) => Promise<void>
  loadProjects: () => Promise<void>
  setDraft: (id: string, text: string) => void
  addAttachment: (id: string, attachment: ThreadAttachment) => void
  removeAttachment: (id: string, attachmentId: string) => void
  clearAttachments: (id: string) => void
  setScroll: (id: string, top: number, following: boolean) => void
  toggle: (id: string) => void
  adopt: (snapshot: ThreadSnapshot) => void
  updateSnapshot: (snapshot: ThreadSnapshot) => void
}
const refreshVersions = new Map<string, number>()
let generation = 0, catalogGeneration = 0, projectGeneration = 0
export const useThreadStore = create<ThreadState>()(persist((set, get) => ({
  threads: [], projects: [], selectedId: null, snapshot: null, secondaryId: null, activeCell: 'primary', snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, attachments: {}, scrollPositions: {}, expanded: {}, errors: {}, loading: false, hiddenProjects: [], unreadIds: [],
  markUnread: id => set(state => ({ unreadIds: [...new Set([...state.unreadIds, id])] })),
  markRead: id => set(state => ({ unreadIds: state.unreadIds.filter(value => value !== id) })),
  hideProject: async id => {
    set(state => ({ hiddenProjects: [...new Set([...state.hiddenProjects, id])] }))
    if (get().snapshot?.thread.projectId === id) await get().select(null)
  },
  restoreProject: id => set(state => ({ hiddenProjects: state.hiddenProjects.filter(value => value !== id) })),
  select: async (id, markRead = true) => {
    const version = ++generation
    const cached = id ? get().snapshotCache[id] ?? null : null
    set(state => ({ selectedId: id, snapshot: cached, unreadIds: id && markRead ? state.unreadIds.filter(value => value !== id) : state.unreadIds, errors: Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== 'selection')),
      ...(state.secondaryId === id ? { secondaryId: null, activeCell: 'primary' as const } : {}) }))
    if (!id) return
    try {
      const snapshot = await window.oxe.thread!.read(id)
      if (version === generation) set(state => {
        const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
        return { snapshot, snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order }
      })
    }
    catch { if (version === generation) set({ errors: { ...get().errors, selection: 'Could not open conversation. Select it to retry.' } }) }
  },
  openSecondary: async id => {
    if (id === get().selectedId) { set(state => ({ secondaryId: id, activeCell: 'secondary', unreadIds: state.unreadIds.filter(value => value !== id) })); return }
    const cached = get().snapshotCache[id]
    if (cached) { set(state => ({ secondaryId: id, activeCell: 'secondary', unreadIds: state.unreadIds.filter(value => value !== id) })); return }
    const snapshot = await window.oxe.thread!.read(id)
    if (!get().threads.some(thread => thread.id === id)) throw Error('Conversation is no longer available')
    set(state => {
      const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
      return { secondaryId: id, activeCell: 'secondary', unreadIds: state.unreadIds.filter(value => value !== id), snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order }
    })
  },
  closeSecondary: () => set({ secondaryId: null, activeCell: 'primary' }),
  setActiveCell: activeCell => set({ activeCell }),
  loadEarlier: async id => {
    const state = get()
    const current = state.selectedId === id ? state.snapshot : state.snapshotCache[id]
    if (!current || !current.page?.hasMore || current.page.before === undefined || !window.oxe.thread?.history) return 0
    const before = current.page.before
    const page = await window.oxe.thread.history(id, before, 250)
    const latest = get().selectedId === id ? get().snapshot : get().snapshotCache[id]
    if (latest?.page?.before !== before) return 0
    set(state => {
      const previous = state.selectedId === id ? state.snapshot : state.snapshotCache[id]
      if (!previous) return state
      const snapshot = { ...previous, events: [...page.events, ...previous.events], page: { ...(page.before !== undefined ? { before: page.before } : {}), hasMore: page.hasMore, total: page.total } }
      const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
      return { ...(state.selectedId === id ? { snapshot } : {}), snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order }
    })
    return page.events.length
  },
  loadProjects: async () => {
    const version = ++projectGeneration
    if (!window.oxe?.thread?.projects) return
    try {
      const catalog = await window.oxe.thread.projects()
      if (version === projectGeneration) set(state => ({ projects: catalog.projects, errors: { ...Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== 'projects')),
        ...(catalog.unavailable.length ? { projects: 'Some project directories are unavailable. Check their location and retry.' } : {}) } }))
    } catch { if (version === projectGeneration) set(state => ({ errors: { ...state.errors, projects: 'Could not load project directories.' } })) }
  },
  load: async (ids, preferred) => {
    const version = ++catalogGeneration
    set({ loading: true })
    const results: ConversationThread[][] = [], errors: Record<string, string> = {}
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]
        try { results.push(await window.oxe.thread!.list(id)) }
        catch { errors[id] = 'Could not load conversations.'; results.push(get().threads.filter(t => t.workspaceId === id)) }
      }
    }))
    if (version !== catalogGeneration) return
    const threads = results.flat().sort((a, b) => b.updatedAt - a.updatedAt)
    const valid = new Set(threads.map(t => t.id))
    const cache = retainThreadSnapshots({ snapshots: get().snapshotCache, order: get().snapshotCacheOrder }, valid)
    set({ threads, errors: { ...errors, ...(get().errors.projects ? { projects: get().errors.projects } : {}) }, loading: false,
      unreadIds: get().unreadIds.filter(id => valid.has(id)),
      secondaryId: get().secondaryId && valid.has(get().secondaryId!) ? get().secondaryId : null,
      snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order,
      drafts: Object.fromEntries(Object.entries(get().drafts).filter(([id]) => valid.has(id))),
      attachments: Object.fromEntries(Object.entries(get().attachments).filter(([id]) => valid.has(id))),
      scrollPositions: Object.fromEntries(Object.entries(get().scrollPositions).filter(([id]) => valid.has(id))) })
    const visible = threads.filter(t => !t.archived && !get().hiddenProjects.includes(t.projectId))
    const selected = visible.find(t => t.id === get().selectedId) ?? visible.find(t => t.workspaceId === preferred) ?? visible[0]
    if (selected?.id !== get().selectedId || !get().snapshot) await get().select(selected?.id ?? null, selected?.id !== get().selectedId)
    else await get().refresh(selected.id)
  },
  refresh: async id => {
    const refreshVersion = (refreshVersions.get(id) ?? 0) + 1
    refreshVersions.set(id, refreshVersion)
    const version = generation
    try {
      const snapshot = await window.oxe.thread!.read(id)
      set(state => {
        if (refreshVersion !== refreshVersions.get(id) || !state.threads.some(t => t.id === id)) return state
        const previous = state.threads.find(t => t.id === id)!
        // Keep sidebar order stable during a streamed turn.
        const metadata = snapshot.thread.status === 'running' || snapshot.thread.status === 'approval' ? { ...snapshot.thread, updatedAt: previous.updatedAt } : snapshot.thread
        if (version !== generation || state.selectedId !== id || !state.snapshot || state.snapshot.thread.id !== id) {
          const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
          return { threads: state.threads.map(t => t.id === id ? metadata : t), snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order }
        }
        const previousSnapshot = state.snapshot
        const oldTotal = previousSnapshot.page?.total ?? previousSnapshot.events.length
        const newTotal = snapshot.page?.total ?? snapshot.events.length
        const newStart = Math.max(0, newTotal - snapshot.events.length)
        const oldStart = Math.max(0, oldTotal - previousSnapshot.events.length)
        const prefixCount = newTotal >= oldTotal ? Math.max(0, Math.min(previousSnapshot.events.length, newStart - oldStart)) : 0
        const merged: ThreadSnapshot = prefixCount > 0 ? { ...snapshot, events: [...previousSnapshot.events.slice(0, prefixCount), ...snapshot.events], page: { ...(oldStart > 0 ? { before: oldStart } : {}), hasMore: oldStart > 0, total: newTotal } } : snapshot
        const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, merged)
        return { threads: state.threads.map(t => t.id === id ? metadata : t), snapshot: merged, snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order }
      })
    } catch { /* Catalog reload handles deleted workspaces. */ }
  },
  setDraft: (id, text) => set(state => ({ drafts: { ...state.drafts, [id]: text } })),
  addAttachment: (id, attachment) => set(state => ({ attachments: { ...state.attachments, [id]: [...(state.attachments[id] ?? []).filter(value => value.id !== attachment.id), attachment].slice(0, 8) } })),
  removeAttachment: (id, attachmentId) => set(state => ({ attachments: { ...state.attachments, [id]: (state.attachments[id] ?? []).filter(value => value.id !== attachmentId) } })),
  clearAttachments: id => set(state => ({ attachments: { ...state.attachments, [id]: [] } })),
  setScroll: (id, top, following) => set(state => ({ scrollPositions: { ...state.scrollPositions, [id]: { top, following } } })),
  toggle: id => set(state => ({ expanded: { ...state.expanded, [id]: !(state.expanded[id] ?? true) } })),
  adopt: snapshot => { ++generation; ++catalogGeneration; set(state => {
    const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
    return { snapshot, selectedId: snapshot.thread.id, secondaryId: state.secondaryId === snapshot.thread.id ? null : state.secondaryId, activeCell: state.secondaryId === snapshot.thread.id ? 'primary' as const : state.activeCell, unreadIds: state.unreadIds.filter(id => id !== snapshot.thread.id), snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order, hiddenProjects: state.hiddenProjects.filter(id => id !== snapshot.thread.projectId), threads: [snapshot.thread, ...state.threads.filter(t => t.id !== snapshot.thread.id)], loading: false }
  }) },
  updateSnapshot: snapshot => set(state => {
    const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
    return { ...(state.selectedId === snapshot.thread.id ? { snapshot } : {}), snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order, threads: state.threads.map(thread => thread.id === snapshot.thread.id ? snapshot.thread : thread) }
  })
}), { name: 'oxe.thread-navigation', partialize: state => ({ selectedId: state.selectedId, secondaryId: state.secondaryId, expanded: state.expanded, hiddenProjects: state.hiddenProjects, unreadIds: state.unreadIds }), merge: (saved, current) => {
  const value = saved as { selectedId?: unknown; secondaryId?: unknown; expanded?: Record<string, unknown>; hiddenProjects?: unknown; unreadIds?: unknown } | null
  return { ...current, selectedId: typeof value?.selectedId === 'string' ? value.selectedId : null,
    secondaryId: typeof value?.secondaryId === 'string' ? value.secondaryId : null,
    hiddenProjects: Array.isArray(value?.hiddenProjects) ? value.hiddenProjects.filter((id): id is string => typeof id === 'string') : [],
    unreadIds: Array.isArray(value?.unreadIds) ? [...new Set(value.unreadIds.filter((id): id is string => typeof id === 'string'))] : [],
    expanded: Object.fromEntries(Object.entries(value?.expanded ?? {}).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean> }
} }))
