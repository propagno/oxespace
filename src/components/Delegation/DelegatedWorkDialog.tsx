import { useEffect, useRef, useState } from 'react'
import { GitBranch, Plus, Search } from 'lucide-react'
import type { DelegationTask, DelegationRecoveryAction } from '../../../shared/types/delegation'
import type { Workspace } from '../../../shared/types/workspace'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import { DelegationCreateDialog } from './DelegationCreateDialog'
import './DelegatedWorkDialog.css'

export function DelegatedWorkDialog({ workspaces, workspaceId, focusTaskId, origin, onClose, onOpen }: {
  workspaces: Workspace[]; workspaceId: string; focusTaskId?: string | null; origin?: { kind: 'pane' | 'thread'; id: string }
  onClose(): void; onOpen(task: DelegationTask): Promise<boolean>
}) {
  const [selectedWorkspace, setSelectedWorkspace] = useState(workspaceId || workspaces[0]?.id || '')
  const [tasks, setTasks] = useState<DelegationTask[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [query, setQuery] = useState(focusTaskId ?? ''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [creating, setCreating] = useState(false)
  const [replaceId, setReplaceId] = useState<string | null>(null)
  const request = useRef(0)
  useEffect(() => { if (focusTaskId) setQuery(focusTaskId) }, [focusTaskId])
  useEffect(() => { if (workspaceId) setSelectedWorkspace(workspaceId) }, [workspaceId])
  useEffect(() => {
    let active = true
    const refresh = async () => {
      const version = ++request.current
      setBusy(true)
      try {
        const page = await window.oxe.delegation.status(selectedWorkspace, undefined, 50)
        if (active && version === request.current) { setTasks(page.tasks); setCursor(page.nextCursor ?? null); setError('') }
      } catch (cause) { if (active) setError(String(cause)) }
      finally { if (active && version === request.current) setBusy(false) }
    }
    setTasks([]); setCursor(null)
    void refresh()
    const off = window.oxe.delegation.onChanged(event => { if (event.workspaceId === selectedWorkspace) void refresh() })
    return () => { active = false; request.current++; off() }
  }, [selectedWorkspace])
  const act = async (task: DelegationTask, action: DelegationRecoveryAction) => {
    if (action === 'new-session' && replaceId !== task.id) { setReplaceId(task.id); return }
    setBusy(true); setError('')
    try {
      await window.oxe.delegation.control(task.originWorkspaceId ?? task.workspaceId, task.id, action)
      const page = await window.oxe.delegation.status(selectedWorkspace, undefined, 50)
      setTasks(page.tasks); setCursor(page.nextCursor ?? null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const filtered = tasks.filter(task => `${task.id} ${task.objective} ${task.branch} ${task.state} ${task.nativeSession?.nativeSessionId ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  if (creating && origin) return <DelegationCreateDialog workspaceId={workspaceId} origin={origin} onClose={() => setCreating(false)} />
  return <DesktopDialog className="delegated-work-dialog" title="Delegated work" description="Independent worktrees, shared knowledge and persistent agent sessions." onClose={onClose}>
    <div className="delegated-work-toolbar">
      <select aria-label="Delegation project" value={selectedWorkspace} onChange={event => setSelectedWorkspace(event.target.value)}>{workspaces.map(workspace => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select>
      <label><Search size={14} /><input aria-label="Search delegated work" placeholder="Search branch, task or session" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" disabled={!origin} onClick={() => setCreating(true)}><Plus size={14} />Delegate work</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="delegated-work-list" aria-busy={busy}>
      {!filtered.length && <p>{busy ? 'Loading delegated work…' : query ? 'No matching tasks on loaded pages.' : 'No delegated work in this project.'}</p>}
      {filtered.map(task => <article key={task.id}>
        <header><strong>{task.objective}</strong><span data-state={task.state}>{task.state}</span></header>
        <p className="delegated-work-branch"><GitBranch size={13} />{task.branch}</p>
        <p>{task.nativeSession?.provider ?? task.agentProfileId} · {task.surface ?? 'terminal'} · {new Date(task.updatedAt).toLocaleString()}</p>
        {task.lastReport && <p>{task.lastReport}</p>}
        {task.error && <p role="alert">{task.error}</p>}
        <div className="delegated-work-actions">
          <button type="button" disabled={!task.destinationThreadId && !task.paneId} onClick={() => { void onOpen(task).then(opened => { if (!opened) setError(task.destinationThreadId ? 'The saved conversation could not be opened. Use the recovery actions below.' : 'This terminal is no longer running. Resume its saved session or start a new session from the handoff below.') }) }}>Open {task.destinationThreadId ? 'conversation' : 'terminal'}</button>
          {origin && workspaceId === (task.originWorkspaceId ?? task.workspaceId) && <button type="button" disabled={busy} onClick={() => {
            setBusy(true); setError('')
            void window.oxe.delegation.adopt(workspaceId, task.id, origin.kind === 'thread' ? `thread:${origin.id}` : origin.id)
              .catch(cause => setError(String(cause))).finally(() => setBusy(false))
          }}>Reconnect current {origin.kind === 'thread' ? 'conversation' : 'terminal'} as origin</button>}
          {workspaceId === (task.originWorkspaceId ?? task.workspaceId) && (task.recoveryActions ?? []).filter(action => !['open', 'continue'].includes(action)).map(action => <button type="button" key={action} disabled={busy} onClick={() => void act(task, action)}>{action === 'resume' ? 'Resume exact session' : action === 'retry' ? 'Retry provisioning' : action === 'new-session' ? replaceId === task.id ? 'Confirm new session' : 'New session from handoff' : action === 'approve' ? 'Approve result' : 'Cancel task'}</button>)}
        </div>
        {replaceId === task.id && <p role="status">This starts an independent provider session from the saved handoff and latest checkpoint. The previous conversation and worktree are preserved.</p>}
        <details><summary>Session and handoff details</summary><dl>
          <dt>Task ID</dt><dd>{task.id}</dd><dt>Session ID</dt><dd>{task.nativeSession?.nativeSessionId ?? 'Not yet observed'}</dd>
          <dt>Worktree</dt><dd>{task.path}</dd><dt>Base commit</dt><dd>{task.baseSha}</dd>
          <dt>Origin</dt><dd>{task.originCwd ?? task.cwd}</dd><dt>Handoff revision</dt><dd>{task.knowledgeBundle?.revision ?? 1}</dd>
        </dl><h4>Knowledge included</h4>{task.knowledgeBundle?.sources.length ? <ul>{task.knowledgeBundle.sources.map((source, index) => <li key={`${source.kind}-${index}`}><strong>{source.kind === 'memory' ? 'AI Memory' : source.kind === 'session' ? 'Conversation' : source.kind}</strong><span>{source.label}</span></li>)}</ul> : <p>The knowledge bundle is being prepared or no optional source was available.</p>}{task.includeMemory && task.knowledgeBundle && !task.knowledgeBundle.sources.some(source => source.kind === 'memory') && <p role="status">AI Memory was requested but provided no context for this handoff. Check the project memory settings before retrying.</p>}<pre>{task.context ?? task.handoff}</pre></details>
      </article>)}
    </div>
    {cursor && <button type="button" disabled={busy} onClick={() => {
      const version = ++request.current
      setBusy(true)
      void window.oxe.delegation.status(selectedWorkspace, cursor, 50).then(page => {
        if (version !== request.current) return
        setTasks(current => [...new Map([...current, ...page.tasks].map(task => [task.id, task])).values()]); setCursor(page.nextCursor ?? null)
      }).catch(cause => setError(String(cause))).finally(() => { if (version === request.current) setBusy(false) })
    }}>Load more</button>}
  </DesktopDialog>
}
