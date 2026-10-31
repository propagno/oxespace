import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConversationThread, ThreadAttachment, ThreadProjectSummary, ThreadSnapshot } from '../../shared/types/thread'
import { cacheThreadSnapshot, retainThreadSnapshots } from './threadSnapshotCache'
import { threadConfirmation } from '../../shared/threadConfirmations'
import { createDraftWriter, loadStoredDrafts } from '../utils/threadDrafts'
import { optimistic } from './optimistic'
import { i18n } from '../i18n'

// Read once, before the store exists: the writer needs the saved edit times to let old drafts expire.
const storedDrafts = loadStoredDrafts()

interface ThreadState {
  threads: ConversationThread[]; projects: ThreadProjectSummary[]; unavailableProjects: string[]
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
  restoreProject: (id: string) => Promise<void>
  /** Pin, rename and archive show at once and roll back with a toast when the change is not saved. */
  pinThread: (id: string, pinned: boolean) => Promise<void>
  renameThread: (id: string, title: string) => Promise<void>
  archiveThread: (id: string) => Promise<boolean>
  select: (id: string | null, markRead?: boolean) => Promise<void>
  openSecondary: (id: string) => Promise<void>
  closeSecondary: () => void
  setActiveCell: (cell: 'primary' | 'secondary') => void
  loadEarlier: (id: string) => Promise<number>
  load: () => Promise<void>
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
/** One conversation's metadata changed in the list and, when it is open, in its header. */
function patchThread(state: ThreadState, id: string, change: Partial<ConversationThread>): Partial<ThreadState> {
  return { threads: state.threads.map(thread => thread.id === id ? { ...thread, ...change } : thread),
    ...(state.snapshot?.thread.id === id ? { snapshot: { ...state.snapshot, thread: { ...state.snapshot.thread, ...change } } } : {}) }
}
/** Kill switch for incremental reads: localStorage `oxe.thread.delta` = 'off' falls back to full reads. */
function deltaEnabled(): boolean {
  try { return window.localStorage.getItem('oxe.thread.delta') !== 'off' } catch { return true }
}
let generation = 0, catalogGeneration = 0, projectGeneration = 0
export const useThreadStore = create<ThreadState>()(persist((set, get) => ({
  threads: [], projects: [], unavailableProjects: [], selectedId: null, snapshot: null, secondaryId: null, activeCell: 'primary', snapshotCache: {}, snapshotCacheOrder: [], drafts: storedDrafts.drafts, attachments: {}, scrollPositions: {}, expanded: {}, errors: {}, loading: false, hiddenProjects: [], unreadIds: [],
  markUnread: id => set(state => ({ unreadIds: [...new Set([...state.unreadIds, id])] })),
  markRead: id => set(state => ({ unreadIds: state.unreadIds.filter(value => value !== id) })),
  hideProject: async id => {
    const saved = await optimistic(set, get, state => ({ hiddenProjects: [...new Set([...state.hiddenProjects, id])] }), async () => { await window.oxe.thread!.setProjectHidden(id, true); return true },
      { rollbackMessage: i18n.t('thread:store.removeProjectFailed'), revert: state => ({ hiddenProjects: state.hiddenProjects.filter(value => value !== id) }) })
    if (saved && get().snapshot?.thread.projectId === id) await get().select(null)
  },
  restoreProject: async id => {
    await optimistic(set, get, state => ({ hiddenProjects: state.hiddenProjects.filter(value => value !== id) }), () => window.oxe.thread!.setProjectHidden(id, false),
      { rollbackMessage: i18n.t('thread:store.restoreProjectFailed'), revert: state => ({ hiddenProjects: [...new Set([...state.hiddenProjects, id])] }) })
  },
  pinThread: async (id, pinned) => {
    const saved = await optimistic(set, get, state => patchThread(state, id, { pinned }), async () => { await window.oxe.thread!.pin(id, pinned); return true },
      { rollbackMessage: pinned ? i18n.t('thread:store.pinFailed') : i18n.t('thread:store.unpinFailed'), revert: state => patchThread(state, id, { pinned: !pinned }) })
    if (saved) await get().refresh(id)
  },
  renameThread: async (id, title) => {
    const previous = get().threads.find(thread => thread.id === id)?.title
    if (previous === undefined || !window.oxe.thread?.command) return
    const saved = await optimistic(set, get, state => patchThread(state, id, { title }), async () => { await window.oxe.thread!.command!(id, `/rename ${title}`); return true },
      { rollbackMessage: i18n.t('thread:store.renameFailed'), revert: state => patchThread(state, id, { title: previous }) })
    if (saved) await get().refresh(id)
  },
  archiveThread: async id => {
    if (!window.oxe.thread?.command) return false
    const saved = await optimistic(set, get, state => patchThread(state, id, { archived: true }), async () => { await window.oxe.thread!.command!(id, threadConfirmation('archive').command); return true },
      { rollbackMessage: i18n.t('thread:store.archiveFailed'), revert: state => patchThread(state, id, { archived: false }) })
    // The catalog reload moves the selection off the archived conversation.
    if (saved) await get().load()
    return saved === true
  },
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
    catch { if (version === generation) set({ errors: { ...get().errors, selection: i18n.t('thread:store.openFailed') } }) }
  },
  openSecondary: async id => {
    // The selected conversation is already on screen; a second copy beside it shows nothing new.
    if (id === get().selectedId) return
    const cached = get().snapshotCache[id]
    if (cached) { set(state => ({ secondaryId: id, activeCell: 'secondary', unreadIds: state.unreadIds.filter(value => value !== id) })); return }
    const snapshot = await window.oxe.thread!.read(id)
    if (!get().threads.some(thread => thread.id === id)) throw Error(i18n.t('thread:store.gone'))
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
      const snapshot = { ...previous, thread: { ...previous.thread, ...(!page.hasMore ? { cliNotice: undefined, nativeHistoryCursor: undefined } : {}) }, events: [...page.events, ...previous.events], page: { ...(page.before !== undefined ? { before: page.before } : {}), hasMore: page.hasMore, total: page.total } }
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
      if (version === projectGeneration) set(state => ({ projects: catalog.projects, unavailableProjects: catalog.unavailable, hiddenProjects: catalog.projects.filter(project => project.hidden).map(project => project.projectId), errors: { ...Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== 'projects')),
        ...(catalog.unavailable.length ? { projects: i18n.t('thread:store.projectsUnavailable') } : {}) } }))
    } catch { if (version === projectGeneration) set(state => ({ errors: { ...state.errors, projects: i18n.t('thread:store.projectsFailed') } })) }
  },
  load: async () => {
    const version = ++catalogGeneration
    set({ loading: true })
    let threads: ConversationThread[], errors: Record<string, string> = {}
    try { threads = await window.oxe.thread!.list() }
    catch { errors = { catalog: i18n.t('thread:store.catalogFailed') }; threads = get().threads }
    if (version !== catalogGeneration) return
    threads.sort((a, b) => b.updatedAt - a.updatedAt)
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
    const selected = visible.find(t => t.id === get().selectedId) ?? visible[0]
    if (selected?.id !== get().selectedId || !get().snapshot) await get().select(selected?.id ?? null, selected?.id !== get().selectedId)
    else await get().refresh(selected.id)
  },
  refresh: async id => {
    const refreshVersion = (refreshVersions.get(id) ?? 0) + 1
    refreshVersions.set(id, refreshVersion)
    const version = generation
    try {
      let snapshot: ThreadSnapshot | null = null, incremental = false
      const held = get().selectedId === id ? get().snapshot : get().snapshotCache[id]
      if (held?.sync && held.page?.live !== undefined && window.oxe.thread?.readSince && deltaEnabled()) {
        try {
          const delta = await window.oxe.thread.readSince(id, { ...held.sync })
          const current = get().selectedId === id ? get().snapshot : get().snapshotCache[id]
          // Apply only onto the exact window the cursor described.
          if (delta.ok && current?.sync?.epoch === held.sync.epoch && current.sync.revision === held.sync.revision) {
            snapshot = (await import('./threadDelta')).applyThreadDelta(current, delta)
            incremental = snapshot !== null
          }
        } catch { /* Fall back to a full read. */ }
      }
      snapshot ??= await window.oxe.thread!.read(id)
      const resolved = snapshot
      set(state => {
        if (refreshVersion !== refreshVersions.get(id) || !state.threads.some(t => t.id === id)) return state
        const previous = state.threads.find(t => t.id === id)!
        const snapshot = resolved
        // Keep sidebar order stable during a streamed turn.
        const metadata = snapshot.thread.status === 'running' || snapshot.thread.status === 'approval' ? { ...snapshot.thread, updatedAt: previous.updatedAt } : snapshot.thread
        if (version !== generation || state.selectedId !== id || !state.snapshot || state.snapshot.thread.id !== id) {
          const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
          return { threads: state.threads.map(t => t.id === id ? metadata : t), snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order }
        }
        if (incremental) {
          const cache = cacheThreadSnapshot({ snapshots: state.snapshotCache, order: state.snapshotCacheOrder }, snapshot)
          return { threads: state.threads.map(t => t.id === id ? metadata : t), snapshot, snapshotCache: cache.snapshots, snapshotCacheOrder: cache.order }
        }
        const previousSnapshot = state.snapshot
        const oldTotal = previousSnapshot.page?.total ?? previousSnapshot.events.length
        const newTotal = snapshot.page?.total ?? snapshot.events.length
        const newStart = Math.max(0, newTotal - snapshot.events.length)
        const oldStart = Math.max(0, oldTotal - previousSnapshot.events.length)
        const prefixCount = newTotal >= oldTotal ? Math.max(0, Math.min(previousSnapshot.events.length, newStart - oldStart)) : 0
        const merged: ThreadSnapshot = prefixCount > 0 ? { ...snapshot, events: [...previousSnapshot.events.slice(0, prefixCount), ...snapshot.events], page: { ...(previousSnapshot.page?.before !== undefined ? { before: previousSnapshot.page.before } : oldStart > 0 ? { before: oldStart } : {}), hasMore: previousSnapshot.page?.hasMore ?? oldStart > 0, total: newTotal } } : snapshot
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

// Drafts survive a restart. Writes are debounced and flushed when the window closes, so
// the last keystrokes are not lost if the app is closed right after typing.
const draftWriter = createDraftWriter(400, undefined, storedDrafts)
useThreadStore.subscribe((state, previous) => { if (state.drafts !== previous.drafts) draftWriter.schedule(state.drafts) })
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => draftWriter.flush())
  window.addEventListener('beforeunload', () => draftWriter.flush())
}
