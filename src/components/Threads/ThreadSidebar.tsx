import { useShallow } from 'zustand/react/shallow'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorState, IconButton, LoadingState, Menu, Notice, SidebarFilter, SidebarGroup, SidebarHeader, SidebarRow, SidebarSection, Skeleton, Spinner, Splitter, cx, TextField } from '../../ui'
import styles from './ThreadSidebar.module.css'
import { snippetParts, useThreadContentMatches } from '../../hooks/useThreadContentSearch'
import { AlignJustify, Archive, ArchiveRestore, CalendarClock, Check, ChevronDown, Circle, Columns2, FolderPlus, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2, UserRound } from 'lucide-react'
import type { ConversationThread, ThreadPendingRequestSummary, ThreadProjectSummary } from '../../../shared/types/thread'
import type { SessionChanges } from '../../../shared/types/thread-session'
import { useThreadStore } from '../../store/thread.store'
import { readThreadListCache } from '../../store/threadListCache'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { workspaceColorAttrs } from '../../../shared/workspace-color'
import { SidebarFooterBar, SidebarHeaderActions, type RailAction } from '../Navigation/NavigationChrome'
import { SidebarCollapseButton } from '../Sidebar/SidebarCollapseButton'
import { ThreadRail } from './ThreadRail'
import { ThreadSidebarRow } from './ThreadSidebarRow'
import { useNavigationSearch } from '../Navigation/useNavigationSearch'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs } from '../../store/navigation-prefs.store'
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

/** The chips under the filter, in this order; Unread is a condition, last (OXE-187 RN-2). */
const STATE_CHIPS: ReadonlyArray<{ filter: StateFilter; label: 'status.attention' | 'status.running' | 'status.failed' | 'sidebar.filterUnread' }> = [
  { filter: 'needs-you', label: 'status.attention' }, { filter: 'working', label: 'status.running' }, { filter: 'failed', label: 'status.failed' }, { filter: 'unread', label: 'sidebar.filterUnread' }
]

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  const t = i18n.t.bind(i18n)
  return minutes < 1 ? t('thread:sidebar.age.now') : minutes < 60 ? t('thread:sidebar.age.minutes', { count: minutes }) : minutes < 1440 ? t('thread:sidebar.age.hours', { count: Math.floor(minutes / 60) }) : t('thread:sidebar.age.days', { count: Math.floor(minutes / 1440) })
}

/**
 * The OxeChat sidebar (BRD-02, OXE-166, OXC-1) on OxeCode's mould: a src/ui SidebarHeader (Conversations, New
 * conversation, Schedules, collapse), a SidebarFilter, Pinned, the Projects label, one SidebarGroup per project with its
 * sections and then No section, Archived last and collapsed, and a SidebarFooter of IconButtons. Each conversation is a
 * two-line SidebarRow; one that waits shows its needs-you mini card, read from pendingRequestsAll().
 */
export function ThreadSidebar({ onCreate, onAccounts, onAddProject, onOpenInCode }: {
  onCreate: (projectId: string, rootPath?: string) => void; onAccounts?: () => void; onAddProject?: () => void; onOpenInCode?: (rootPath: string) => Promise<void>
}) {
  const { t } = useTranslation('thread')
  // Only these fields: the store also changes for drafts, snapshots and scroll positions, which the list never shows.
  const { threads: liveThreads, projects: liveProjects, listLoaded, unavailableProjects, selectedId, secondaryId, expanded, errors, loading, select, openSecondary, toggle, hiddenProjects, unreadIds, markRead, markUnread } = useThreadStore(useShallow(state => ({
    threads: state.threads, projects: state.projects, unavailableProjects: state.unavailableProjects, selectedId: state.selectedId, secondaryId: state.secondaryId, expanded: state.expanded, errors: state.errors, loading: state.loading, listLoaded: state.listLoaded,
    select: state.select, openSecondary: state.openSecondary, toggle: state.toggle, hiddenProjects: state.hiddenProjects, unreadIds: state.unreadIds, markRead: state.markRead, markUnread: state.markUnread })))
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
  const workspaces = useWorkspaceStore(state => state.workspaces)
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
  // OXE-187: one state chip at a time; the strip shows while the filter has focus or a chip is on.
  const [stateFilter, setStateFilter] = useState<StateFilter | null>(null)
  const [filterFocused, setFilterFocused] = useState(false)
  const chipsRef = useRef<HTMLDivElement>(null)
  // Arrows and j/k move through conversations and projects; one tab stop for the whole list.
  const { ref: attachList, onKeyDown: onListKeyDown } = useListKeyboard<HTMLElement>()
  useNavigationSearch(search, collapsed, toggleCollapse)
  const selected = threads.find(t => t.id === selectedId)

  // Needs you: the read-only list every window uses (pendingRequestsAll), one request per waiting conversation.
  const [pending, setPending] = useState<Map<string, ThreadPendingRequestSummary>>(() => new Map())
  const waitingIds = useMemo(() => new Set(threads.filter(thread => thread.status === 'approval').map(thread => thread.id)), [threads])
  const waitingKey = useMemo(() => [...waitingIds].join(','), [waitingIds])
  const waitingIdsRef = useRef(waitingIds)
  const pendingSeq = useRef(0)
  const pendingInFlight = useRef(false)
  const pendingDirty = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const refreshPending = useCallback(() => {
    const load = () => {
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
        if (mounted.current && pendingDirty.current) {
          pendingDirty.current = false
          if (waitingIdsRef.current.size > 0) load()
        }
      })
    }
    load()
  }, [])
  useEffect(() => {
    waitingIdsRef.current = waitingIds
    if (waitingKey) { refreshPending(); return }
    const seq = ++pendingSeq.current
    pendingDirty.current = false
    void Promise.resolve().then(() => {
      if (mounted.current && seq === pendingSeq.current) setPending(prev => prev.size ? new Map() : prev)
    })
  }, [waitingIds, waitingKey, refreshPending])
  useEffect(() => {
    const off = window.oxe?.thread?.onChanged?.(event => {
      if (!waitingIdsRef.current.size) return
      if (event?.threadId && !waitingIdsRef.current.has(event.threadId)) return
      refreshPending()
    })
    return () => { if (typeof off === 'function') off() }
  }, [refreshPending])

  // Line 2's +N −N: the session view (OXE-170), read again when the list or a conversation's places change.
  const [changes, setChanges] = useState<Map<string, SessionChanges>>(() => new Map())
  const sessionsKey = useMemo(() => threads.map(thread => `${thread.id}:${thread.status}`).join(','), [threads])
  const refreshSessions = useCallback(() => {
    const read = window.oxe?.thread?.sessions
    if (!read) return
    void Promise.resolve(read()).then(list => {
      if (!Array.isArray(list)) return
      setChanges(new Map(list.map(session => [session.id, session.changes])))
    }).catch(() => undefined)
  }, [])
  useEffect(() => { if (sessionsKey) refreshSessions() }, [sessionsKey, refreshSessions])
  useEffect(() => {
    const off = window.oxe?.thread?.onPlacesChanged?.(() => refreshSessions())
    return () => { if (typeof off === 'function') off() }
  }, [refreshSessions])

  // Also matches by conversation content (native transcript index), not just title/path.
  const contentMatches = useThreadContentMatches(query)
  const contentHit = useCallback((thread: ConversationThread) => !!thread.nativeSessionId && contentMatches.has(thread.nativeSessionId), [contentMatches])
  const matches = (thread: ConversationThread, name: string) => !thread.archived && !hiddenProjects.includes(thread.projectId) && (`${name} ${displayThreadTitle(thread.title)} ${thread.provider} ${thread.rootPath}`.toLowerCase().includes(query.toLowerCase()) || contentHit(thread)) && (!stateFilter || matchesStateFilter(thread, stateFilter, unreadIds))
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
    return [...catalog.values()].map(g => ({ ...g, threads: g.threads.filter(t => !t.pinned && (`${g.name} ${displayThreadTitle(t.title)} ${t.provider} ${t.rootPath}`.toLowerCase().includes(query.toLowerCase()) || contentHit(t)) && (!stateFilter || matchesStateFilter(t, stateFilter, unreadIds))).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)) }))
      .filter(g => !hiddenProjects.includes(g.id) && (!stateFilter || g.threads.length > 0) && (!query || g.threads.length || g.name.toLowerCase().includes(query.toLowerCase())))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }, [projects, threads, query, hiddenProjects, contentHit, stateFilter, unreadIds])
  const archived = useMemo(() => threads.filter(thread => thread.archived && !hiddenProjects.includes(thread.projectId)
    && (`${displayThreadTitle(thread.title)} ${thread.provider} ${thread.rootPath} ${projects.find(project => project.projectId === thread.projectId)?.displayName ?? ''}`.toLowerCase().includes(query.toLowerCase()) || contentHit(thread)))
    .sort((a, b) => b.updatedAt - a.updatedAt), [threads, projects, hiddenProjects, query, contentHit])
  const pinned = threads.filter(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  // Sections inside each project (F13): dragging a row and its "Move to section" menu make the same move.
  const sections = useThreadSections(useMemo(() => groups.map(group => group.id), [groups]), threads)
  const drag = useSectionDrag(threads, (thread, sectionId) => void sections.moveTo(thread, sectionId))
  // A move re-renders the row in its new section, so the menu's focus would fall to the page: give it to the row.
  const { movedId, sectionOf, clearMoved } = sections
  useEffect(() => {
    if (!movedId) return
    const item = document.querySelector<HTMLElement>(`[data-thread-row="${CSS.escape(movedId)}"] [data-list-item]`)
    if (!item) return
    const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected
    if (lost) item.focus({ preventScroll: false })
    clearMoved()
  }, [movedId, sectionOf, clearMoved])
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
  const row = (thread: ConversationThread) => {
    const name = displayThreadTitle(thread.title)
    // Found by what was said in it: the line that matched, so the person sees why it is listed.
    const found = query && thread.nativeSessionId ? contentMatches.get(thread.nativeSessionId) : undefined
    return <ThreadSidebarRow key={thread.id} thread={thread} selected={selectedId === thread.id} unread={unreadIds.includes(thread.id)} changes={changes.get(thread.id)}
      request={thread.status === 'approval' ? pending.get(thread.id) : undefined} time={relativeTime(thread.updatedAt)} dragProps={drag.rowProps(thread)}
      snippet={found && found.snippet ? <span className={cx('thread-session-snippet', styles.snippet)} data-testid="thread-content-snippet">{snippetParts(found.snippet).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</span> : undefined}
      onSelect={() => void select(thread.id)} onMenu={() => setRowMenuId(thread.id)} onOpenRequest={() => void select(thread.id)} onAnswered={refreshPending}
      actions={<>
        <IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.openSideNamed', { name })} title={sideBySideBlocked(thread.id) ? t('sidebar.alreadyOpen') : t('sidebar.openSide')} disabled={sideBySideBlocked(thread.id)}
          icon={<Columns2 size={14} aria-hidden="true" />} onClick={() => void openSecondary(thread.id).catch(error => setActionError(humanizeError(error, t('sidebar.openFailed'))))} />
        <Menu label={t('sidebar.actionsFor', { name })} side="right" open={rowMenuId === thread.id} onOpenChange={open => setRowMenuId(open ? thread.id : null)} items={[
          { label: t('sidebar.openToSide'), icon: <Columns2 size={14} />, disabled: sideBySideBlocked(thread.id), onSelect: () => void openSecondary(thread.id).catch(error => setActionError(humanizeError(error, t('sidebar.openFailed')))) },
          { label: t('sidebar.renameMenu'), icon: <Pencil size={14} />, onSelect: () => { setActionError(''); setRenameTarget(thread); setRenameValue(namedThreadTitle(thread.title)) } },
          { label: thread.pinned ? t('sidebar.unpin') : t('sidebar.pin'), icon: <Pin size={14} />, onSelect: () => void useThreadStore.getState().pinThread(thread.id, !thread.pinned) },
          moveToSectionEntry(thread, sections.sectionsOf(thread.projectId), sections),
          { label: unreadIds.includes(thread.id) ? t('sidebar.markRead') : t('sidebar.markUnread'), icon: unreadIds.includes(thread.id) ? <Check size={14} /> : <Circle size={14} />, onSelect: () => unreadIds.includes(thread.id) ? markRead(thread.id) : markUnread(thread.id) },
          { type: 'separator' },
          { label: t('confirm.archive.confirm'), icon: <Archive size={14} />, onSelect: () => { setActionError(''); if (thread.ownedWorktree) askWorktreeFinish(thread.id, 'archive'); else setConfirmation({ kind: 'archive', id: thread.id, title: name }) } },
          { label: t('confirm.delete.confirm'), icon: <Trash2 size={14} />, danger: true, onSelect: () => { setActionError(''); if (thread.ownedWorktree) askWorktreeFinish(thread.id, 'delete'); else setConfirmation({ kind: 'thread', id: thread.id, title: name }) } }
        ]} trigger={<IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.actionsFor', { name })} title={t('sidebar.conversationActions')} icon={<MoreHorizontal size={14} aria-hidden="true" />} />} />
      </>} />
  }
  // New conversation goes to the selected conversation's project, or the first one listed.
  const createTarget = groups.find(group => group.id === selected?.projectId) ?? groups[0]
  const railPrimary: RailAction[] = [
    { id: 'new-conversation', label: t('view.newConversation'), icon: Plus, disabled: !createTarget || unavailableProjects.includes(createTarget.id), onClick: () => { if (createTarget) onCreate(createTarget.id, createTarget.rootPath) } },
    { id: 'schedules', label: t('schedules.title'), icon: CalendarClock, onClick: () => useUIStore.getState().openSchedules() }
  ]
  const railContext: RailAction = { id: 'accounts', label: t('sidebar.accounts'), ariaLabel: t('sidebar.agentAccounts'), icon: UserRound, onClick: onAccounts }
  return <aside className={`thread-navigation${collapsed ? ' thread-navigation-collapsed' : ''}`} data-density={density} data-list-source={listSource} aria-busy={coldSkeleton ? true : undefined} aria-label={t('sidebar.region')}>
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
      <SidebarHeader title={t('sidebar.conversations')} actions={<SidebarHeaderActions actions={railPrimary} />} collapse={<SidebarCollapseButton mode="thread" />} />
      <SidebarFilter ref={search} className="thread-nav-search" icon={<Search size={14} />} hint={query ? undefined : '/'} aria-label={t('sidebar.filter')} placeholder={t('sidebar.filterPlaceholder')}
        value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={i18n.t('common:nav.clearSearch')} autoComplete="off" spellCheck={false}
        onFocus={() => setFilterFocused(true)} onBlur={event => { if (!chipsRef.current?.contains(event.relatedTarget as Node | null)) setFilterFocused(false) }} />
      {(filterFocused || stateFilter) && <div ref={chipsRef} role="group" aria-label={t('sidebar.filterByState')} data-ui="thread-state-chips" className={styles.stateChips}
        onBlur={event => { const next = event.relatedTarget as Node | null; if (next !== search.current && !event.currentTarget.contains(next)) setFilterFocused(false) }}>
        {STATE_CHIPS.map(chip => <Button key={chip.filter} size="sm" variant={stateFilter === chip.filter ? 'secondary' : 'ghost'} aria-pressed={stateFilter === chip.filter}
          onClick={() => setStateFilter(value => value === chip.filter ? null : chip.filter)}>{t(chip.label)}</Button>)}
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
          <div className={cx('thread-pinned-rows', styles.rows)}>{pinned.map(row)}</div>
        </section>}
        {!coldSkeleton && <SidebarSection label={t('sidebar.projects')} action={<>
          <IconButton size="sm" label={t('sidebar.compact')} title={density === 'compact' ? t('sidebar.comfortableSpacing') : t('sidebar.compactSpacing')} aria-pressed={density === 'compact'}
            icon={<AlignJustify size={14} aria-hidden="true" />} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')} />
          {onAddProject && <IconButton size="sm" label={t('sidebar.addProject')} title={t('sidebar.addProject')} icon={<FolderPlus size={14} aria-hidden="true" />} onClick={onAddProject} />}
        </>} />}
        {groups.map(group => {
          const matchedColor = workspaces.find(w => w.rootPath === group.rootPath)?.color ?? null
          const open = query || stateFilter ? true : expanded[group.id] ?? true
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
              const limit = query || stateFilter || expandedProjects.includes(group.id) ? Infinity : THREAD_ROWS_PER_PROJECT
              const visible = split.loose.filter((thread, index) => index < limit || thread.id === selectedId)
              return <>
                {split.sections.map((item, index) => <ThreadSectionGroup key={item.section.id} group={item} index={index} total={split.sections.length} searching={!!query || !!stateFilter} controller={sections} zoneProps={drag.zoneProps} renderRow={row} rowsClassName={styles.rows} />)}
                {split.sections.length > 0 && <SidebarSection label={t('sections.none')} />}
                <div className={cx('thread-project-rows', styles.rows, sectionStyles.loose, drag.dragging && sectionStyles.dragging)} {...drag.zoneProps({ projectId: group.id, sectionId: null })}>{visible.map(row)}{split.loose.length > visible.length && <Button variant="ghost" size="sm" data-list-item className={cx('thread-show-more', styles.showMore)} onClick={() => setExpandedProjects(value => [...value, group.id])}>{t('sidebar.showMore', { count: split.loose.length - visible.length })}</Button>}</div>
              </>
            })()}</div>}
          </section>
        })}
        {archived.length > 0 && !stateFilter && <section className={cx('thread-archived-section', styles.archivedSection)} aria-label={t('sidebar.archivedRegion')}>
          <SidebarGroup className={cx('thread-project-toggle', styles.groupRow)} data-list-item aria-expanded={query ? true : showArchived} aria-label={`${t('sidebar.archived')} ${archived.length}`}
            lead={<ChevronDown size={12} className={styles.chevron} aria-hidden="true" />} title={t('sidebar.archived')} meta={<span className={styles.count}>{archived.length}</span>} onSelect={() => setShowArchived(value => !value)} />
          {(query || showArchived) && <div className={styles.rows}>{archived.map(thread => <div key={thread.id} className={cx('thread-navigation-row thread-archived-row', styles.row, styles.archivedRow)}>
            <SidebarRow className={cx('thread-navigation-item', styles.item)} data-list-item title={displayThreadTitle(thread.title)} meta={relativeTime(thread.updatedAt)} onSelect={restoringId !== null ? undefined : () => void restoreArchived(thread)}
              actions={<IconButton size="sm" data-list-action data-testid="thread-row-action" label={t('sidebar.restoreNamed', { name: displayThreadTitle(thread.title) })} title={t('sidebar.restoreConversation')} disabled={restoringId !== null}
                icon={restoringId === thread.id ? <Spinner size="sm" decorative /> : <ArchiveRestore size={14} aria-hidden="true" />} onClick={() => void restoreArchived(thread)} />} />
          </div>)}</div>}
        </section>}
        {actionError && <ErrorState compact title={actionError} />}
        {/* Moves and deletes are said here, politely, as they happen. */}
        <p className="sr-only" role="status" aria-live="polite" data-testid="thread-sections-announcer">{sections.announcement}</p>
        {sections.error && <Notice intent="danger" actions={<Button size="sm" variant="ghost" onClick={sections.clearError}>{t('common.close')}</Button>}>{sections.error}</Notice>}
        {!loading && !coldSkeleton && !groups.length && <EmptyState compact title={query || stateFilter ? t('sidebar.noMatches') : hiddenProjects.length ? t('sidebar.restoreOrAdd') : t('sidebar.addToStart')}
          actions={!query && !stateFilter && onAddProject ? <Button size="sm" variant="secondary" icon={<FolderPlus size={12} aria-hidden="true" />} onClick={onAddProject}>{t('sidebar.addProject')}</Button> : undefined} />}
        {hiddenProjects.length > 0 && <section data-ui="thread-hidden-section" aria-label={t('sidebar.removedProjects')}>
          <SidebarSection label={t('sidebar.removedProjects')} />
          {hiddenProjects.map(id => {
            const project = projects.find(item => item.projectId === id)
            if (!project) return null
            return <Button key={id} variant="ghost" size="sm" data-list-item className={cx('thread-restore-project', styles.restore)} title={project.identityLabel} icon={<ArchiveRestore size={14} aria-hidden="true" />} onClick={() => void useThreadStore.getState().restoreProject(id)}><span>{project.displayName}</span>{' '}<small>{t('sidebar.restore')}</small></Button>
          })}
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
        if (confirmation.kind === 'project') { setConfirmation(null); void useThreadStore.getState().hideProject(confirmation.id); return }
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
