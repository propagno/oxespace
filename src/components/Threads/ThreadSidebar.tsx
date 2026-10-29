import { useShallow } from 'zustand/react/shallow'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorState, LoadingState, Menu, Spinner, cx, TextField } from '../../ui'
import styles from './ThreadSidebar.module.css'
import { useThreadContentSearch } from '../../hooks/useThreadContentSearch'
import { AlignJustify, Archive, ArchiveRestore, Check, ChevronDown, Circle, CircleAlert, CircleCheck, CircleX, Columns2, FolderPlus, MoreHorizontal, Pencil, Pin, Plus, Square, Trash2, UserRound } from 'lucide-react'
import type { ConversationThread } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { NavigationRail, SidebarActions, SidebarFooter, type RailAction } from '../Navigation/NavigationChrome'
import { useNavigationSearch } from '../Navigation/useNavigationSearch'
import { SearchField } from '../Navigation/SearchField'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_RESIZE_STEP, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { threadNavigationStatus } from './threadNavigationStatus'
import { threadConfirmation } from '../../../shared/threadConfirmations'
import { threadConfirmationText } from './threadConfirmationText'
import { ThreadProjectSettingsDialog } from './ThreadProjectSettingsDialog'
import { humanizeError } from '../../utils/humanizeError'

/** Threads shown per project before "Show more" (a search or the selected thread always shows). */
const THREAD_ROWS_PER_PROJECT = 8

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  const t = i18n.t.bind(i18n)
  return minutes < 1 ? t('thread:sidebar.age.now') : minutes < 60 ? t('thread:sidebar.age.minutes', { count: minutes }) : minutes < 1440 ? t('thread:sidebar.age.hours', { count: Math.floor(minutes / 60) }) : t('thread:sidebar.age.days', { count: Math.floor(minutes / 1440) })
}
export function ThreadSidebar({ onCreate, onAccounts, onAddProject, onOpenInCode }: {
  onCreate: (projectId: string, rootPath?: string) => void; onAccounts?: () => void; onAddProject?: () => void; onOpenInCode?: (rootPath: string) => Promise<void>
}) {
  const { t } = useTranslation('thread')
  // Only these fields: the store also changes for drafts, snapshots and scroll positions, which the list never shows.
  const { threads, projects, unavailableProjects, selectedId, secondaryId, expanded, errors, loading, select, openSecondary, toggle, hiddenProjects, unreadIds, markRead, markUnread } = useThreadStore(useShallow(state => ({
    threads: state.threads, projects: state.projects, unavailableProjects: state.unavailableProjects, selectedId: state.selectedId, secondaryId: state.secondaryId, expanded: state.expanded, errors: state.errors, loading: state.loading,
    select: state.select, openSecondary: state.openSecondary, toggle: state.toggle, hiddenProjects: state.hiddenProjects, unreadIds: state.unreadIds, markRead: state.markRead, markUnread: state.markUnread })))
  const sideBySideBlocked = (id: string): boolean => id === selectedId || id === secondaryId
  const [confirmation, setConfirmation] = useState<{ kind: 'thread' | 'archive' | 'project'; id: string; title: string } | null>(null)
  const [actionError, setActionError] = useState(''), [acting, setActing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<string[]>([])
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<ConversationThread | null>(null)
  const [projectSettingsId, setProjectSettingsId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const width = useNavigationPrefs(s => s.width), setWidth = useNavigationPrefs(s => s.setWidth)
  const density = useNavigationPrefs(s => s.threadDensity), setDensity = useNavigationPrefs(s => s.setThreadDensity)
  const collapsed = useUIStore(s => s.isSidebarCollapsed), toggleCollapse = useUIStore(s => s.toggleSidebar)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const resizing = useRef(false)
  useNavigationSearch(search, collapsed, toggleCollapse)
  const selected = threads.find(t => t.id === selectedId)
  // Also matches by conversation content (native transcript index), not just title/path.
  const contentIds = useThreadContentSearch(query)
  const contentHit = useCallback((thread: ConversationThread) => !!thread.nativeSessionId && contentIds.has(thread.nativeSessionId), [contentIds])
  const matches = (thread: ConversationThread, name: string) => !thread.archived && !hiddenProjects.includes(thread.projectId) && (`${name} ${thread.title} ${thread.provider} ${thread.rootPath}`.toLowerCase().includes(query.toLowerCase()) || contentHit(thread))
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
    return [...catalog.values()].map(g => ({ ...g, threads: g.threads.filter(t => !t.pinned && (`${g.name} ${t.title} ${t.provider} ${t.rootPath}`.toLowerCase().includes(query.toLowerCase()) || contentHit(t))).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)) }))
      .filter(g => !hiddenProjects.includes(g.id) && (!query || g.threads.length || g.name.toLowerCase().includes(query.toLowerCase())))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }, [projects, threads, query, hiddenProjects, contentHit])
  const archived = useMemo(() => threads.filter(thread => thread.archived && !hiddenProjects.includes(thread.projectId)
    && (`${thread.title} ${thread.provider} ${thread.rootPath} ${projects.find(project => project.projectId === thread.projectId)?.displayName ?? ''}`.toLowerCase().includes(query.toLowerCase()) || contentHit(thread)))
    .sort((a, b) => b.updatedAt - a.updatedAt), [threads, projects, hiddenProjects, query, contentHit])
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
    const status = threadNavigationStatus(thread), unread = unreadIds.includes(thread.id)
    return <div key={thread.id} className={cx('thread-navigation-row', styles.row, unread && cx('is-unread', styles.unread))}><button type="button" className={cx('thread-navigation-item', styles.item)} aria-current={selectedId === thread.id ? 'page' : undefined}
    title={`${thread.title}\n${thread.provider} · ${status.label}${unread ? ` · ${t('sidebar.unreadShort')}` : ''}\n${thread.rootPath}`} onClick={() => void select(thread.id)}>
    {unread && <span className={cx('thread-unread-marker', styles.unreadMark)} aria-label={t('sidebar.unread')} />}{unread && ' '}
    <span className={cx('thread-session-indicator', styles.indicator)} data-status={status.kind} aria-hidden="true">{status.kind === 'ready' ? <Circle size={12} /> : status.kind === 'completed' ? <CircleCheck size={12} /> : status.kind === 'attention' ? <CircleAlert size={12} /> : status.kind === 'failed' ? <CircleX size={12} /> : status.kind === 'interrupted' ? <Square size={12} /> : null}</span>
    <span className={cx('thread-session-content', styles.content)}><span className={cx('thread-session-title', styles.title)}>{thread.title}</span>{' '}<span className={cx('thread-session-meta', styles.meta)}><span className={cx('thread-session-provider', styles.provider)}><AgentProviderIcon provider={thread.provider} size={density === 'compact' ? 12 : 14} /><span>{thread.provider === 'claude' ? 'Claude Code' : 'Codex'}</span></span>{' '}<span className={cx('thread-session-state', styles.state)} data-status={status.kind}>{status.label}</span>{thread.pinned && <> <Pin size={12} aria-label={t('sidebar.pinned')} /></>}</span></span>{' '}
    {status.kind === 'attention' ? <small className={styles.needs}>{t('status.attention')}</small> : <small className={styles.time}>{relativeTime(thread.updatedAt)}</small>}
  </button><button type="button" className={cx('thread-row-action', styles.action)} aria-label={t('sidebar.openSideNamed', { name: thread.title })} title={sideBySideBlocked(thread.id) ? t('sidebar.alreadyOpen') : t('sidebar.openSide')} disabled={sideBySideBlocked(thread.id)} onClick={() => void openSecondary(thread.id).catch(error => setActionError(humanizeError(error, t('sidebar.openFailed'))))}><Columns2 size={14} /></button><Menu label={t('sidebar.actionsFor', { name: thread.title })} side="right" items={[
    { label: t('sidebar.openToSide'), icon: <Columns2 size={14} />, disabled: sideBySideBlocked(thread.id), onSelect: () => void openSecondary(thread.id).catch(error => setActionError(humanizeError(error, t('sidebar.openFailed')))) },
    { label: t('sidebar.renameMenu'), icon: <Pencil size={14} />, onSelect: () => { setActionError(''); setRenameTarget(thread); setRenameValue(thread.title) } },
    { label: thread.pinned ? t('sidebar.unpin') : t('sidebar.pin'), icon: <Pin size={14} />, onSelect: () => void useThreadStore.getState().pinThread(thread.id, !thread.pinned) },
    { label: unreadIds.includes(thread.id) ? t('sidebar.markRead') : t('sidebar.markUnread'), icon: unreadIds.includes(thread.id) ? <Check size={14} /> : <Circle size={14} />, onSelect: () => unreadIds.includes(thread.id) ? markRead(thread.id) : markUnread(thread.id) },
    { type: 'separator' },
    { label: t('confirm.archive.confirm'), icon: <Archive size={14} />, onSelect: () => { setActionError(''); setConfirmation({ kind: 'archive', id: thread.id, title: thread.title }) } },
    { label: t('confirm.delete.confirm'), icon: <Trash2 size={14} />, danger: true, onSelect: () => { setActionError(''); setConfirmation({ kind: 'thread', id: thread.id, title: thread.title }) } }
  ]} trigger={<button type="button" className={cx('thread-row-action', styles.action)} aria-label={t('sidebar.actionsFor', { name: thread.title })} title={t('sidebar.conversationActions')}><MoreHorizontal size={14} /></button>} /></div>
  }
  const railPrimary: RailAction[] = [{ id: 'add-project', label: t('sidebar.addProject'), icon: FolderPlus, onClick: onAddProject }]
  const railContext: RailAction = { id: 'accounts', label: t('sidebar.accounts'), ariaLabel: t('sidebar.agentAccounts'), icon: UserRound, onClick: onAccounts }
  return <aside className={`thread-navigation${collapsed ? ' thread-navigation-collapsed' : ''}`} data-density={density} aria-label={t('sidebar.region')}>
    {!collapsed && <div className="thread-resize" role="separator" tabIndex={0} aria-label={t('sidebar.width')} aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={width}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -SIDEBAR_RESIZE_STEP : SIDEBAR_RESIZE_STEP)) } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setWidth(e.key === 'Home' ? SIDEBAR_MIN_WIDTH : SIDEBAR_MAX_WIDTH) } }}
      onPointerDown={e => { resizing.current = true; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() }}
      onPointerMove={e => { if (resizing.current) setWidth(e.clientX - (e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0)) }}
      onPointerUp={() => { resizing.current = false }} onPointerCancel={() => { resizing.current = false }} onLostPointerCapture={() => { resizing.current = false }} />}
    {collapsed && <NavigationRail mode="thread" primary={railPrimary} context={railContext} onToggle={toggleCollapse} />}
    {!collapsed && <div className="nav-panel">
      <div className="nav-panel-title"><strong>{t('sidebar.conversations')}</strong><SidebarActions actions={railPrimary} /></div>
      <div className={cx('thread-nav-actions', styles.search)}>
        <SearchField className="thread-nav-search" ref={search} label={t('sidebar.filter')} placeholder={t('sidebar.filter')} value={query} onChange={setQuery} shortcut="/" />
      </div>
      <nav className={cx('thread-project-list', styles.list)} aria-label={t('sidebar.projectsRegion')}>
        {loading && !threads.length && <LoadingState label={t('sidebar.loading')} />}
        {Object.entries(errors).map(([id, error]) => <ErrorState key={id} compact title={error} retryLabel={t('common.tryAgain')} onRetry={() => { void useThreadStore.getState().load(); void useThreadStore.getState().loadProjects() }} />)}
        {threads.some(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')) && <section><h2>{t('sidebar.pinnedHeading')}</h2>{threads.filter(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).map(row)}</section>}
        {!!groups.length && <div className={cx('thread-list-heading', styles.listHeading)}><h2>{t('sidebar.projects')}</h2><button type="button" aria-label={t('sidebar.compact')} title={density === 'compact' ? t('sidebar.comfortableSpacing') : t('sidebar.compactSpacing')} aria-pressed={density === 'compact'} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}><AlignJustify size={14} aria-hidden="true" /></button></div>}
        {groups.map(group => <section key={group.id} className={cx('thread-project-group', styles.group, selected?.projectId === group.id && cx('is-active', styles.active))}>
          <div className={cx('thread-project-heading', styles.heading)}>
          <button type="button" className={cx('thread-project-toggle', styles.toggle)} title={group.path} aria-expanded={query ? true : expanded[group.id] ?? true} onClick={() => toggle(group.id)}><ChevronDown size={12} /><span className={cx('thread-project-name', styles.name)}>{group.name}</span>{unavailableProjects.includes(group.id) && <small>{t('sidebar.directoryMissing')}</small>}{groups.filter(g => g.name === group.name).length > 1 && <small>{group.path.split(/[\\/]/).slice(-2).join('/')}</small>}</button>
          <button type="button" className={cx('thread-row-action', styles.action)} aria-label={t('sidebar.newInNamed', { name: group.name })} title={t('sidebar.newIn')} disabled={!group.rootPath || unavailableProjects.includes(group.id)} onClick={() => onCreate(group.id, group.rootPath)}><Plus size={14} /></button>
          <Menu label={t('sidebar.projectActions', { name: group.name })} align="end"
            trigger={<button type="button" className={cx('thread-row-action', styles.action)} aria-label={t('sidebar.actionsFor', { name: group.name })} data-project-actions={group.id}><MoreHorizontal size={14} /></button>}
            items={[
              { label: t('sidebar.projectSettings'), onSelect: () => setProjectSettingsId(group.id) },
              ...(group.rootPath ? [{ label: t('sidebar.openInCode'), disabled: unavailableProjects.includes(group.id), onSelect: () => void onOpenInCode?.(group.rootPath!).catch(error => setActionError(humanizeError(error, t('sidebar.openInCodeFailed')))) }] : []),
              { type: 'separator' as const },
              { label: t('sidebar.removeProjectMenu'), danger: true, onSelect: () => { setActionError(''); setConfirmation({ kind: 'project', id: group.id, title: group.name }) } }
            ]} />
          </div>
          {(query || (expanded[group.id] ?? true)) && <div className={cx('thread-project-children', styles.children)}><div className={cx('thread-project-rows', styles.rows)}>{(() => {
            const limit = query || expandedProjects.includes(group.id) ? Infinity : THREAD_ROWS_PER_PROJECT
            const visible = group.threads.filter((thread, index) => index < limit || thread.id === selectedId)
            return <>{visible.map(row)}{group.threads.length > visible.length && <button type="button" className={cx('thread-show-more', styles.showMore)} onClick={() => setExpandedProjects(value => [...value, group.id])}>{t('sidebar.showMore', { count: group.threads.length - visible.length })}</button>}</>
          })()}</div></div>}
        </section>)}
        {archived.length > 0 && <section className={cx('thread-archived-section', styles.section)} aria-label={t('sidebar.archivedRegion')}>
          <button type="button" className={cx('thread-project-toggle', styles.toggle)} aria-expanded={query ? true : showArchived} onClick={() => setShowArchived(value => !value)}><ChevronDown size={12} /><span>{t('sidebar.archived')}</span>{' '}<small>{archived.length}</small></button>
          {(query || showArchived) && archived.map(thread => <div key={thread.id} className={cx('thread-navigation-row thread-archived-row', styles.row, styles.archivedRow)}>
            <button type="button" className={cx('thread-navigation-item', styles.item)} disabled={restoringId !== null} title={[thread.title, `${thread.provider} · ${thread.rootPath}`].join('\n')} onClick={() => void restoreArchived(thread)}><span>{thread.title}</span>{' '}<small>{relativeTime(thread.updatedAt)}</small></button>
            <button type="button" className={cx('thread-row-action', styles.action)} aria-label={t('sidebar.restoreNamed', { name: thread.title })} title={t('sidebar.restoreConversation')} disabled={restoringId !== null} onClick={() => void restoreArchived(thread)}>{restoringId === thread.id ? <Spinner size="sm" decorative /> : <ArchiveRestore size={14} />}</button>
          </div>)}
        </section>}
        {actionError && <ErrorState compact title={actionError} />}
        {!loading && !groups.length && <EmptyState compact title={query ? t('sidebar.noMatches') : hiddenProjects.length ? t('sidebar.restoreOrAdd') : t('sidebar.addToStart')} />}
        {hiddenProjects.length > 0 && <section className={cx('thread-hidden-section', styles.section)} aria-label={t('sidebar.removedProjects')}>
          <h2>{t('sidebar.removedProjects')}</h2>
          {hiddenProjects.map(id => {
            const project = projects.find(item => item.projectId === id)
            if (!project) return null
            return <button key={id} type="button" className={cx('thread-restore-project', styles.restore)} title={project.identityLabel} onClick={() => void useThreadStore.getState().restoreProject(id)}><ArchiveRestore size={14} aria-hidden="true" /><span>{project.displayName}</span>{' '}<small>{t('sidebar.restore')}</small></button>
          })}
        </section>}
      </nav>
      <SidebarFooter context={railContext} onToggle={toggleCollapse} />
    </div>}
    {projectSettingsId && projects.find(project => project.projectId === projectSettingsId) &&
      <ThreadProjectSettingsDialog project={projects.find(project => project.projectId === projectSettingsId)!} unavailable={unavailableProjects.includes(projectSettingsId)} onClose={() => setProjectSettingsId(null)} returnFocusTo={() => document.querySelector<HTMLElement>(`[data-project-actions="${projectSettingsId}"]`)} />}
    {renameTarget && <Dialog closeLabel={t('common.close')} className="thread-create-dialog" title={t('commandDialog.rename')} description={t('commandDialog.surface.rename')} onClose={() => { if (!acting) setRenameTarget(null) }}
      footer={<>
        <Button disabled={acting} onClick={() => setRenameTarget(null)}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="rename-thread-form" disabled={acting || !renameValue.trim() || renameValue.trim() === renameTarget.title}>{acting ? t('sidebar.renaming') : t('commandDialog.rename')}</Button>
      </>}>
      <form id="rename-thread-form" onSubmit={event => { event.preventDefault(); const title = renameValue.trim(); if (!title || !window.oxe.thread?.command) return
        // The new name shows at once; a failed save puts the old one back and says so in a toast.
        setRenameTarget(null); void useThreadStore.getState().renameThread(renameTarget.id, title)
      }}>
        <label>{t('sidebar.name')}<TextField aria-label={t('sidebar.name')} autoFocus maxLength={120} value={renameValue} onChange={event => setRenameValue(event.target.value)} /></label>
      </form>
    </Dialog>}
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
            await useThreadStore.getState().load()
            setConfirmation(null)
          } catch (error) { setActionError(humanizeError(error, t('errors.action'))) }
          finally { setActing(false) }
        })()
      }} />}
  </aside>
}
