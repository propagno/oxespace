import { useEffect, useState } from 'react'
import type { DelegationSnapshot } from '../../../shared/types/delegation'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import './WorkspaceMemorySettings.css'

export function WorkspaceDelegationSettings({ workspaceId, paneIds, onOpenTerminal, onOpenDiagnostics }: { workspaceId: string; paneIds?: string[]; onOpenTerminal?: (paneId: string, workspaceId?: string) => void; onOpenDiagnostics?: () => void }) {
  const [snapshot, setSnapshot] = useState<DelegationSnapshot>({ enabled: false, tasks: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [targetPath, setTargetPath] = useState('')
  const [allowEvidence, setAllowEvidence] = useState(false)
  const [consent, setConsent] = useState(false)
  const [adoptPane, setAdoptPane] = useState<Record<string, string>>({})
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const sourcePanes = workspaces.find(w => w.id === workspaceId)?.panes ?? []
  useEffect(() => {
    let live = true
    setReady(false)
    setError(''); setSnapshot({ enabled: false, tasks: [] })
    setConsent(false); setTargetPath(''); setAdoptPane({})
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
    <details className="coordination-destinations">
      <summary>Manage authorized destinations ({snapshot.targets?.length ?? 0})</summary>
    <fieldset disabled={busy || !ready}>
      <legend>Authorized destinations</legend>
      <p>Allow this project to launch independent tasks in another local repository for 30 days. Both projects must enable delegation. No clone, push or merge is authorized.</p>
      <label>Destination repository path<input value={targetPath} onChange={e => { setTargetPath(e.target.value); setConsent(false) }} placeholder="Absolute path to a local Git repository" /></label>
      <label><input type="checkbox" checked={allowEvidence} onChange={e => { setAllowEvidence(e.target.checked); setConsent(false) }} /> Allow selected committed text files as evidence (up to 64 KB)</label>
      <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I authorize task handoffs{allowEvidence ? ' and selected file content' : ''} to the destination agent, which may send them to its cloud provider.</label>
      <p>Analysis mode instructs the agent not to edit files; it is not a security sandbox. Revoking access cannot retract content already delivered.</p>
      <button type="button" className="primary-action" disabled={!targetPath.trim() || !consent} onClick={() => void act(async () => {
        await window.oxe.delegation.configureTarget(workspaceId, targetPath, true, allowEvidence)
        setTargetPath(''); setConsent(false); await useWorkspaceStore.getState().bootstrap()
      })}>Authorize local destination</button>
      {(snapshot.targets ?? []).map(target => <article className="memory-feedback" key={target.workspaceId}>
        <strong>{target.name}</strong><p>{target.rootPath}</p>
        <p>Expires {new Date(target.expiresAt).toLocaleDateString()} · Evidence {target.allowEvidence ? 'allowed' : 'disabled'}</p>
        <button type="button" onClick={() => void act(() => window.oxe.delegation.configureTarget(workspaceId, target.rootPath, false, false))}>Revoke destination</button>
      </article>)}
    </fieldset>
    </details>
    {error && <p role="alert" className="memory-feedback">{error}</p>}
    {onOpenDiagnostics && <button type="button" onClick={onOpenDiagnostics}>Open diagnostics and logs</button>}
    {!snapshot.tasks.length && <p>No delegated tasks yet. Ask your agent to use oxespace_delegate_task.</p>}
    {snapshot.tasks.map(task => <article key={task.id} className="memory-feedback">
      <div className="memory-status-line"><strong>{task.objective}</strong><span className="memory-badge" data-state={task.state}>{task.state}</span></div>
      <p>{task.branch}</p>
      {task.originWorkspaceId && <p>{workspaces.find(w => w.id === task.originWorkspaceId)?.name ?? 'Origin'} → {workspaces.find(w => w.id === task.workspaceId)?.name ?? 'Destination'} · {task.mode ?? 'isolated-change'}</p>}
      {task.error && <p role="alert">{task.error}</p>}
      {task.lastReport && <p>{task.lastReport}</p>}
      {task.lastMessage && <p>Latest message: {task.lastMessage}</p>}
      <div className="memory-task-actions">
        {task.workspaceId !== workspaceId && <button type="button" onClick={() => void act(async () => {
          await useWorkspaceStore.getState().bootstrap()
          if (task.paneId && onOpenTerminal) { onOpenTerminal(task.paneId, task.workspaceId); return }
          await useWorkspaceStore.getState().setActiveWorkspace(task.workspaceId)
          if (task.paneId) useUIStore.getState().setActivePane(task.paneId)
          useUIStore.getState().closeWorkspaceSettings()
        })}>Open destination</button>}
        {task.workspaceId === workspaceId && task.paneId && (!paneIds || paneIds.includes(task.paneId)) && <button type="button" onClick={() => {
          if (onOpenTerminal) onOpenTerminal(task.paneId!)
          else { useUIStore.getState().setActivePane(task.paneId!); useUIStore.getState().closeWorkspaceSettings() }
        }}>Open terminal</button>}
        {(task.originWorkspaceId ?? task.workspaceId) === workspaceId && <>
          {['failed','interrupted'].includes(task.state) && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'retry'))}>Retry</button>}
          {task.state === 'review' && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'approve'))}>Approve result</button>}
          {!['approved','cancelled'].includes(task.state) && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'cancel'))}>Cancel task</button>}
        </>}
      </div>
      {(task.originWorkspaceId ?? task.workspaceId) === workspaceId && <div>
        <label>Reconnect origin terminal<select value={adoptPane[task.id] ?? ''} onChange={e => setAdoptPane(value => ({ ...value, [task.id]: e.target.value }))}>
          <option value="">Select a running terminal</option>
          {sourcePanes.filter(p => p.id !== task.paneId).map(p => <option key={p.id} value={p.id}>{p.displayName ?? p.id}</option>)}
        </select></label>
        <button type="button" disabled={busy || !adoptPane[task.id]} onClick={() => void act(() => window.oxe.delegation.adopt(workspaceId, task.id, adoptPane[task.id]))}>Authorize terminal to follow and control this task</button>
      </div>}
      {task.workspaceId === workspaceId && task.paneId && paneIds && !paneIds.includes(task.paneId) && <p>Terminal was closed. Retry recreates it while preserving the worktree and handoff.</p>}
      {['preparing','starting'].includes(task.state) && <p role="status">{task.state === 'preparing' ? 'Preparing the worktree and terminal…' : 'Agent process started. Open the terminal to check login, trust or acceptance prompts.'}</p>}
      <details><summary>Task and handoff</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.context ?? task.handoff}</pre></details>
    </article>)}
  </section>
}
