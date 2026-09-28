import { useMemo, useRef, useState } from 'react'
import { AlertCircle, Archive, ArchiveRestore, Check, ChevronDown, Circle, Columns2, GitBranch, PanelsTopLeft, FolderPlus, Loader2, MoreHorizontal, Pencil, Pin, Plus, Trash2, X, UserRound } from 'lucide-react'
import type { Workspace } from '../../../shared/types/workspace'
import type { ConversationThread } from '../../../shared/types/thread'
import { DropdownMenu } from 'radix-ui'
import { useThreadStore } from '../../store/thread.store'
import { useUIStore } from '../../store/ui.store'
import { useGitBranch } from '../../hooks/useGitBranch'
import { NavigationBrand, NavigationFooter } from '../Navigation/NavigationChrome'
import { useNavigationSearch } from '../Navigation/useNavigationSearch'
import { SearchField } from '../Navigation/SearchField'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_RESIZE_STEP, useNavigationPrefs } from '../../store/navigation-prefs.store'

function relativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}
function ProjectBranch({ workspaceId, rootPath }: { workspaceId?: string; rootPath?: string }) {
  const status = useGitBranch(workspaceId ?? '', workspaceId && rootPath ? rootPath : null)
  const label = status?.branch || (status?.detached && status.shortSha ? `Detached · ${status.shortSha}` : status ? 'Branch unavailable' : 'Loading branch…')
  return <span className="thread-project-branch" title={`${rootPath ?? ''}\n${status?.error || label}`}><GitBranch size={11} aria-hidden="true" /><span>{label}</span></span>
}
export function ThreadSidebar({ workspaces, onCreate, onModeChange, onAccounts, onAddProject }: {
  workspaces: Workspace[]; onCreate: (workspaceId: string, rootPath?: string) => void; onModeChange?: () => void; onAccounts?: () => void; onAddProject?: () => void
}) {
  const { threads, projects, selectedId, secondaryId, expanded, errors, loading, select, openSecondary, toggle, hiddenProjects, unreadIds, markRead, markUnread } = useThreadStore()
  const [confirmation, setConfirmation] = useState<{ kind: 'thread' | 'archive' | 'project'; id: string; title: string } | null>(null)
  const [actionError, setActionError] = useState(''), [acting, setActing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<ConversationThread | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const width = useNavigationPrefs(s => s.width), setWidth = useNavigationPrefs(s => s.setWidth)
  const collapsed = useUIStore(s => s.isSidebarCollapsed), toggleCollapse = useUIStore(s => s.toggleSidebar)
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const resizing = useRef(false)
  useNavigationSearch(search, collapsed, toggleCollapse)
  const selected = threads.find(t => t.id === selectedId)
  const matches = (thread: ConversationThread, name: string) => !thread.archived && !hiddenProjects.includes(thread.projectId) && `${name} ${thread.title} ${thread.provider} ${thread.rootPath}`.toLowerCase().includes(query.toLowerCase())
  const groups = useMemo(() => {
    const catalog = new Map(projects.map(p => [p.projectId, { id: p.projectId, name: p.displayName, path: p.identityLabel, workspaceId: p.contexts[0]?.workspaceId, rootPath: p.contexts[0]?.rootPath, threads: [] as ConversationThread[] }]))
    for (const thread of threads) {
      if (thread.archived) continue
      const ws = workspaces.find(w => w.id === thread.workspaceId)
      if (!ws) continue
      const group = catalog.get(thread.projectId) ?? { id: thread.projectId, name: ws.name, path: ws.rootPath, workspaceId: ws.id, rootPath: thread.rootPath, threads: [] }
      group.threads.push(thread); catalog.set(thread.projectId, group)
    }
    return [...catalog.values()].map(g => ({ ...g, threads: g.threads.filter(t => !t.pinned && `${g.name} ${t.title} ${t.provider} ${t.rootPath}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt) }))
      .filter(g => !hiddenProjects.includes(g.id) && (!query || g.threads.length || g.name.toLowerCase().includes(query.toLowerCase())))
      .sort((a, b) => (b.threads[0]?.updatedAt ?? 0) - (a.threads[0]?.updatedAt ?? 0) || a.name.localeCompare(b.name))
  }, [projects, threads, workspaces, query, hiddenProjects])
  const archived = useMemo(() => threads.filter(thread => thread.archived && !hiddenProjects.includes(thread.projectId)
    && `${thread.title} ${thread.provider} ${thread.rootPath} ${projects.find(project => project.projectId === thread.projectId)?.displayName ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [threads, projects, hiddenProjects, query])
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
  const row = (thread: ConversationThread) => <div key={thread.id} className="thread-navigation-row"><button type="button" className="thread-navigation-item" aria-current={selectedId === thread.id ? 'page' : undefined}
    title={`${thread.title}\n${thread.provider} · ${thread.status}\n${thread.rootPath}`} onClick={() => void select(thread.id)}>
    <span className={`thread-session-dot thread-session-${thread.status}${unreadIds.includes(thread.id) ? ' is-unread' : ''}`} aria-label={unreadIds.includes(thread.id) ? 'Unread conversation' : thread.status === 'running' ? 'Running' : thread.status === 'failed' ? 'Failed' : thread.status === 'approval' ? 'Needs approval' : undefined} />
    <span className="thread-session-content"><span className="thread-session-title">{thread.title}</span><span className="thread-session-meta"><span>{thread.provider === 'claude' ? 'Claude Code' : 'Codex'}</span>{thread.pinned && <Pin size={10} aria-label="Pinned" />}{thread.status === 'running' && <Loader2 size={11} className="thread-spin" aria-hidden="true" />}{(thread.status === 'failed' || thread.status === 'approval') && <AlertCircle size={11} aria-hidden="true" />}<small>{relativeTime(thread.updatedAt)}</small></span></span>
  </button><button type="button" className="thread-row-action" aria-label={`Open ${thread.title} side by side`} title="Open side by side" disabled={secondaryId === thread.id} onClick={() => void openSecondary(thread.id).catch(error => setActionError(error instanceof Error ? error.message : 'Could not open conversation.'))}><Columns2 size={13} /></button><DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><button type="button" className="thread-row-action" aria-label={`Actions for ${thread.title}`} title="Conversation actions"><MoreHorizontal size={13} /></button></DropdownMenu.Trigger>
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
  return <aside className={`thread-navigation${collapsed ? ' thread-navigation-collapsed' : ''}`} aria-label="Thread sidebar">
    {!collapsed && <div className="thread-resize" role="separator" tabIndex={0} aria-label="Thread sidebar width" aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={width}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -SIDEBAR_RESIZE_STEP : SIDEBAR_RESIZE_STEP)) } }}
      onPointerDown={e => { resizing.current = true; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() }}
      onPointerMove={e => { if (resizing.current) setWidth(e.clientX - (e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0)) }}
      onPointerUp={() => { resizing.current = false }} onPointerCancel={() => { resizing.current = false }} onLostPointerCapture={() => { resizing.current = false }} />}
    <NavigationBrand collapsed={collapsed} mode="thread" onModeChange={onModeChange} />
    {collapsed && <nav className="sidebar-mode-rail" aria-label="Application view"><button type="button" aria-label="Code" title="Switch to Code" onClick={onModeChange}><PanelsTopLeft size={16} /></button></nav>}
    {collapsed ? <nav className="thread-nav-rail" aria-label="Collapsed threads"><button type="button" aria-label="Add project" title="Add project" onClick={onAddProject}><FolderPlus size={16} /></button></nav> : <>
      <div className="thread-nav-actions"><button type="button" className="thread-new-action" aria-label="Add project" onClick={onAddProject}><FolderPlus size={16} /><span>Add project</span></button>
        <SearchField className="thread-nav-search" ref={search} label="Filter threads" placeholder="Filter threads" value={query} onChange={setQuery} shortcut="/" />
      </div>
      <nav className="thread-project-list" aria-label="Thread projects">
        {loading && !threads.length && <p className="thread-nav-empty" role="status">Loading conversations…</p>}
        {Object.entries(errors).map(([id, error]) => <div key={id} className="thread-catalog-error" role="alert"><p>{error}</p><button type="button" onClick={() => { void useThreadStore.getState().load(workspaces.map(w => w.id)); void useThreadStore.getState().loadProjects() }}>Retry</button></div>)}
        {threads.some(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')) && <section><h2> Pinned</h2>{threads.filter(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')).map(row)}</section>}
        {!!groups.length && <h2>Projects</h2>}
        {groups.map(group => <section key={group.id} className={`thread-project-group${selected?.projectId === group.id ? ' is-active' : ''}`}>
          <div className="thread-project-heading">
          <button type="button" className="thread-project-toggle" title={group.path} aria-expanded={query ? true : expanded[group.id] ?? true} onClick={() => toggle(group.id)}><ChevronDown size={12} /><span className="thread-project-name">{group.name}</span>{groups.filter(g => g.name === group.name).length > 1 && <small>{group.path.split(/[\\/]/).slice(-2).join('/')}</small>}</button>
          <button type="button" className="thread-row-action" aria-label={`New thread in ${group.name}`} title="New thread in this project" disabled={!group.workspaceId} onClick={() => { if (group.workspaceId) onCreate(group.workspaceId, group.rootPath) }}><Plus size={14} /></button>
          <button type="button" className="thread-row-action" aria-label={`Remove project ${group.name}`} title="Remove project from Thread sidebar" onClick={() => { setActionError(''); setConfirmation({ kind: 'project', id: group.id, title: group.name }) }}><X size={13} /></button>
          </div>
          <ProjectBranch workspaceId={selected?.projectId === group.id ? selected.workspaceId : group.workspaceId} rootPath={selected?.projectId === group.id ? selected.rootPath : group.rootPath} />
          {(query || (expanded[group.id] ?? true)) && <div className="thread-project-children"><div className="thread-project-count">{group.threads.length} {group.threads.length === 1 ? 'thread' : 'threads'}</div><div className="thread-project-rows">{group.threads.map(row)}</div></div>}
        </section>)}
        {archived.length > 0 && <section className="thread-archived-section" aria-label="Archived conversations">
          <button type="button" className="thread-project-toggle" aria-expanded={query ? true : showArchived} onClick={() => setShowArchived(value => !value)}><ChevronDown size={12} /><span>Archived</span><small>{archived.length}</small></button>
          {(query || showArchived) && archived.map(thread => <div key={thread.id} className="thread-navigation-row thread-archived-row">
            <button type="button" className="thread-navigation-item" disabled={restoringId !== null} title={`${thread.title}\n${thread.provider} · ${thread.rootPath}`} onClick={() => void restoreArchived(thread)}><span>{thread.title}</span><small>{relativeTime(thread.updatedAt)}</small></button>
            <button type="button" className="thread-row-action" aria-label={`Restore ${thread.title}`} title="Restore conversation" disabled={restoringId !== null} onClick={() => void restoreArchived(thread)}>{restoringId === thread.id ? <Loader2 size={13} className="thread-spin" /> : <ArchiveRestore size={13} />}</button>
          </div>)}
        </section>}
        {actionError && <p className="thread-catalog-error" role="alert">{actionError}</p>}
        {!loading && !groups.length && <p className="thread-nav-empty">{query ? 'No conversations found.' : 'Add a project to start a conversation.'}</p>}
        {hiddenProjects.length > 0 && <button type="button" className="thread-add-project" onClick={() => useThreadStore.getState().restoreProjects()}>Restore hidden projects ({hiddenProjects.length})</button>}
      </nav>
    </>}
    <NavigationFooter className="thread-nav-footer" collapsed={collapsed} context={{ label: 'Accounts', ariaLabel: 'Agent accounts', icon: UserRound, onClick: onAccounts }} onToggle={toggleCollapse} />
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
    {confirmation && <DesktopDialog className="thread-create-dialog" title={confirmation.kind === 'thread' ? 'Delete thread' : confirmation.kind === 'archive' ? 'Archive conversation' : 'Remove project'} description={confirmation.kind === 'thread' ? `Delete “${confirmation.title}” from OXESpace? An active turn will stop. The provider session and project files are kept.` : confirmation.kind === 'archive' ? `Archive “${confirmation.title}”? An active turn will stop. You can restore it from Archived in this sidebar.` : `Hide “${confirmation.title}” from the Thread sidebar? Conversations, files and Code workspaces are kept. You can restore it later.`} onClose={() => { if (!acting) setConfirmation(null) }}>
      {actionError && <p role="alert">{actionError}</p>}
      <footer><button type="button" disabled={acting} onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className="thread-primary" disabled={acting} onClick={() => {
        setActing(true); setActionError('')
        void (async () => {
          try {
            if (confirmation.kind === 'project') await useThreadStore.getState().hideProject(confirmation.id)
            else {
              if (!window.oxe.thread?.command) throw Error('Restart the updated application to delete threads.')
              await window.oxe.thread.command(confirmation.id, confirmation.kind === 'archive' ? '/archive confirm' : '/delete confirm')
              await useThreadStore.getState().load(workspaces.map(workspace => workspace.id))
              if (confirmation.kind === 'archive') setShowArchived(true)
            }
            setConfirmation(null)
          } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not complete the action.') }
          finally { setActing(false) }
        })()
      }}>{acting ? 'Please wait…' : confirmation.kind === 'thread' ? 'Delete thread' : confirmation.kind === 'archive' ? 'Archive conversation' : 'Remove project'}</button></footer>
    </DesktopDialog>}
  </aside>
}
