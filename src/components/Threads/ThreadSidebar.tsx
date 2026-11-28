import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, LoadingState, Menu, Notice, SegmentedControl, SidebarFilter, SidebarGroup, SidebarHeader, SidebarRow, SidebarSection, Skeleton, Spinner, Splitter, cx, TextField } from '../../ui'
import styles from './ThreadSidebar.module.css'
import { snippetParts, useThreadContentMatches } from '../../hooks/useThreadContentSearch'
import { AlignJustify, Archive, ArchiveRestore, CalendarClock, Check, ChevronDown, Circle, Columns2, FolderPlus, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2, UserRound } from 'lucide-react'
import type { ConversationThread, ThreadPendingRequestSummary, ThreadProjectSummary } from '../../../shared/types/thread'
import type { SessionChanges } from '../../../shared/types/thread-session'
import { useThreadStore } from '../../store/thread.store'
import { readThreadListCache } from '../../store/threadListCache'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { isSameRootPath } from '../../../shared/utils/path'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { SidebarFooterBar, SidebarHeaderActions, type RailAction } from '../Navigation/NavigationChrome'
import { SidebarCollapseButton } from '../Sidebar/SidebarCollapseButton'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { ThreadRail } from './ThreadRail'
import { ThreadSidebarRow } from './ThreadSidebarRow'
import { useNavigationSearch } from '../Navigation/useNavigationSearch'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs, type SidebarStateFilter } from '../../store/navigation-prefs.store'
import { useSettingsStore } from '../../store/settings.store'
import { resolveDensity } from '../../design/density'
import { threadNavigationStatus } from './threadNavigationStatus'
import { GROUP_SIGNAL_WORD, dominantGroupSignal, matchesStateFilter, type StateFilter } from './threadGroupSignal'
import { StatusSignal } from '../../ui/StatusSignal'
import { threadConfirmation } from '../../../shared/threadConfirmations'
import { threadConfirmationText } from './threadConfirmationText'
import { ThreadProjectSettingsDialog } from './ThreadProjectSettingsDialog'
import { ThreadWorktreeFinishDialog } from './ThreadWorktreeFinishDialog'
import { useThreadWorktreeFinishStore } from '../../store/thread-worktree-finish.store'
import { humanizeError } from '../../utils/humanizeError'
import { displayThreadTitle, namedThreadTitle } from './threadTitle'
import { useListKeyboard } from '../../hooks/useListKeyboard'
import { useThreadSections } from './sections/useThreadSections'
import { useSectionDrag } from './sections/useSectionDrag'
import { groupBySection } from './sections/sectionsModel'
import { ThreadSectionGroup, moveToSectionEntry } from './sections/ThreadSectionGroup'
import { ThreadSectionDialogs } from './sections/ThreadSectionDialogs'
import sectionStyles from './sections/ThreadSections.module.css'

/** Threads shown per project before "Show more" (a search or the selected thread always shows). */
const THREAD_ROWS_PER_PROJECT = 8

/** OXE-133: the state selector under the filter (same three choices as OxeCode). */
const NAV_STATE_FILTERS: readonly SidebarStateFilter[] = ['all', 'needs-you', 'working']
const NAV_STATE_KEYS = { all: 'all', 'needs-you': 'needsYou', working: 'working' } as const

/** The chips under the filter, in this order; Unread is a condition, last (OXE-187 RN-2). */
const STATE_CHIPS: ReadonlyArray<{ filter: StateFilter; labelKey: 'status.attention' | 'status.running' | 'status.failed' | 'sidebar.filterUnread' }> = [
  { filter: 'needs-you', labelKey: 'status.attention' }, { filter: 'working', labelKey: 'status.running' }, { filter: 'failed', labelKey: 'status.failed' }, { filter: 'unread', labelKey: 'sidebar.filterUnread' }
]

/**
 * The draft row is the sidebar's one selection and says aria-current="true" (OXC-3, the frozen contract of OXE-168). The
 * shared SidebarRow says "page" on a selected row (OXE-295) and takes no other value, so it is set on the row's element.
 */
const markDraftCurrent = (wrap: HTMLDivElement | null): void => { wrap?.querySelector('[data-ui="sidebar-row"]')?.setAttribute('aria-current', 'true') }

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  const t = i18n.t.bind(i18n)
  return minutes < 1 ? t('thread:sidebar.age.now') : minutes < 60 ? t('thread:sidebar.age.minutes', { count: minutes }) : minutes < 1440 ? t('thread:sidebar.age.hours', { count: Math.floor(minutes / 60) }) : t('thread:sidebar.age.days', { count: Math.floor(minutes / 1440) })
}

/**
 * The OxeChat sidebar (BRD-02, OXE-166, OXC-1) on OxeCode's mould: a src/ui SidebarHeader (Conversations, New
 * conversation, Schedules, collapse), a SidebarFilter, Pinned, the Projects label, one SidebarGroup per project with its
 * sections and then No section, Archived last and collapsed, and a SidebarFooter of IconButtons. Each conversation is a
 * two-line SidebarRow; one that waits shows its needs-you mini card, read from pendingRequestsAll(). A session's parallel
 * chats (OXC-5, OXE-170) are one-line rows right under their parent, in the session's order; a parent row offers
 * "New parallel conversation" as its + and in its ⋯ menu, with no shortcut.
 */
export function ThreadSidebar({ active = true, onCreate, onCreateParallel, onAccounts, onAddProject, onOpenInCode, draft, onLeaveDraft }: {
  /** Kept mounted while hidden after first open so warm switches back to OxeChat skip remounting (OXE-350). */
  active?: boolean
  onCreate: (projectId: string, rootPath?: string) => void
  /** Opens the new conversation screen for a parallel chat of this conversation's session (OXE-170). */
  onCreateParallel?: (parentId: string) => void
  onAccounts?: () => void; onAddProject?: () => void; onOpenInCode?: (rootPath: string) => Promise<void>
  /** A new conversation being written in place (OXC-3): its draft row shows in its project and is the one selection. */
  draft?: { projectId: string } | null
  /** Choosing a conversation while the draft is open leaves the draft, also when it is the one that was selected. */
  onLeaveDraft?: () => void
}) {
  const { t } = useTranslation('thread')
  // Only these fields: the store also changes for drafts, snapshots and scroll positions, which the list never shows.
  const { threads: liveThreads, projects: liveProjects, listLoaded, unavailableProjects, selectedId, secondaryId, expanded, errors, loading, select, openSecondary, toggle, hiddenProjects, unreadIds, markRead, markUnread, syncedProjectId } = useThreadStore(useShallow(state => ({
    threads: state.threads, projects: state.projects, unavailableProjects: state.unavailableProjects, selectedId: state.selectedId, secondaryId: state.secondaryId, expanded: state.expanded, errors: state.errors, loading: state.loading, listLoaded: state.listLoaded,
    select: state.select, openSecondary: state.openSecondary, toggle: state.toggle, hiddenProjects: state.hiddenProjects, unreadIds: state.unreadIds, markRead: state.markRead, markUnread: state.markUnread, syncedProjectId: state.syncedProjectId })))
  // A cold start paints the last list it saw (OXE-58 CA-2), read once per mount and only until the live list is in;
  // without one it shows a busy skeleton (CA-3), never the empty state.
  const [cachedList] = useState(() => useThreadStore.getState().listLoaded ? null : readThreadListCache())
  const fromCache = !listLoaded && !!cachedList && !liveThreads.length
  const coldSkeleton = !listLoaded && !cachedList && !liveThreads.length
  const listSource = listLoaded ? 'live' : fromCache ? 'cache' : undefined
  const threads = useMemo(() => fromCache && cachedList
    ? cachedList.threads.map(row => ({ ...row, workspaceId: '', rootPath: '', nativeSessionId: null }) as unknown as ConversationThread)
    : liveThreads, [fromCache, cachedList, liveThreads])
  const projects = useMemo<ThreadProjectSummary[]>(() => fromCache && cachedList
    ? cachedList.projects.map(item => ({ projectId: item.projectId, displayName: item.displayName, identityLabel: '', hidden: false, contexts: [] }))
    : liveProjects, [fromCache, cachedList, liveProjects])
  const sideBySideBlocked = (id: string): boolean => id === selectedId || id === secondaryId
  // A conversation that owns a worktree asks what to do with it before it is archived or deleted.
  const finishRequest = useThreadWorktreeFinishStore(state => state.request), askWorktreeFinish = useThreadWorktreeFinishStore(state => state.ask)
  const finishThread = finishRequest ? threads.find(thread => thread.id === finishRequest.threadId) : undefined
  const [confirmation, setConfirmation] = useState<{ kind: 'thread' | 'archive' | 'project'; id: string; title: string } | null>(null)
  const [actionError, setActionError] = useState(''), [acting, setActing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [showRemoved, setShowRemoved] = useState<boolean | null>(null)
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const [expandedProjects, setExpandedProjects] = useState<string[]>([])
  const [restoringId, setRestoringId] = useState<string | null>(null)
  // The conversation whose "…" menu a right click, Shift+F10 or the menu key opened.
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<ConversationThread | null>(null)
  const [projectSettingsId, setProjectSettingsId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const width = useNavigationPrefs(s => s.width), setWidth = useNavigationPrefs(s => s.setWidth)
  // The list's own density overrides the app-wide one (Settings › Appearance) once the person toggles it.
  const density = resolveDensity(useNavigationPrefs(s => s.threadDensity), useSettingsStore(s => s.density)), setDensity = useNavigationPrefs(s => s.setThreadDensity)
  const collapsed = useUIStore(s => s.collapsedSidebars.thread), toggleCollapse = useCallback(() => useUIStore.getState().toggleSidebar('thread'), [])
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  // OXE-133: persisted per-surface state selector (All, Needs you, Working), matching OxeCode's sidebar.
  const navStateFilter = useNavigationPrefs(s => s.stateFilter.thread)
  const setNavStateFilter = useNavigationPrefs(s => s.setStateFilter)
  // OXE-187: one state chip at a time; the strip shows while the filter has focus or a chip is on.
  const [stateFilter, setStateFilter] = useState<StateFilter | null>(null)
  const hasStateFilter = navStateFilter !== 'all' || stateFilter !== null
  const [filterFocused, setFilterFocused] = useState(false)
  const chipsRef = useRef<HTMLDivElement>(null)
  // Arrows and j/k move through conversations and projects; one tab stop for the whole list.
  const { ref: attachList, onKeyDown: onListKeyDown } = useListKeyboard<HTMLElement>()
  useNavigationSearch(search, collapsed, toggleCollapse, active)
  const selected = threads.find(t => t.id === selectedId)

  // Needs you: the read-only list every window uses (pendingRequestsAll), one request per waiting conversation.
  const [pending, setPending] = useState<Map<string, ThreadPendingRequestSummary>>(() => new Map())
  const waitingIds = useMemo(() => new Set(threads.filter(thread => thread.status === 'approval').map(thread => thread.id)), [threads])
  const waitingKey = useMemo(() => [...waitingIds].join(','), [waitingIds])
  const waitingIdsRef = useRef(waitingIds)
  const activeRef = useRef(active)
  const pendingSeq = useRef(0)
  const pendingInFlight = useRef(false)
  const pendingDirty = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { activeRef.current = active }, [active])
  const refreshPending = useCallback(() => {
    const load = () => {
      if (!activeRef.current) { pendingDirty.current = true; return }
      const read = window.oxe?.thread?.pendingRequestsAll
      if (!read) return
      if (pendingInFlight.current) { pendingDirty.current = true; return }
      pendingInFlight.current = true
      const seq = ++pendingSeq.current
      void Promise.resolve(read()).then(list => {
        if (!mounted.current || seq !== pendingSeq.current || !Array.isArray(list)) return
        const byThread = new Map<string, ThreadPendingRequestSummary>()
        for (const request of list) if (!byThread.has(request.threadId)) byThread.set(request.threadId, request)
        setPending(byThread)
      }).catch(() => undefined).finally(() => {
        pendingInFlight.current = false
        if (mounted.current && activeRef.current && pendingDirty.current) {
          pendingDirty.current = false
          if (waitingIdsRef.current.size > 0) load()
        }
      })
    }
    load()
  }, [])
  useEffect(() => {
    waitingIdsRef.current = waitingIds
    if (!waitingKey) {
      const seq = ++pendingSeq.current
      pendingDirty.current = false
      void Promise.resolve().then(() => {
        if (mounted.current && seq === pendingSeq.current) setPending(prev => prev.size ? new Map() : prev)
      })
      return
    }
    if (!activeRef.current) { pendingDirty.current = true; return }
    pendingDirty.current = false
    refreshPending()
  }, [waitingIds, waitingKey, refreshPending])
  useEffect(() => {
    const off = window.oxe?.thread?.onChanged?.(event => {
      if (!waitingIdsRef.current.size) return
      if (event?.threadId && !waitingIdsRef.current.has(event.threadId)) return
      if (!activeRef.current) { pendingDirty.current = true; return }
      refreshPending()
    })
    return () => { if (typeof off === 'function') off() }
  }, [refreshPending])
  useEffect(() => {
    if (!active || !pendingDirty.current) return
    pendingDirty.current = false
    if (waitingIdsRef.current.size > 0) refreshPending()
  }, [active, refreshPending])

  // Line 2's +N −N: the session view (OXE-170), read again when the list or a conversation's places change.
  const [changes, setChanges] = useState<Map<string, SessionChanges>>(() => new Map())
  // The order each session lists its parallel chats in (OXE-170 CA-4), by the session's (its main chat's) id.
  const [chatOrder, setChatOrder] = useState<Map<string, string[]>>(() => new Map())
  const sessionsKey = useMemo(() => threads.map(thread => `${thread.id}:${thread.status}`).join(','), [threads])
  const sessionsKeyRef = useRef(sessionsKey)
  const sessionsDirty = useRef(false)
  const refreshSessions = useCallback(() => {
    if (!activeRef.current) { sessionsDirty.current = true; return }
    const read = window.oxe?.thread?.sessions
    if (!read) return
    void Promise.resolve(read()).then(list => {
      if (!mounted.current || !Array.isArray(list)) return
      setChanges(new Map(list.map(session => [session.id, session.changes])))
      setChatOrder(new Map(list.map(session => [session.id, session.chats.filter(chat => !chat.main).map(chat => chat.id)])))
    }).catch(() => undefined)
  }, [])
  useEffect(() => {
    sessionsKeyRef.current = sessionsKey
    if (!sessionsKey) return
    if (!activeRef.current) { sessionsDirty.current = true; return }
    sessionsDirty.current = false
    refreshSessions()
  }, [sessionsKey, refreshSessions])
  useEffect(() => {
    const off = window.oxe?.thread?.onPlacesChanged?.(() => {
      if (!activeRef.current) { sessionsDirty.current = true; return }
      refreshSessions()
    })
    return () => { if (typeof off === 'function') off() }
  }, [refreshSessions])
  useEffect(() => {
    if (!active || !sessionsDirty.current) return
    sessionsDirty.current = false
    if (sessionsKeyRef.current) refreshSessions()
  }, [active, refreshSessions])

  // A parallel chat is drawn under its parent, never as a conversation of its own; one whose parent is not listed stays a row.
  const childrenOf = useMemo(() => {
    const listed = new Set(threads.filter(thread => !thread.archived).map(thread => thread.id))
    const byParent = new Map<string, ConversationThread[]>()
    for (const thread of threads) {
      if (thread.archived || !thread.parentThreadId || !listed.has(thread.parentThreadId)) continue
      byParent.set(thread.parentThreadId, [...(byParent.get(thread.parentThreadId) ?? []), thread])
    }
    for (const [parentId, list] of byParent) {
      const order = chatOrder.get(parentId) ?? []
      const at = (id: string): number => { const index = order.indexOf(id); return index < 0 ? Infinity : index }
      list.sort((a, b) => at(a.id) - at(b.id) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    }
    return byParent
  }, [threads, chatOrder])
  // Also matches by conversation content (native transcript index), not just title/path.
  const contentMatches = useThreadContentMatches(query)
  const contentHit = useCallback((thread: ConversationThread) => !!thread.nativeSessionId && contentMatches.has(thread.nativeSessionId), [contentMatches])
  const matchesSelectedStates = useCallback((thread: ConversationThread) =>
    (navStateFilter === 'all' || matchesStateFilter(thread, navStateFilter, unreadIds))
    && (!stateFilter || matchesStateFilter(thread, stateFilter, unreadIds)), [navStateFilter, stateFilter, unreadIds])
  const textMatches = useCallback((thread: ConversationThread, projectName: string) =>
    `${projectName} ${displayThreadTitle(thread.title)} ${thread.provider} ${thread.rootPath}`.toLowerCase().includes(query.toLowerCase()) || contentHit(thread), [query, contentHit])
  const stateCounts = useMemo(() => {
    const counts: Record<SidebarStateFilter, number> = { all: 0, 'needs-you': 0, working: 0 }
    const names = new Map(projects.map(p => [p.projectId, p.displayName]))
    for (const thread of threads) {
      if (thread.archived || hiddenProjects.includes(thread.projectId) || !names.has(thread.projectId)) continue
      if (!textMatches(thread, names.get(thread.projectId)!)) continue
      counts.all += 1
      const kind = threadNavigationStatus(thread).kind
      if (kind === 'attention') counts['needs-you'] += 1
      else if (kind === 'running') counts.working += 1
    }
    return counts
  }, [projects, threads, hiddenProjects, textMatches])
  const matches = (thread: ConversationThread, name: string) => !thread.archived && !hiddenProjects.includes(thread.projectId) && textMatches(thread, name) && matchesSelectedStates(thread)
  const groups = useMemo(() => {
    const catalog = new Map(projects.map(p => [p.projectId, { id: p.projectId, name: p.displayName, path: p.identityLabel, rootPath: p.contexts[0]?.rootPath, threads: [] as ConversationThread[] }]))
    for (const thread of threads) {
      if (thread.archived) continue
      const group = catalog.get(thread.projectId)
      if (!group) continue
      group.threads.push(thread); catalog.set(thread.projectId, group)
    }
    // Order by creation, not activity: every streamed event bumps updatedAt, and rows that jumped to the top
    // while an agent worked moved the conversation the person was about to click.
    return [...catalog.values()].map(g => ({ ...g, threads: g.threads.filter(t => !t.pinned && textMatches(t, g.name) && matchesSelectedStates(t)).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)) }))
      .filter(g => !hiddenProjects.includes(g.id) && (!hasStateFilter || g.threads.length > 0) && (!query || g.threads.length || (!hasStateFilter && g.name.toLowerCase().includes(query.toLowerCase()))))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }, [projects, threads, query, hiddenProjects, textMatches, matchesSelectedStates, hasStateFilter])
  const archived = useMemo(() => threads.filter(thread => thread.archived && !hiddenProjects.includes(thread.projectId)
    && (`${displayThreadTitle(thread.title)} ${thread.provider} ${thread.rootPath} ${projects.find(project => project.projectId === thread.projectId)?.displayName ?? ''}`.toLowerCase().includes(query.toLowerCase()) || contentHit(thread)))
    .sort((a, b) => b.updatedAt - a.updatedAt), [threads, projects, hiddenProjects, query, contentHit])
  const pinned = threads.filter(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  const removedProjects = useMemo(() => hiddenProjects
    .map(id => projects.find(item => item.projectId === id))
    .filter((project): project is ThreadProjectSummary => Boolean(project)), [hiddenProjects, projects])
  const matchingRemovedProjects = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return removedProjects
    return removedProjects.filter(project => `${project.displayName} ${project.identityLabel}`.toLowerCase().includes(term))
  }, [removedProjects, query])
  const removedVisible = query.trim() ? matchingRemovedProjects : removedProjects
  const noActiveProjects = !groups.length && !pinned.length && !query.trim() && !hasStateFilter
  const queryMatchesRemoved = Boolean(query.trim()) && matchingRemovedProjects.length > 0
  const removedOpen = queryMatchesRemoved || (showRemoved ?? noActiveProjects)
  // Sections inside each project (F13): dragging a row and its "Move to section" menu make the same move.
  const sections = useThreadSections(useMemo(() => groups.map(group => group.id), [groups]), threads)
  const drag = useSectionDrag(threads, (thread, sectionId) => void sections.moveTo(thread, sectionId))
  // A move re-renders the row in its new section, so the menu's focus would fall to the page: give it to the row.
  const { movedId, sectionOf, clearMoved } = sections
  useEffect(() => {
    if (!movedId || !active) return
    const item = document.querySelector<HTMLElement>(`[data-thread-row="${CSS.escape(movedId)}"] [data-list-item]`)
    if (!item) return
    const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected
    if (lost) item.focus({ preventScroll: false })
    clearMoved()
  }, [active, movedId, sectionOf, clearMoved])
  const restoreArchived = async (thread: ConversationThread) => {
    if (!window.oxe.thread?.command) { setActionError(t('sidebar.restartToRestore')); return }
    setActionError(''); setRestoringId(thread.id)
    try {
      await window.oxe.thread.command(thread.id, `/resume ${thread.id}`)
      const snapshot = await window.oxe.thread.read(thread.id)
      if (snapshot.thread.archived) throw Error(t('sidebar.notRestored'))
      useThreadStore.getState().adopt(snapshot)
      setShowArchived(false)
    } catch (error) { setActionError(humanizeError(error, t('sidebar.restoreFailed'))) }
    finally { setRestoringId(null) }
  }
  const row = (thread: ConversationThread, child = false) => {
    const name = displayThreadTitle(thread.title)
    // Chats do not nest: only a conversation that is no parallel chat starts one (OXE-170 CA-7).
    const parallel = onCreateParallel && !child && !thread.parentThreadId
      ? { label: t('sidebar.newParallel'), disabled: unavailableProjects.includes(thread.projectId), start: () => onCreateParallel(thread.id) }
      : null
    // Found by what was said in it: the line that matched, so the person sees why it is listed.
    const found = query && thread.nativeSessionId ? contentMatches.get(thread.nativeSessionId) : undefined
    return <ThreadSidebarRow key={thread.id} thread={thread} child={child} selected={!draft && selectedId === thread.id} unread={unreadIds.includes(thread.id)} changes={child ? undefined : changes.get(thread.id)}
      request={thread.status === 'approval' ? pending.get(thread.id) : undefined} time={relativeTime(thread.updatedAt)} dragProps={drag.rowProps(thread)}
      snippet={found && found.snippet ? <span className={cx('thread-session-snippet', styles.snippet)} data-testid="thread-content-snippet">{snippetParts(found.snippet).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</span> : undefined}
      onSelect={() => { onLeaveDraft?.(); void useThreadStore.getState().openInActiveCell(thread.id) }} onMenu={() => setRowMenuId(thread.id)} onOpenRequest={() => void select(thread.id)} onAnswered={refreshPending}
      actions={<>
        {parallel && <IconButton size="sm" data-list-action data-testid="thread-row-action" label={parallel.label} title={parallel.label} disabled={parallel.disabled}
          icon={<Plus size={14} aria-hidden="true" />} onClick={parallel.start} />}
        <IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.openSideNamed', { name })} title={sideBySideBlocked(thread.id) ? t('sidebar.alreadyOpen') : t('sidebar.openSide')} disabled={sideBySideBlocked(thread.id)}
          icon={<Columns2 size={14} aria-hidden="true" />} onClick={() => void openSecondary(thread.id).catch(error => setActionError(humanizeError(error, t('sidebar.openFailed'))))} />
        <Menu label={t('sidebar.actionsFor', { name })} side="right" open={rowMenuId === thread.id} onOpenChange={open => setRowMenuId(open ? thread.id : null)} items={[
          { label: t('sidebar.openToSide'), icon: <Columns2 size={14} />, disabled: sideBySideBlocked(thread.id), onSelect: () => void openSecondary(thread.id).catch(error => setActionError(humanizeError(error, t('sidebar.openFailed')))) },
          ...(parallel ? [{ label: parallel.label, icon: <Plus size={14} />, disabled: parallel.disabled, onSelect: parallel.start }] : []),
          { label: t('sidebar.renameMenu'), icon: <Pencil size={14} />, onSelect: () => { setActionError(''); setRenameTarget(thread); setRenameValue(namedThreadTitle(thread.title)) } },
          { label: thread.pinned ? t('sidebar.unpin') : t('sidebar.pin'), icon: <Pin size={14} />, onSelect: () => void useThreadStore.getState().pinThread(thread.id, !thread.pinned) },
          moveToSectionEntry(thread, sections.sectionsOf(thread.projectId), sections),
          { label: unreadIds.includes(thread.id) ? t('sidebar.markRead') : t('sidebar.markUnread'), icon: unreadIds.includes(thread.id) ? <Check size={14} /> : <Circle size={14} />, onSelect: () => unreadIds.includes(thread.id) ? markRead(thread.id) : markUnread(thread.id) },
          { type: 'separator' },
          { label: t('confirm.archive.confirm'), icon: <Archive size={14} />, onSelect: () => { setActionError(''); if (thread.ownedWorktree) askWorktreeFinish(thread.id, 'archive'); else setConfirmation({ kind: 'archive', id: thread.id, title: name }) } },
          { label: t('confirm.delete.confirm'), icon: <Trash2 size={14} />, danger: true, onSelect: () => { setActionError(''); if (thread.ownedWorktree) askWorktreeFinish(thread.id, 'delete'); else setConfirmation({ kind: 'thread', id: thread.id, title: name }) } }
        ]} trigger={<IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.actionsFor', { name })} title={t('sidebar.conversationActions')} icon={<MoreHorizontal size={14} aria-hidden="true" />}
          // Radix opens the menu on pointerdown; a click with no pointer behind it (detail 0: a screen reader's or a script's
          // activation) opens it too, and a mouse click (detail ≥ 1) is left to Radix.
          onClick={event => { if (event.detail === 0) setRowMenuId(thread.id) }} />} />
      </>} />
  }
  /**
   * The rows of one list (a section, No section, Pinned): each conversation and, right under it in a sibling role="group"
   * outside [data-thread-row], those of its parallel or delegated children the list shows, as one-line rows (OXE-170,
   * OXE-346). A child whose parent this list does not show stays a row of its own.
   */
  const rowsOf = (list: readonly ConversationThread[]) => {
    const shown = new Set(list.map(thread => thread.id))
    return list.flatMap(thread => {
      if (thread.parentThreadId && shown.has(thread.parentThreadId) && childrenOf.has(thread.parentThreadId)) return []
      const children = (childrenOf.get(thread.id) ?? []).filter(child => shown.has(child.id))
      if (children.length === 0) return [row(thread, !!thread.parentThreadId)]
      return [
        <div key={thread.id} className={cx('thread-navigation-item', styles.branch)} data-thread-branch={thread.id}>
          {row(thread, !!thread.parentThreadId)}
          <div role="group" aria-label={t('sidebar.childConversations', { name: displayThreadTitle(thread.title) })} className={styles.childGroup} onDragStart={event => event.stopPropagation()}>
            {children.map(child => row(child, true))}
          </div>
        </div>
      ]
    })
  }
  // New conversation goes to the synced OxeCode project (if just switched), the selected conversation's project, the active OxeCode workspace, or the first listed.
  const activeCodeRoot = workspaces.find(w => w.id === activeWorkspaceId)?.rootPath
  const platform = typeof window !== 'undefined' && window.oxe?.app?.platform ? window.oxe.app.platform : 'linux'
  const syncedGroup = syncedProjectId ? groups.find(group => group.id === syncedProjectId) : undefined
  const codeGroup = activeCodeRoot ? groups.find(group => group.rootPath && isSameRootPath(group.rootPath, activeCodeRoot, platform)) : undefined
  const createTarget = syncedGroup ?? groups.find(group => group.id === selected?.projectId) ?? codeGroup ?? groups[0]
  const [reviewPendingCount, setReviewPendingCount] = useState(0)
  useEffect(() => {
    const api = window.oxe?.schedules
    if (typeof api?.reviewQueue !== 'function') return
    let alive = true
    const refreshReviewCount = () => {
      const pending = api.reviewQueue?.()
      if (pending && typeof pending.then === 'function') {
        void pending
          .then(summary => { if (alive && typeof summary?.count === 'number') setReviewPendingCount(summary.count) })
          .catch(() => undefined)
      }
    }
    refreshReviewCount()
    const off = typeof api.onChanged === 'function'
      ? api.onChanged(event => {
          if (typeof event?.reviewPendingCount === 'number') setReviewPendingCount(event.reviewPendingCount)
          else refreshReviewCount()
        })
      : undefined
    return () => {
      alive = false
      if (typeof off === 'function') off()
    }
  }, [])
  const railPrimary: RailAction[] = [
    { id: 'new-conversation', label: t('view.newConversation'), icon: Plus, disabled: !createTarget || unavailableProjects.includes(createTarget.id), onClick: () => { if (createTarget) onCreate(createTarget.id, createTarget.rootPath) } },
    { id: 'schedules', label: reviewPendingCount > 0 ? t('schedules.titleWithReview', { count: reviewPendingCount }) : t('schedules.title'), icon: CalendarClock, onClick: () => useUIStore.getState().openSchedules(reviewPendingCount > 0 ? 'review' : 'schedules') }
  ]
  const railContext: RailAction = { id: 'accounts', label: t('sidebar.accounts'), ariaLabel: t('sidebar.agentAccounts'), icon: UserRound, onClick: onAccounts }
  return <aside className={`thread-navigation${collapsed ? ' thread-navigation-collapsed' : ''}`} style={active ? undefined : { display: 'none' }} aria-hidden={active ? undefined : true} data-density={density} data-list-source={listSource} aria-busy={coldSkeleton ? true : undefined} aria-label={t('sidebar.region')}>
    {!collapsed && <Splitter edge orientation="vertical" label={t('sidebar.width')} value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />}
    {collapsed && <ThreadRail
      conversations={threads.filter(thread => !thread.archived && !hiddenProjects.includes(thread.projectId))
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt)
        .map(thread => {
          const navStatus = threadNavigationStatus(thread)
          return { id: thread.id, title: displayThreadTitle(thread.title), needsYou: navStatus.kind === 'attention', current: thread.id === selectedId, status: navStatus.kind }
        })}
      onSelect={id => void select(id)}
      onArchived={() => { toggleCollapse(); setShowArchived(true) }} />}
    {!collapsed && <div className="nav-panel">
      <SidebarHeader title={t('sidebar.conversations')} actions={<><SidebarHeaderActions actions={railPrimary} />{reviewPendingCount > 0 && <Badge intent="attention" data-testid="review-queue-badge">{reviewPendingCount}</Badge>}</>} collapse={<SidebarCollapseButton mode="thread" />} />
      <SidebarFilter ref={search} className="thread-nav-search" icon={<Search size={14} />} hint={query ? undefined : '/'} aria-label={t('sidebar.filter')} placeholder={t('sidebar.filterPlaceholder')}
        value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={i18n.t('common:nav.clearSearch')} autoComplete="off" spellCheck={false}
        // Escape clears the text first (the filter does), then the state selector.
        onKeyDown={event => { if (event.key === 'Escape' && !query && navStateFilter !== 'all') { event.preventDefault(); event.stopPropagation(); setNavStateFilter('thread', 'all') } }}
        onFocus={() => setFilterFocused(true)} onBlur={event => { if (!chipsRef.current?.contains(event.relatedTarget as Node | null)) setFilterFocused(false) }} />
      <SegmentedControl className={cx('sidebar-state-filter', styles.stateFilter)} label={t('sidebar.stateFilter.label')} value={navStateFilter} onChange={value => setNavStateFilter('thread', value)}
        options={NAV_STATE_FILTERS.map(value => ({ value, label: <><span className={styles.stateLabel}>{t(`sidebar.stateFilter.${NAV_STATE_KEYS[value]}`)}</span>{' '}<span className={cx('sidebar-state-count', styles.stateCount)}>{stateCounts[value]}</span></> }))} />
      {(filterFocused || stateFilter) && <div ref={chipsRef} role="group" aria-label={t('sidebar.filterByState')} data-ui="thread-state-chips" className={styles.stateChips}
        onBlur={event => { const next = event.relatedTarget as Node | null; if (next !== search.current && !event.currentTarget.contains(next)) setFilterFocused(false) }}>
        {STATE_CHIPS.map(chip => <Button key={chip.filter} size="sm" variant={stateFilter === chip.filter ? 'secondary' : 'ghost'} aria-pressed={stateFilter === chip.filter}
          onClick={() => setStateFilter(value => value === chip.filter ? null : chip.filter)}>{t(chip.labelKey)}</Button>)}
      </div>}
      <nav ref={attachList} onKeyDown={onListKeyDown} className={cx('thread-project-list', styles.list)} aria-label={t('sidebar.projectsRegion')}>
        {coldSkeleton
          // motion.md rule 3 (OXE-343): no placeholder before 300 ms, so a list that arrives sooner never flashes one; the
          // busy aside and the block hold its place until then, and cached rows, when there are any, paint at once.
          ? <div data-testid="thread-sidebar-skeleton"><Skeleton lines={5} label={t('sidebar.loading')} delay={300} /></div>
          : loading && !threads.length && <LoadingState label={t('sidebar.loading')} />}
        {Object.entries(errors).map(([id, error]) => <ErrorState key={id} compact title={error} retryLabel={t('common.tryAgain')} onRetry={() => { void useThreadStore.getState().load(); void useThreadStore.getState().loadProjects() }} />)}
        {pinned.length > 0 && <section data-ui="thread-pinned-section">
          <SidebarSection label={<span role="heading" aria-level={2}>{t('sidebar.pinnedHeading')}</span>} />
          <div className={cx('thread-pinned-rows', styles.rows)}>{rowsOf(pinned)}</div>
        </section>}
        {!coldSkeleton && <SidebarSection label={t('sidebar.projects')} alwaysShowAction action={<>
          <IconButton size="sm" label={t('sidebar.compact')} title={density === 'compact' ? t('sidebar.comfortableSpacing') : t('sidebar.compactSpacing')} aria-pressed={density === 'compact'}
            icon={<AlignJustify size={14} aria-hidden="true" />} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} />
          {onAddProject && <IconButton size="sm" label={t('sidebar.addProject')} title={t('sidebar.addProject')} icon={<FolderPlus size={14} aria-hidden="true" />} onClick={onAddProject} />}
        </>} />}
        {groups.map(group => {
          const matchedColor = workspaces.find(w => w.rootPath === group.rootPath)?.color ?? null
          const open = query || hasStateFilter || draft?.projectId === group.id ? true : expanded[group.id] ?? true
          const unavailable = unavailableProjects.includes(group.id)
          const duplicate = groups.filter(g => g.name === group.name).length > 1
          // OXE-187: a collapsed project says its most urgent conversation; an open one shows its rows instead.
          const signal = open ? null : dominantGroupSignal(group.threads, unreadIds)
          const signalLabel = signal ? t(`status.${GROUP_SIGNAL_WORD[signal]}`) : ''
          const summary = signal ? t('sidebar.groupSummary', { name: group.name, conversations: t('sidebar.conversationCount', { count: group.threads.length }), state: signalLabel }) : undefined
          return <section key={group.id} {...workspaceColorAttrs({ id: group.id, color: typeof matchedColor === 'string' ? null : matchedColor })} className={cx('thread-project-group', styles.group, selected?.projectId === group.id && 'is-active')}>
            <SidebarGroup className={cx('thread-project-toggle', styles.groupRow)} data-list-item aria-expanded={open} aria-label={summary} onSelect={() => toggle(group.id)}
              meta={signal ? <StatusSignal state={signal} label={signalLabel} size={12} /> : undefined}
              lead={<ChevronDown size={12} className={styles.chevron} aria-hidden="true" />}
              title={<><span className={styles.projectDot} aria-hidden="true" /><span className={cx('thread-project-name', styles.name)}>{group.name}</span>{unavailable && <small className={styles.dupPath}> {t('sidebar.directoryMissing')}</small>}{duplicate && <small className={styles.dupPath}> {group.path.split(/[\\/]/).slice(-2).join('/')}</small>}</>}
              actions={<>
                <IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.newInNamed', { name: group.name })} title={t('sidebar.newIn')} disabled={!group.rootPath || unavailable} icon={<Plus size={14} aria-hidden="true" />} onClick={() => onCreate(group.id, group.rootPath)} />
                <Menu label={t('sidebar.projectActions', { name: group.name })} align="end"
                  trigger={<IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.actionsFor', { name: group.name })} title={t('sidebar.projectActions', { name: group.name })} data-project-actions={group.id} icon={<MoreHorizontal size={14} aria-hidden="true" />} />}
                  items={[
                    { label: t('sidebar.projectSettings'), onSelect: () => setProjectSettingsId(group.id) },
                    { label: t('sections.newSection'), onSelect: () => sections.setDialog({ kind: 'create', projectId: group.id }) },
                    ...(group.rootPath ? [{ label: t('sidebar.openInCode'), disabled: unavailable, onSelect: () => void onOpenInCode?.(group.rootPath!).catch(error => setActionError(humanizeError(error, t('sidebar.openInCodeFailed')))) }] : []),
                    { type: 'separator' as const },
                    { label: t('sidebar.removeProjectMenu'), danger: true, onSelect: () => { setActionError(''); setConfirmation({ kind: 'project', id: group.id, title: group.name }) } }
                  ]} />
              </>} />
            {open && <div className={cx('thread-project-children', styles.children)}>{(() => {
              const split = groupBySection(group.threads, sections.sectionsOf(group.id), sections.sectionOf)
              const limit = query || hasStateFilter || expandedProjects.includes(group.id) ? Infinity : THREAD_ROWS_PER_PROJECT
              const base = split.loose.filter((thread, index) => index < limit || thread.id === selectedId)
              const baseIds = new Set(base.map(thread => thread.id))
              const visible = split.loose.filter(thread => baseIds.has(thread.id) || (!!thread.parentThreadId && baseIds.has(thread.parentThreadId)))
              return <>
                {draft?.projectId === group.id && <div ref={markDraftCurrent} className={cx('thread-navigation-row', styles.row)} data-thread-draft={group.id}>
                  <SidebarRow className={cx('thread-navigation-item', styles.item)} selected lead={<Pencil size={12} aria-hidden="true" />} title={`${t('view.newConversation')} · ${t('sidebar.draft')}`} />
                </div>}
                {split.sections.map((item, index) => <ThreadSectionGroup key={item.section.id} group={item} index={index} total={split.sections.length} searching={!!query || hasStateFilter} controller={sections} zoneProps={drag.zoneProps} renderRows={rowsOf} rowsClassName={styles.rows} />)}
                {split.sections.length > 0 && <SidebarSection label={t('sections.none')} />}
                <div className={cx('thread-project-rows', styles.rows, sectionStyles.loose, drag.dragging && sectionStyles.dragging)} {...drag.zoneProps({ projectId: group.id, sectionId: null })}>{rowsOf(visible)}{split.loose.length > visible.length && <Button variant="ghost" size="sm" data-list-item className={cx('thread-show-more', styles.showMore)} onClick={() => setExpandedProjects(value => [...value, group.id])}>{t('sidebar.showMore', { count: split.loose.length - visible.length })}</Button>}</div>
              </>
            })()}</div>}
          </section>
        })}
        {archived.length > 0 && !hasStateFilter && <section className={cx('thread-archived-section', styles.archivedSection)} aria-label={t('sidebar.archivedRegion')}>
          <SidebarGroup className={cx('thread-project-toggle', styles.groupRow)} data-list-item aria-expanded={query ? true : showArchived} aria-label={`${t('sidebar.archived')} ${archived.length}`}
            lead={<ChevronDown size={12} className={styles.chevron} aria-hidden="true" />} title={t('sidebar.archived')} meta={<span className={styles.count}>{archived.length}</span>} onSelect={() => setShowArchived(value => !value)} />
          {(query || showArchived) && <div className={styles.rows}>{archived.map(thread => <div key={thread.id} className={cx('thread-navigation-row thread-archived-row', styles.row, styles.archivedRow)}>
            <SidebarRow className={cx('thread-navigation-item', styles.item)} data-list-item title={<>{thread.provider && <AgentProviderIcon provider={thread.provider} size={14} />}{displayThreadTitle(thread.title)}</>} meta={relativeTime(thread.updatedAt)} onSelect={restoringId !== null ? undefined : () => void restoreArchived(thread)}
              actions={<IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.restoreNamed', { name: displayThreadTitle(thread.title) })} title={t('sidebar.restoreConversation')} disabled={restoringId !== null}
                icon={restoringId === thread.id ? <Spinner size="sm" decorative /> : <ArchiveRestore size={14} aria-hidden="true" />} onClick={() => void restoreArchived(thread)} />} />
          </div>)}</div>}
        </section>}
        {actionError && <ErrorState compact title={actionError} />}
        {/* Moves and deletes are said here, politely, as they happen. */}
        <p className="sr-only" role="status" aria-live="polite" data-testid="thread-sections-announcer">{sections.announcement}</p>
        {sections.error && <Notice intent="danger" actions={<Button size="sm" variant="ghost" onClick={sections.clearError}>{t('common.close')}</Button>}>{sections.error}</Notice>}
        {!loading && !coldSkeleton && !groups.length && !pinned.length && (query && stateCounts.all === 0
          ? <EmptyState compact title={t('sidebar.noMatches')} />
          : navStateFilter !== 'all'
          ? <EmptyState compact title={t(navStateFilter === 'needs-you' ? 'sidebar.stateFilter.emptyNeedsYou' : 'sidebar.stateFilter.emptyWorking')}
              actions={<Button size="sm" variant="secondary" onClick={() => { setNavStateFilter('thread', 'all'); setStateFilter(null) }}>{t('sidebar.stateFilter.showAll')}</Button>} />
          : <EmptyState compact title={stateFilter ? t('sidebar.noMatches') : hiddenProjects.length ? t('sidebar.restoreOrAdd') : t('sidebar.addToStart')}
              actions={!query && !stateFilter && onAddProject ? <Button size="sm" variant="secondary" icon={<FolderPlus size={12} aria-hidden="true" />} onClick={onAddProject}>{t('sidebar.addProject')}</Button> : undefined} />)}
        {removedVisible.length > 0 && <section data-ui="thread-hidden-section" className={styles.removedSection} aria-label={t('sidebar.removedProjects')}>
          <SidebarGroup className={cx('thread-project-toggle', styles.groupRow, styles.removedGroup)} data-list-item aria-expanded={removedOpen} aria-label={`${t('sidebar.removedProjects')} ${removedVisible.length}`}
            lead={<ChevronDown size={12} className={styles.chevron} aria-hidden="true" />} title={t('sidebar.removedProjects')} meta={<span className={styles.count}>{removedVisible.length}</span>} onSelect={() => setShowRemoved(!removedOpen)} />
          {removedOpen && <div className={styles.rows}>{removedVisible.map(project =>
            <Button key={project.projectId} variant="ghost" size="sm" data-list-item className={cx('thread-restore-project', styles.restore)} title={project.identityLabel} icon={<ArchiveRestore size={14} aria-hidden="true" />}
              onClick={() => { setShowRemoved(removedProjects.length > 1 ? true : null); void useThreadStore.getState().restoreProject(project.projectId) }}><span>{project.displayName}</span>{' '}<small>{t('sidebar.restore')}</small></Button>
          )}</div>}
        </section>}
      </nav>
      <SidebarFooterBar className="nav-rail-footer" context={railContext} onToggle={toggleCollapse} />
    </div>}
    {projectSettingsId && projects.find(project => project.projectId === projectSettingsId) &&
      <ThreadProjectSettingsDialog project={projects.find(project => project.projectId === projectSettingsId)!} unavailable={unavailableProjects.includes(projectSettingsId)} onClose={() => setProjectSettingsId(null)} returnFocusTo={() => document.querySelector<HTMLElement>(`[data-project-actions="${projectSettingsId}"]`)} />}
    {renameTarget && <Dialog size="md" closeLabel={t('common.close')} title={t('commandDialog.rename')} description={t('commandDialog.surface.rename')} onClose={() => { if (!acting) setRenameTarget(null) }}
      actions={{
        cancel: { label: t('common.cancel'), disabled: acting, onClick: () => setRenameTarget(null) },
        primary: { label: acting ? t('sidebar.renaming') : t('commandDialog.rename'), disabled: acting || !renameValue.trim() || renameValue.trim() === renameTarget.title, onClick: () => (document.getElementById('rename-thread-form') as HTMLFormElement | null)?.requestSubmit() }
      }}>
      <form id="rename-thread-form" className="thread-create-body" onSubmit={event => { event.preventDefault(); const title = renameValue.trim(); if (acting || !title || title === renameTarget.title || !window.oxe.thread?.command) return
        // The new name shows at once; a failed save puts the old one back and says so in a toast.
        setRenameTarget(null); void useThreadStore.getState().renameThread(renameTarget.id, title)
      }}>
        <label>{t('sidebar.name')}<TextField aria-label={t('sidebar.name')} autoFocus maxLength={120} value={renameValue} onChange={event => setRenameValue(event.target.value)} /></label>
      </form>
    </Dialog>}
    <ThreadSectionDialogs controller={sections} />
    {finishRequest && finishThread && <ThreadWorktreeFinishDialog key={finishRequest.threadId} thread={finishThread} action={finishRequest.action} onOpenInCode={onOpenInCode} onClose={() => useThreadWorktreeFinishStore.getState().clear()} />}
    {confirmation && <ConfirmDialog cancelLabel={t('common.cancel')}
      {...(confirmation.kind === 'project'
        ? { title: t('sidebar.removeProject.title'), confirmLabel: t('sidebar.removeProject.confirm'), danger: true, description: t('sidebar.removeProject.description', { name: confirmation.title }) }
        : threadConfirmationText(confirmation.kind === 'thread' ? 'delete' : 'archive', confirmation.title))}
      busy={acting}
      error={actionError}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => {
        // Removing a project and archiving show at once; a failed save undoes them with a toast.
        if (confirmation.kind === 'project') { setConfirmation(null); if (groups.length <= 1 && !pinned.length) setShowRemoved(null); void useThreadStore.getState().hideProject(confirmation.id); return }
        if (confirmation.kind === 'archive' && window.oxe.thread?.command) {
          setConfirmation(null); void useThreadStore.getState().archiveThread(confirmation.id).then(saved => { if (saved) setShowArchived(true) }); return
        }
        setActing(true); setActionError('')
        void (async () => {
          try {
            if (!window.oxe.thread?.command) throw Error(t('sidebar.restartToDelete'))
            await window.oxe.thread.command(confirmation.id, threadConfirmation('delete').command)
            // Gone from the cached list at once, even if the reload below is slow.
            useThreadStore.getState().dropFromListCache(confirmation.id)
            await useThreadStore.getState().load()
            setConfirmation(null)
          } catch (error) { setActionError(humanizeError(error, t('errors.action'))) }
          finally { setActing(false) }
        })()
      }} />}
  </aside>
}
