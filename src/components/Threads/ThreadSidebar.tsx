import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, Columns2, GitBranch, PanelsTopLeft, FolderPlus, Loader2, MessageSquarePlus, Pin, Plus, RotateCcw, Trash2, Waypoints, X, UserRound } from 'lucide-react'
import type { Workspace } from '../../../shared/types/workspace'
import type { ConversationThread } from '../../../shared/types/thread'
import type { DelegationTask } from '../../../shared/types/delegation'
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
export function ThreadSidebar({ workspaces, onCreate, onModeChange, onAccounts, onAddProject, onDelegations }: {
  onDelegations?: () => void
  workspaces: Workspace[]; onCreate: (workspaceId: string, rootPath?: string) => void; onModeChange?: () => void; onAccounts?: () => void; onAddProject?: () => void
}) {
  const { threads, projects, selectedId, secondaryId, expanded, errors, loading, select, openSecondary, toggle, hiddenProjects } = useThreadStore()
  const [confirmation, setConfirmation] = useState<{ kind: 'thread' | 'project'; id: string; title: string } | null>(null)
  const [actionError, setActionError] = useState(''), [acting, setActing] = useState(false)
  const width = useNavigationPrefs(s => s.width), setWidth = useNavigationPrefs(s => s.setWidth)
  const collapsed = useUIStore(s => s.isSidebarCollapsed), toggleCollapse = useUIStore(s => s.toggleSidebar)
  const [query, setQuery] = useState('')
  const [delegations, setDelegations] = useState<DelegationTask[]>([])
  const [delegationError, setDelegationError] = useState('')
  const [delegationBusy, setDelegationBusy] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const resizing = useRef(false)
  useNavigationSearch(search, collapsed, toggleCollapse)
  useEffect(() => {
    let active = true
    const api = window.oxe?.delegation
    if (!api) return
    const refresh = async () => {
      const results = await Promise.allSettled(workspaces.map(workspace => api.status(workspace.id)))
      if (!active) return
      const unique = new Map<string, DelegationTask>()
      for (const result of results) if (result.status === 'fulfilled') for (const task of result.value.tasks) unique.set(task.id, task)
      setDelegations([...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt))
      setDelegationError(results.some(result => result.status === 'rejected') ? 'Some delegated work could not be loaded.' : '')
    }
    void refresh()
    const off = api.onChanged(() => { void refresh() })
    return () => { active = false; off() }
  }, [workspaces])
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
  const newThread = () => { const id = selected?.workspaceId ?? projects[0]?.contexts[0]?.workspaceId ?? workspaces[0]?.id; if (id) onCreate(id); else onAddProject?.() }
  const controlDelegation = async (task: DelegationTask, action: 'resume' | 'retry') => {
    setDelegationBusy(task.id); setDelegationError('')
    try {
      await window.oxe.delegation.control(task.originWorkspaceId ?? task.workspaceId, task.id, action)
      const snapshot = await window.oxe.delegation.status(task.originWorkspaceId ?? task.workspaceId)
      setDelegations(current => current.map(value => snapshot.tasks.find(item => item.id === value.id) ?? value))
      if (task.destinationThreadId) await useThreadStore.getState().select(task.destinationThreadId)
    } catch (error) { setDelegationError(error instanceof Error ? error.message : 'Could not recover delegated work.') }
    finally { setDelegationBusy('') }
  }
  const row = (thread: ConversationThread) => <div key={thread.id} className="thread-navigation-row"><button type="button" className="thread-navigation-item" aria-current={selectedId === thread.id ? 'page' : undefined}
    title={`${thread.title}\n${thread.provider} · ${thread.status}\n${thread.rootPath}`} onClick={() => void select(thread.id)}>
    <span>{thread.title}</span>{thread.status === 'running' ? <Loader2 size={12} className="thread-spin" aria-label="Running" /> : thread.status === 'failed' || thread.status === 'approval' ? <AlertCircle size={12} aria-label={thread.status} /> : thread.pinned ? <Pin size={11} /> : <small>{relativeTime(thread.updatedAt)}</small>}
  </button><button type="button" className="thread-row-action" aria-label={`Open ${thread.title} side by side`} title="Open side by side" disabled={selectedId === thread.id || secondaryId === thread.id} onClick={() => void openSecondary(thread.id).catch(error => setActionError(error instanceof Error ? error.message : 'Could not open conversation.'))}><Columns2 size={13} /></button><button type="button" className="thread-row-action" aria-label={`Delete thread ${thread.title}`} title="Delete thread" disabled={thread.status === 'running' || thread.status === 'approval'} onClick={() => { setActionError(''); setConfirmation({ kind: 'thread', id: thread.id, title: thread.title }) }}><Trash2 size={13} /></button></div>
  return <aside className={`thread-navigation${collapsed ? ' thread-navigation-collapsed' : ''}`} aria-label="Thread sidebar">
    {!collapsed && <div className="thread-resize" role="separator" tabIndex={0} aria-label="Thread sidebar width" aria-orientation="vertical" aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={width}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -SIDEBAR_RESIZE_STEP : SIDEBAR_RESIZE_STEP)) } }}
      onPointerDown={e => { resizing.current = true; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() }}
      onPointerMove={e => { if (resizing.current) setWidth(e.clientX - (e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0)) }}
      onPointerUp={() => { resizing.current = false }} onPointerCancel={() => { resizing.current = false }} onLostPointerCapture={() => { resizing.current = false }} />}
    <NavigationBrand collapsed={collapsed} mode="thread" onModeChange={onModeChange} />
    {collapsed && <nav className="sidebar-mode-rail" aria-label="Application view"><button type="button" aria-label="Code" title="Switch to Code" onClick={onModeChange}><PanelsTopLeft size={16} /></button></nav>}
    {collapsed ? <nav className="thread-nav-rail" aria-label="Collapsed threads"><button type="button" aria-label="New thread" title="New thread" onClick={newThread}><MessageSquarePlus size={16} /></button></nav> : <>
      <div className="thread-nav-actions"><button type="button" className="thread-new-action" aria-label="New thread" onClick={newThread}><MessageSquarePlus size={16} /><span>New thread</span></button>
        {onDelegations && <button type="button" className="thread-new-action" onClick={onDelegations}><Waypoints size={15} /><span>Delegated work</span></button>}
        <SearchField className="thread-nav-search" ref={search} label="Filter threads" placeholder="Filter threads" value={query} onChange={setQuery} shortcut="/" />
      </div>
      <nav className="thread-project-list" aria-label="Thread projects">
        {loading && !threads.length && <p className="thread-nav-empty" role="status">Loading conversations…</p>}
        {Object.entries(errors).map(([id, error]) => <div key={id} className="thread-catalog-error" role="alert"><p>{error}</p><button type="button" onClick={() => { void useThreadStore.getState().load(workspaces.map(w => w.id)); void useThreadStore.getState().loadProjects() }}>Retry</button></div>)}
        {threads.some(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')) && <section><h2> Pinned</h2>{threads.filter(t => t.pinned && matches(t, projects.find(p => p.projectId === t.projectId)?.displayName ?? '')).map(row)}</section>}
        {!!delegations.length && <section className="thread-delegated-work" aria-label="Delegated work">
          <h2><Waypoints size={12} aria-hidden="true" />Delegated work <small>{delegations.length}</small></h2>
          {delegations.filter(task => !query || `${task.id} ${task.objective} ${task.branch} ${task.state}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12).map(task => {
            const recoverable = ['failed', 'interrupted'].includes(task.state)
            const action = task.nativeSession?.resumable ? 'resume' as const : 'retry' as const
            return <div className="thread-delegation-row" key={task.id} data-state={task.state}>
              <button type="button" className="thread-delegation-main" disabled={!task.destinationThreadId} title={`${task.objective}\n${task.branch}\n${task.path}`} onClick={() => { if (task.destinationThreadId) void select(task.destinationThreadId) }}>
                <span className="thread-delegation-state" aria-label={task.state}>{task.state === 'starting' || task.state === 'preparing' || task.state === 'accepted' ? <Loader2 size={12} className="thread-spin" /> : <span />}</span>
                <span><strong>{task.objective}</strong><small><GitBranch size={10} />{task.branch}</small></span>
              </button>
              {recoverable && <button type="button" className="thread-row-action" disabled={delegationBusy === task.id} aria-label={`${action} ${task.objective}`} title={action === 'resume' ? 'Resume exact provider session' : 'Retry provisioning'} onClick={() => void controlDelegation(task, action)}><RotateCcw size={13} /></button>}
            </div>
          })}
          {delegationError && <p className="thread-catalog-error" role="alert">{delegationError}</p>}
        </section>}
        {!!groups.length && <h2>Projects</h2>}
        {groups.map(group => <section key={group.id}>
          <div className="thread-project-heading">
          <button type="button" className="thread-project-toggle" title={group.path} aria-expanded={query ? true : expanded[group.id] ?? true} onClick={() => toggle(group.id)}><ChevronDown size={12} /><span>{group.name}</span>{groups.filter(g => g.name === group.name).length > 1 && <small>{group.path.split(/[\\/]/).slice(-2).join('/')}</small>}</button>
          <button type="button" className="thread-row-action" aria-label={`New thread in ${group.name}`} title="New thread in this project" disabled={!group.workspaceId} onClick={() => { if (group.workspaceId) onCreate(group.workspaceId, group.rootPath) }}><Plus size={14} /></button>
          <button type="button" className="thread-row-action" aria-label={`Remove project ${group.name}`} title="Remove project from Thread sidebar" onClick={() => { setActionError(''); setConfirmation({ kind: 'project', id: group.id, title: group.name }) }}><X size={13} /></button>
          </div>
          <ProjectBranch workspaceId={selected?.projectId === group.id ? selected.workspaceId : group.workspaceId} rootPath={selected?.projectId === group.id ? selected.rootPath : group.rootPath} />
          {(query || (expanded[group.id] ?? true)) && group.threads.map(row)}
        </section>)}
        {!loading && !groups.length && <p className="thread-nav-empty">{query ? 'No conversations found.' : 'Add a project to start a conversation.'}</p>}
        {!query && <button type="button" className="thread-add-project" onClick={onAddProject}><FolderPlus size={14} />Add project</button>}
        {hiddenProjects.length > 0 && <button type="button" className="thread-add-project" onClick={() => useThreadStore.getState().restoreProjects()}>Restore hidden projects ({hiddenProjects.length})</button>}
      </nav>
    </>}
    <NavigationFooter className="thread-nav-footer" collapsed={collapsed} context={{ label: 'Accounts', ariaLabel: 'Agent accounts', icon: UserRound, onClick: onAccounts }} onToggle={toggleCollapse} />
    {confirmation && <DesktopDialog className="thread-create-dialog" title={confirmation.kind === 'thread' ? 'Delete thread' : 'Remove project'} description={confirmation.kind === 'thread' ? `Delete “${confirmation.title}” from OXESpace? The provider session and project files are kept.` : `Hide “${confirmation.title}” from the Thread sidebar? Conversations, files and Code workspaces are kept. You can restore it later.`} onClose={() => { if (!acting) setConfirmation(null) }}>
      {actionError && <p role="alert">{actionError}</p>}
      <footer><button type="button" disabled={acting} onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className="thread-primary" disabled={acting} onClick={() => {
        setActing(true); setActionError('')
        void (async () => {
          try {
            if (confirmation.kind === 'project') await useThreadStore.getState().hideProject(confirmation.id)
            else {
              if (!window.oxe.thread?.command) throw Error('Restart the updated application to delete threads.')
              await window.oxe.thread.command(confirmation.id, '/delete confirm')
              await useThreadStore.getState().load(workspaces.map(workspace => workspace.id))
            }
            setConfirmation(null)
          } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not complete the action.') }
          finally { setActing(false) }
        })()
      }}>{acting ? 'Please wait…' : confirmation.kind === 'thread' ? 'Delete thread' : 'Remove project'}</button></footer>
    </DesktopDialog>}
  </aside>
}
