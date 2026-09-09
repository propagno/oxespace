import { useEffect, useState } from 'react'
import type { DelegationSnapshot } from '../../../shared/types/delegation'
import { useUIStore } from '../../store/ui.store'
import './WorkspaceMemorySettings.css'

export function WorkspaceDelegationSettings({ workspaceId }: { workspaceId: string }) {
  const [snapshot, setSnapshot] = useState<DelegationSnapshot>({ enabled: false, tasks: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let live = true
    setReady(false)
    const api = window.oxe?.delegation
    if (!api) return
    const refresh = () => { void api.status(workspaceId).then(value => { if (live) { setSnapshot(value); setReady(true) } }).catch(e => { if (live) setError(String(e)) }) }
    refresh()
    const off = api.onChanged(e => { if (e.workspaceId === workspaceId) refresh() })
    return () => { live = false; off() }
  }, [workspaceId])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn(); setSnapshot(await window.oxe.delegation.status(workspaceId)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section className="ws-settings-section memory-settings" aria-labelledby="delegation-title">
    <header className="ws-settings-section-header"><h3 id="delegation-title">Agent delegation</h3></header>
    <p>Ask an agent to handle a parallel task in its own worktree and terminal. Your current terminal stays open.</p>
    <label><input type="checkbox" checked={snapshot.enabled} disabled={!ready || busy} onChange={e => { const enabled = e.target.checked; void act(() => window.oxe.delegation.configure(workspaceId,enabled)) }} /> Allow agents to delegate tasks in this project</label>
    <p className="memory-privacy">Delegation starts another Claude or Codex session and supplies the handoff to that agent, which may use a cloud service. Native login and permission prompts still apply. Open new terminals after enabling.</p>
    {error && <p role="alert" className="memory-feedback">{error}</p>}
    {!snapshot.tasks.length && <p>No delegated tasks yet. Ask your agent to use oxespace_delegate_task.</p>}
    {snapshot.tasks.map(task => <article key={task.id} className="memory-feedback">
      <div className="memory-status-line"><strong>{task.objective}</strong><span className="memory-badge" data-state={task.state}>{task.state}</span></div>
      <p>{task.branch}</p>
      {task.error && <p role="alert">{task.error}</p>}
      {task.lastReport && <p>{task.lastReport}</p>}
      {task.lastMessage && <p>Latest message: {task.lastMessage}</p>}
      <div className="memory-task-actions">
        {task.paneId && <button type="button" onClick={() => { useUIStore.getState().setActivePane(task.paneId!); useUIStore.getState().closeWorkspaceSettings() }}>Open terminal</button>}
        {['failed','interrupted'].includes(task.state) && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'retry'))}>Retry</button>}
        {task.state === 'review' && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'approve'))}>Approve result</button>}
        {!['approved','cancelled'].includes(task.state) && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'cancel'))}>Cancel task</button>}
      </div>
      <details><summary>Task and handoff</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.context ?? task.handoff}</pre></details>
    </article>)}
  </section>
}
