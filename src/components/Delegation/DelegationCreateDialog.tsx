import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Loader2, Waypoints } from 'lucide-react'
import type { DelegationBranchIntent, DelegationPreflight, DelegationTask } from '../../../shared/types/delegation'
import type { AgentProfile } from '../../../shared/types/agent'
import type { ConversationThread } from '../../../shared/types/thread'
import { DesktopDialog } from '../Navigation/DesktopDialog'
import './DelegationCreateDialog.css'

export function DelegationCreateDialog({ thread, workspaceId: suppliedWorkspaceId, origin: suppliedOrigin, onClose, onCreated }: {
  thread?: ConversationThread
  workspaceId?: string
  origin?: { kind: 'pane' | 'thread'; id: string }
  onClose(): void
  onCreated?(task: DelegationTask): void
}) {
  const workspaceId = thread?.workspaceId ?? suppliedWorkspaceId ?? ''
  const threadProjectId = thread?.projectId
  const origin = suppliedOrigin ?? { kind: 'thread' as const, id: thread?.id ?? '' }
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [reuse, setReuse] = useState(false)
  const [fetchBase, setFetchBase] = useState(false)
  const requestKey = useRef(`delegate-${crypto.randomUUID()}`)
  const revision = useRef(0)
  const [objective, setObjective] = useState('')
  const [handoff, setHandoff] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [strategy, setStrategy] = useState<DelegationBranchIntent['strategy']>('create')
  const [branch, setBranch] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [remote, setRemote] = useState('')
  const [reference, setReference] = useState('')
  const [template, setTemplate] = useState(() => { try { return localStorage.getItem(`oxe.delegation.template.${workspaceId}`) || 'oxe/{slug}-{shortId}' } catch { return 'oxe/{slug}-{shortId}' } })
  const [mode, setMode] = useState<'analysis' | 'isolated-change'>('isolated-change')
  const [surface, setSurface] = useState<'thread' | 'terminal'>('thread')
  const [evidence, setEvidence] = useState('')
  const [sessions, setSessions] = useState<ConversationThread[]>([])
  const [sourceThreadIds, setSourceThreadIds] = useState<string[]>(origin.kind === 'thread' && origin.id ? [origin.id] : [])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sourcesExpanded, setSourcesExpanded] = useState(true)
  const [includeMemory, setIncludeMemory] = useState(true)
  const [destinations, setDestinations] = useState<Array<{ workspaceId: string; name: string }>>([])
  const [targetId, setTargetId] = useState(workspaceId)
  const [preview, setPreview] = useState<DelegationPreflight | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false)
  useEffect(() => {
    let active = true
    void window.oxe.agent.list().then(all => {
      if (!active) return
      const supported = all.filter(profile => ['claude', 'codex'].includes(profile.parentProvider ?? profile.provider))
      setProfiles(supported); setProfileId(supported.find(profile => profile.provider === thread?.provider)?.agentProfileId ?? supported[0]?.agentProfileId ?? '')
    }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false; revision.current++ }
  }, [thread?.provider])
  useEffect(() => {
    let active = true
    void window.oxe.delegation.status(workspaceId).then(snapshot => { if (active) setDestinations(snapshot.targets ?? []) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [workspaceId])
  useEffect(() => {
    let active = true
    const threadApi = window.oxe.thread
    if (!threadApi) { setSessionsLoading(false); return }
    setSessionsLoading(true)
    void threadApi.list().then(async sessions => {
      if (active) setSessions(sessions.filter(item => threadProjectId ? item.projectId === threadProjectId : item.workspaceId === workspaceId)
        .filter(item => !item.archived).sort((a, b) => b.updatedAt - a.updatedAt))
    }).catch(cause => { if (active) setError(`Could not load conversations: ${String(cause)}`) })
      .finally(() => { if (active) setSessionsLoading(false) })
    return () => { active = false }
  }, [workspaceId, threadProjectId])
  const intent = useMemo<DelegationBranchIntent>(() => strategy === 'generated'
    ? { strategy, reference: reference.trim() || undefined, template: template.trim() || undefined, baseRef: baseRef.trim() || undefined, remote: remote.trim() || undefined, fetchBase }
    : { strategy, name: branch || undefined, baseRef: baseRef.trim() || undefined, remote: remote.trim() || undefined, reuseExistingWorktree: reuse, fetchBase }, [strategy, reference, template, branch, baseRef, remote, reuse, fetchBase])
  useEffect(() => { revision.current++; setPreview(null) }, [intent, objective, targetId])
  const inspect = async () => {
    setLoading(true); setError(''); setPreview(null)
    const current = ++revision.current
    try {
      const result = await window.oxe.delegation.preview(targetId, objective, intent)
      if (current === revision.current) { setPreview(result); if (strategy === 'generated') { try { localStorage.setItem(`oxe.delegation.template.${workspaceId}`, template) } catch { /* Preferences are optional. */ } } }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not resolve this checkout.') }
    finally { setLoading(false) }
  }
  const create = async () => {
    if (!preview) return
    setLoading(true); setError('')
    try {
      const task = await window.oxe.delegation.create(workspaceId, origin, { schemaVersion: 2, key: requestKey.current,
        agentProfileId: profileId, objective: objective.trim(), handoff: handoff.trim(), acceptance: acceptance.trim(),
        targetWorkspaceId: targetId, surface, mode, evidenceFiles: evidence.split(/\r?\n/).map(path => path.trim()).filter(Boolean),
        branchIntent: intent, previewId: preview.previewId, sourceThreadIds, includeMemory })
      onCreated?.(task); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }
  return <DesktopDialog className="delegation-create-dialog" title="Delegate work" description="Start a focused session in its own branch and worktree." onClose={() => { if (!loading) onClose() }}>
    <div className="delegation-form-body">
      <div className="delegation-context-row">
        <label>Agent<select value={profileId} disabled={loading} onChange={event => setProfileId(event.target.value)}>{profiles.map(profile => <option key={profile.agentProfileId} value={profile.agentProfileId}>{profile.name}</option>)}</select></label>
        <label>Destination<select value={targetId} disabled={loading} onChange={event => { setTargetId(event.target.value); if (event.target.value.startsWith('thread:')) setSurface('thread') }}><option value={workspaceId}>This project · new worktree</option>{destinations.filter(target => target.workspaceId !== workspaceId).map(target => <option key={target.workspaceId} value={target.workspaceId}>{target.name}</option>)}</select></label>
        <label>Mode<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="isolated-change">Implement changes</option><option value="analysis">Analysis only</option></select></label>
        <label>Open destination in<select value={surface} onChange={event => setSurface(event.target.value as typeof surface)}><option value="thread">Thread conversation</option>{!targetId.startsWith('thread:') && <option value="terminal">Code terminal</option>}</select></label>
      </div>
      <div className="delegation-columns">
        <section className="delegation-panel" aria-labelledby="delegation-task-heading">
          <div className="delegation-section-heading"><span>01</span><div><h3 id="delegation-task-heading">Task brief</h3><p>Give the agent a clear outcome and enough context to work independently.</p></div></div>
          <label>Objective<textarea className="delegation-objective" value={objective} maxLength={2000} onChange={event => { setObjective(event.target.value); setPreview(null) }} placeholder="Implement the authentication callback" /></label>
          <label>Handoff<textarea className="delegation-handoff" value={handoff} maxLength={16000} onChange={event => setHandoff(event.target.value)} placeholder="Decisions, constraints and relevant context" /></label>
          <label>Acceptance criteria<textarea className="delegation-acceptance" value={acceptance} maxLength={2000} onChange={event => setAcceptance(event.target.value)} placeholder="Tests and observable completion criteria" /></label>
          <details className="delegation-evidence delegation-sources" open={sourcesExpanded} onToggle={event => setSourcesExpanded(event.currentTarget.open)}>
            <summary>Knowledge to transfer <span>{sourceThreadIds.length} conversation{sourceThreadIds.length === 1 ? '' : 's'} · AI Memory {includeMemory ? 'on' : 'off'}</span></summary>
            <p>Select saved conversations from this project. The latest public messages are captured when you create the delegation; tool output and attachments are excluded.</p>
            <div className="delegation-session-list">
              {sessionsLoading ? <p>Loading conversations…</p> : sessions.length ? sessions.map(session => <label key={session.id}>
                <input type="checkbox" checked={sourceThreadIds.includes(session.id)} disabled={!sourceThreadIds.includes(session.id) && sourceThreadIds.length >= 5}
                  onChange={event => setSourceThreadIds(current => event.target.checked ? [...current, session.id] : current.filter(id => id !== session.id))} />
                <span><strong>{session.title}</strong><small>{session.provider} · {new Date(session.updatedAt).toLocaleDateString()} · {session.rootPath}</small></span>
              </label>) : <p>No saved conversations in this project yet.</p>}
            </div>
            <label className="delegation-memory-option"><input type="checkbox" checked={includeMemory} onChange={event => setIncludeMemory(event.target.checked)} /><span>Include relevant AI Memory <small>Requires AI Memory enabled for this project. Code context is included separately when available.</small></span></label>
          </details>
          <details className="delegation-evidence"><summary>Committed file evidence <span>Optional · up to 8 paths</span></summary><label>Repository paths, one per line<textarea value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="docs/architecture.md" /></label><p>Only selected committed text is transferred. Local edits stay in this checkout.</p></details>
        </section>
        <section className="delegation-panel" aria-labelledby="delegation-checkout-heading">
          <div className="delegation-section-heading"><span>02</span><div><h3 id="delegation-checkout-heading">Checkout</h3><p>Choose the branch for the independent worktree.</p></div></div>
          <fieldset className="delegation-strategies"><legend>Branch strategy</legend>
            {(['existing', 'create', 'generated'] as const).map(value => <label key={value} data-selected={strategy === value}><input type="radio" name="delegation-branch" checked={strategy === value} onChange={() => { setStrategy(value); setPreview(null) }} />{value === 'existing' ? 'Existing' : value === 'create' ? 'New branch' : 'Generated'}</label>)}
          </fieldset>
          <div className="delegation-branch-fields">
            {strategy === 'generated' ? <><label>Reference (optional)<input value={reference} onChange={event => { setReference(event.target.value); setPreview(null) }} placeholder="CARD-142" /></label><label>Template<input value={template} onChange={event => { setTemplate(event.target.value); setPreview(null) }} /></label></>
              : <label>Exact branch<input value={branch} onChange={event => { setBranch(event.target.value); setPreview(null) }} placeholder="feature/CARD-142-login" /></label>}
            {strategy !== 'existing' && <label>Base ref (optional)<input value={baseRef} onChange={event => { setBaseRef(event.target.value); setPreview(null) }} placeholder="Repository default" /></label>}
          </div>
          <div className="delegation-options">
            {strategy === 'existing' && <label><input type="checkbox" checked={reuse} onChange={event => setReuse(event.target.checked)} />Reuse a clean worktree already on this branch</label>}
            <label><input type="checkbox" checked={fetchBase} onChange={event => setFetchBase(event.target.checked)} />Fetch remote before creating the worktree</label>
            {fetchBase && <label className="delegation-remote-field">Remote (optional)<input value={remote} onChange={event => { setRemote(event.target.value); setPreview(null) }} placeholder="origin" /></label>}
          </div>
          {preview && <section className="delegation-preview" aria-label="Delegation preview"><header><Waypoints size={14} /><strong>{preview.ready ? 'Ready to delegate' : 'Configuration required'}</strong></header>
            <dl><div><dt>Branch</dt><dd><GitBranch size={12} />{preview.checkout.branch}</dd></div><div><dt>Base</dt><dd>{preview.checkout.baseRef} · {preview.checkout.baseSha.slice(0, 12)}</dd></div><div><dt>Worktree</dt><dd>{preview.checkout.path}</dd></div></dl>
            {!preview.ready && <p>Enable Agent delegation for this project in Settings before sending.</p>}
          </section>}
        </section>
      </div>
      {error && <p role="alert" className="delegation-preview-error">{error}</p>}
    </div>
    <footer className="delegation-footer"><span>Preview the checkout before starting the agent.</span><div><button type="button" disabled={loading} onClick={onClose}>Cancel</button><button type="button" disabled={loading || !objective.trim() || (strategy !== 'generated' && !branch.trim())} onClick={() => void inspect()}>{loading ? <><Loader2 size={13} className="thread-spin" />Working…</> : 'Preview checkout'}</button><button type="button" className="thread-primary" disabled={loading || !profileId || !preview?.ready || !handoff.trim() || !acceptance.trim()} onClick={() => void create()}>Create delegation</button></div></footer>
  </DesktopDialog>
}
