import { useCallback, useMemo, useRef, useState } from 'react'
import { ConfirmDialog, cx } from '../../ui'
import styles from './ThreadSidebar.module.css'
import { useThreadContentSearch } from '../../hooks/useThreadContentSearch'
import { AlignJustify, Archive, ArchiveRestore, Check, ChevronDown, Circle, CircleAlert, CircleCheck, CircleX, Columns2, PanelsTopLeft, FolderPlus, Loader2, MoreHorizontal, Pencil, Pin, Plus, Settings2, Square, Trash2, X, UserRound } from 'lucide-react'
import type { ConversationThread } from '../../../shared/types/thread'
import { DropdownMenu } from 'radix-ui'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { NavigationRail } from '../Navigation/NavigationChrome'
import { useNavigationSearch } from '../Navigation/useNavigationSearch'
import { SearchField } from '../Navigation/SearchField'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { AgentProviderIcon } from '../Sidebar/AgentProviderIcon'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_RESIZE_STEP, useNavigationPrefs } from '../../store/navigation-prefs.store'
import { threadNavigationStatus } from './threadNavigationStatus'
import { ThreadProjectSettingsDialog } from './ThreadProjectSettingsDialog'

/** Threads shown per project before "Show more" (a search or the selected thread always shows). */
const THREAD_ROWS_PER_PROJECT = 8

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}
export function ThreadSidebar({ onCreate, onModeChange, onSelectMode, onAccounts, onAddProject, onOpenInCode }: {
  onCreate: (projectId: string, rootPath?: string) => void; onModeChange?: () => void; onSelectMode?: (mode: 'code' | 'thread' | 'data') => void; onAccounts?: () => void; onAddProject?: () => void; onOpenInCode?: (rootPath: string) => Promise<void>
}) {
  const { threads, projects, unavailableProjects, selectedId, secondaryId, expanded, errors, loading, select, openSecondary, toggle, hiddenProjects, unreadIds, markRead, markUnread } = useThreadStore()
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
    return [...catalog.values()].map(g => ({ ...g, threads: g.threads.filter(t => !t.pinned && (`${g.name} ${t.title} ${t.provider} ${t.rootPath}`.toLowerCase().includes(query.toLowerCase()) || contentHit(t))).sort((a, b) => b.updatedAt - a.updatedAt) }))
      .filter(g => !hiddenProjects.includes(g.id) && (!query || g.threads.length || g.name.toLowerCase().includes(query.toLowerCase())))
      .sort((a, b) => (b.threads[0]?.updatedAt ?? 0) - (a.threads[0]?.updatedAt ?? 0) || a.name.localeCompare(b.name))
  }, [projects, threads, query, hiddenProjects, contentHit])
  const archived = useMemo(() => threads.filter(thread => thread.archived && !hiddenProjects.includes(thread.projectId)
    && (`${thread.title} ${thread.provider} ${thread.rootPath} ${projects.find(project => project.projectId === thread.projectId)?.displayName ?? ''}`.toLowerCase().includes(query.toLowerCase()) || contentHit(thread)))
    .sort((a, b) => b.updatedAt - a.updatedAt), [threads, projects, hiddenProjects, query, contentHit])
  const restoreArchived = async (thread: ConversationThread) => {
    if (!window.oxe.thread?.command) { setActionError('Restart the updated application to restore conversations.'); return }
    setActionError(''); setRestoringId(thread.id)
    try {
      await window.oxe.thread.command(thread.id, `/resume ${thread.id}`)
      const snapshot = await window.oxe.thread.read(thread.id)
      if (snapshot.thread.archived) throw Error('The conversation could not be restored.')
      useThreadStore.getState().adopt(snapshot)
      setShowArchived(false)
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not restore conversation.') }
    finally { setRestoringId(null) }
  }
  const row = (thread: ConversationThread) => {
    const status = threadNavigationStatus(thread), unread = unreadIds.includes(thread.id)
    return <div key={thread.id} className={cx('thread-navigation-row', styles.row, unread && cx('is-unread', styles.unread))}><button type="button" className={cx('thread-navigation-item', styles.item)} aria-current={selectedId === thread.id ? 'page' : undefined}
    title={`${thread.title}\n${thread.provider} · ${status.label}${unread ? ' · Unread' : ''}\n${thread.rootPath}`} onClick={() => void select(thread.id)}>
    {unread && <span className={cx('thread-unread-marker', styles.unreadMark)} aria-label="Unread conversation" />}
    <span className={cx('thread-session-indicator', styles.indicator)} data-status={status.kind} aria-hidden="true">{status.kind === 'ready' ? <Circle size={12} /> : status.kind === 'completed' ? <CircleCheck size={12} /> : status.kind === 'attention' ? <CircleAlert size={12} /> : status.kind === 'failed' ? <CircleX size={12} /> : status.kind === 'interrupted' ? <Square size={11} /> : null}</span>
    <span className={cx('thread-session-content', styles.content)}><span className={cx('thread-session-title', styles.title)}>{thread.title}</span><span className={cx('thread-session-meta', styles.meta)}><span className={cx('thread-session-provider', styles.provider)}><AgentProviderIcon provider={thread.provider} size={density === 'compact' ? 12 : 14} /><span>{thread.provider === 'claude' ? 'Claude Code' : 'Codex'}</span></span><span className={cx('thread-session-state', styles.state)} data-status={status.kind}>{status.label}</span>{thread.pinned && <Pin size={10} aria-label="Pinned" />}<small>{relativeTime(thread.updatedAt)}</small></span></span>
  </button><button type="button" className={cx('thread-row-action', styles.action)} aria-label={`Open ${thread.title} side by side`} title="Open side by side" disabled={secondaryId === thread.id} onClick={() => void openSecondary(thread.id).catch(error => setActionError(error instanceof Error ? error.message : 'Could not open conversation.'))}><Columns2 size={13} /></button><DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className={cx('thread-row-action', styles.action)} aria-label={`Actions for ${thread.title}`} title="Conversation actions"><MoreHorizontal size={13} /></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="thread-actions-dropdown" side="right" align="start" sideOffset={5} collisionPadding={8} aria-label={`Actions for ${thread.title}`}>
      <DropdownMenu.Item className="thread-action-item" disabled={secondaryId === thread.id} onSelect={() => void openSecondary(thread.id).catch(error => setActionError(error instanceof Error ? error.message : 'Could not open conversation.'))}><Columns2 size={14} />Open to the side</DropdownMenu.Item>
      <DropdownMenu.Item className="thread-action-item" disabled={thread.status === 'running' || thread.status === 'approval'} onSelect={() => { setActionError(''); setRenameTarget(thread); setRenameValue(thread.title) }}><Pencil size={14} />Rename conversation…</DropdownMenu.Item>
      <DropdownMenu.Item className="thread-action-item" onSelect={() => void (async () => { try { await window.oxe.thread!.pin(thread.id, !thread.pinned); await useThreadStore.getState().refresh(thread.id) } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not update pin.') } })()}><Pin size={14} />{thread.pinned ? 'Unpin conversation' : 'Pin conversation'}</DropdownMenu.Item>
      <DropdownMenu.Item className="thread-action-item" onSelect={() => unreadIds.includes(thread.id) ? markRead(thread.id) : markUnread(thread.id)}>{unreadIds.includes(thread.id) ? <Check size={14} /> : <Circle size={14} />}{unreadIds.includes(thread.id) ? 'Mark as read' : 'Mark as unread'}</DropdownMenu.Item>
      <DropdownMenu.Separator className="thread-actions-separator" />
      <DropdownMenu.Item className="thread-action-item" onSelect={() => { setActionError(''); setConfirmation({ kind: 'archive', id: thread.id, title: thread.title }) }}><Archive size={14} />Archive conversation</DropdownMenu.Item>
      <DropdownMenu.Item className="thread-action-item is-destructive" onSelect={() => { setActionError(''); setConfirmation({ kind: 'thread', id: thread.id, title: thread.title }) }}><Trash2 size={14} />Delete conversation</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root></div>
  }
  return <aside className={`thread-navigation${collapsed ? ' thread-navigation-collapsed' : ''}`} data-density={density} aria-label="Thread sidebar">
    {!collapsed && <div className="thread-resize" role="separator" tabIndex={0} aria-label="Thread sidebar width" aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={width}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -SIDEBAR_RESIZE_STEP : SIDEBAR_RESIZE_STEP)) } }}
      onPointerDown={e => { resizing.current = true; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() }}
      onPointerMove={e => { if (resizing.current) setWidth(e.clientX - (e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0)) }}
      onPointerUp={() => { resizing.current = false }} onPointerCancel={() => { resizing.current = false }} onLostPointerCapture={() => { resizing.current = false }} />}
    <NavigationRail mode="thread" collapsed={collapsed} onModeChange={onModeChange} onSelectMode={onSelectMode} onToggle={toggleCollapse}
      primary={[{ id: 'add-project', label: 'Add project', icon: FolderPlus, onClick: onAddProject }]}
      context={{ id: 'accounts', label: 'Accounts', ariaLabel: 'Agent accounts', icon: UserRound, onClick: onAccounts }} />
    {!collapsed && <div className="nav-panel">
      <div className="nav-panel-title"><strong>Conversations</strong></div>
      <div className={cx('thread-nav-actions', styles.search)}>
        <SearchField className="thread-nav-search" ref={search} label="Filter threads" placeholder="Filter threads" value={query} onChange={setQuery} shortcut="/" />
      </div>
      <nav className={cx('thread-project-list', styles.list)} aria-label="Thread projects">
        {loading && !threads.length && <p className={cx('thread-nav-empty', styles.empty)} role="status">Loading conversations…</p>}
        {Object.entries(errors).map(([id, error]) => <div key={id} className={cx('thread-catalog-error', styles.error)} role="alert"><p>{error}</p><button type="button" onClick={() => { void useThreadStore.getState().load(); void useThreadStore.getState().loadProjects() }}>Retry</button></div>)}
        {threads.some(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')) && <section><h2> Pinned</h2>{threads.filter(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')).map(row)}</section>}
        {!!groups.length && <div className={cx('thread-list-heading', styles.listHeading)}><h2>Projects</h2><button type="button" aria-label="Compact thread list" title={density === 'compact' ? 'Use comfortable spacing' : 'Use compact spacing'} aria-pressed={density === 'compact'} onClick={() => setDensity(density === 'compact' ? 'comfortable' : 'compact')}><AlignJustify size={14} aria-hidden="true" /></button></div>}
        {groups.map(group => <section key={group.id} className={cx('thread-project-group', styles.group, selected?.projectId === group.id && cx('is-active', styles.active))}>
          <div className={cx('thread-project-heading', styles.heading)}>
          <button type="button" className={cx('thread-project-toggle', styles.toggle)} title={group.path} aria-expanded={query ? true : expanded[group.id] ?? true} onClick={() => toggle(group.id)}><ChevronDown size={12} /><span className={cx('thread-project-name', styles.name)}>{group.name}</span>{unavailableProjects.includes(group.id) && <small>Directory missing</small>}{groups.filter(g => g.name === group.name).length > 1 && <small>{group.path.split(/[\\/]/).slice(-2).join('/')}</small>}</button>
          <button type="button" className={cx('thread-row-action', styles.action)} aria-label={`New thread in ${group.name}`} title="New thread in this project" disabled={!group.rootPath || unavailableProjects.includes(group.id)} onClick={() => onCreate(group.id, group.rootPath)}><Plus size={14} /></button>
          <button type="button" className={cx('thread-row-action', styles.action)} aria-label={`Settings for ${group.name}`} title="Thread project settings" onClick={() => setProjectSettingsId(group.id)}><Settings2 size={13} /></button>
          {group.rootPath && <button type="button" className={cx('thread-row-action', styles.action)} aria-label={`Open ${group.name} in Code`} title="Open this directory in Code" disabled={unavailableProjects.includes(group.id)} onClick={() => void onOpenInCode?.(group.rootPath!).catch(error => setActionError(error instanceof Error ? error.message : 'Could not open project in Code.'))}><PanelsTopLeft size={13} /></button>}
          <button type="button" className={cx('thread-row-action', styles.action)} aria-label={`Remove project ${group.name}`} title="Remove project from Thread sidebar" onClick={() => { setActionError(''); setConfirmation({ kind: 'project', id: group.id, title: group.name }) }}><X size={13} /></button>
          </div>
          {(query || (expanded[group.id] ?? true)) && <div className={cx('thread-project-children', styles.children)}><div className={cx('thread-project-rows', styles.rows)}>{(() => {
            const limit = query || expandedProjects.includes(group.id) ? Infinity : THREAD_ROWS_PER_PROJECT
            const visible = group.threads.filter((thread, index) => index < limit || thread.id === selectedId)
            return <>{visible.map(row)}{group.threads.length > visible.length && <button type="button" className={cx('thread-show-more', styles.showMore)} onClick={() => setExpandedProjects(value => [...value, group.id])}>Show {group.threads.length - visible.length} more</button>}</>
          })()}</div></div>}
        </section>)}
        {archived.length > 0 && <section className={cx('thread-archived-section', styles.section)} aria-label="Archived conversations">
          <button type="button" className={cx('thread-project-toggle', styles.toggle)} aria-expanded={query ? true : showArchived} onClick={() => setShowArchived(value => !value)}><ChevronDown size={12} /><span>Archived</span><small>{archived.length}</small></button>
          {(query || showArchived) && archived.map(thread => <div key={thread.id} className={cx('thread-navigation-row thread-archived-row', styles.row, styles.archivedRow)}>
            <button type="button" className={cx('thread-navigation-item', styles.item)} disabled={restoringId !== null} title={`${thread.title}\n${thread.provider} · ${thread.rootPath}`} onClick={() => void restoreArchived(thread)}><span>{thread.title}</span><small>{relativeTime(thread.updatedAt)}</small></button>
            <button type="button" className={cx('thread-row-action', styles.action)} aria-label={`Restore ${thread.title}`} title="Restore conversation" disabled={restoringId !== null} onClick={() => void restoreArchived(thread)}>{restoringId === thread.id ? <Loader2 size={13} className="thread-spin" /> : <ArchiveRestore size={13} />}</button>
          </div>)}
        </section>}
        {actionError && <p className={cx('thread-catalog-error', styles.error)} role="alert">{actionError}</p>}
        {!loading && !groups.length && <p className={cx('thread-nav-empty', styles.empty)}>{query ? 'No conversations found.' : hiddenProjects.length ? 'Restore a project below or add another folder.' : 'Add a project to start a conversation.'}</p>}
        {hiddenProjects.length > 0 && <section className={cx('thread-hidden-section', styles.section)} aria-label="Removed projects">
          <h2>Removed projects</h2>
          {hiddenProjects.map(id => {
            const project = projects.find(item => item.projectId === id)
            if (!project) return null
            return <button key={id} type="button" className={cx('thread-restore-project', styles.restore)} title={project.identityLabel} onClick={() => void useThreadStore.getState().restoreProject(id).catch(error => setActionError(error instanceof Error ? error.message : 'Could not restore project.'))}><ArchiveRestore size={13} aria-hidden="true" /><span>{project.displayName}</span><small>Restore</small></button>
          })}
        </section>}
      </nav>
    </div>}
    {projectSettingsId && projects.find(project => project.projectId === projectSettingsId) &&
      <ThreadProjectSettingsDialog project={projects.find(project => project.projectId === projectSettingsId)!} unavailable={unavailableProjects.includes(projectSettingsId)} onClose={() => setProjectSettingsId(null)} />}
    {renameTarget && <DesktopDialog className="thread-create-dialog" title="Rename conversation" description="The new name appears in the session list and conversation header." onClose={() => { if (!acting) setRenameTarget(null) }}>
      <form onSubmit={event => { event.preventDefault(); const title = renameValue.trim(); if (!title || !window.oxe.thread?.command) return
        setActing(true); setActionError('')
        void window.oxe.thread.command(renameTarget.id, `/rename ${title}`).then(async () => { await useThreadStore.getState().refresh(renameTarget.id); setRenameTarget(null) }).catch(error => setActionError(error instanceof Error ? error.message : 'Could not rename conversation.')).finally(() => setActing(false))
      }}>
        <label>Conversation name<input aria-label="Conversation name" autoFocus maxLength={120} value={renameValue} onChange={event => setRenameValue(event.target.value)} /></label>
        {actionError && <p role="alert">{actionError}</p>}
        <footer><button type="button" disabled={acting} onClick={() => setRenameTarget(null)}>Cancel</button><button type="submit" className="thread-primary" disabled={acting || !renameValue.trim() || renameValue.trim() === renameTarget.title}>{acting ? 'Renaming…' : 'Rename conversation'}</button></footer>
      </form>
    </DesktopDialog>}
    {confirmation && <ConfirmDialog
      title={confirmation.kind === 'thread' ? 'Delete thread' : confirmation.kind === 'archive' ? 'Archive conversation' : 'Remove project'}
      description={confirmation.kind === 'thread' ? `Delete “${confirmation.title}” from OXESpace? An active turn will stop. The provider session and project files are kept.` : confirmation.kind === 'archive' ? `Archive “${confirmation.title}”? An active turn will stop. You can restore it from Archived in this sidebar.` : `Remove “${confirmation.title}” from the Thread sidebar? Its conversations, files and Code workspaces remain. Restore this project individually from Removed projects or add its folder again.`}
      confirmLabel={acting ? 'Please wait…' : confirmation.kind === 'thread' ? 'Delete thread' : confirmation.kind === 'archive' ? 'Archive conversation' : 'Remove project'}
      danger={confirmation.kind !== 'archive'}
      busy={acting}
      error={actionError}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => {
        setActing(true); setActionError('')
        void (async () => {
          try {
            if (confirmation.kind === 'project') await useThreadStore.getState().hideProject(confirmation.id)
            else {
              if (!window.oxe.thread?.command) throw Error('Restart the updated application to delete threads.')
              await window.oxe.thread.command(confirmation.id, confirmation.kind === 'archive' ? '/archive confirm' : '/delete confirm')
              await useThreadStore.getState().load()
              if (confirmation.kind === 'archive') setShowArchived(true)
            }
            setConfirmation(null)
          } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not complete the action.') }
          finally { setActing(false) }
        })()
      }} />}
  </aside>
}
