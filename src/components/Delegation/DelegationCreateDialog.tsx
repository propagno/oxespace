import { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Waypoints } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DelegationBranchIntent, DelegationPreflight, DelegationTask } from '../../../shared/types/delegation'
import type { AgentProfile } from '../../../shared/types/agent'
import type { ConversationThread } from '../../../shared/types/thread'
import './DelegationCreateDialog.css'
import { Button, Checkbox, Dialog, Notice, Select, TextArea, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDate } from '../../utils/formatTime'

export function DelegationCreateDialog({ thread, workspaceId: suppliedWorkspaceId, origin: suppliedOrigin, onClose, onCreated }: {
  thread?: ConversationThread
  workspaceId?: string
  origin?: { kind: 'pane' | 'thread'; id: string }
  onClose(): void
  onCreated?(task: DelegationTask): void
}) {
  const workspaceId = thread?.workspaceId ?? suppliedWorkspaceId ?? ''
  const threadProjectId = thread?.projectId
  const { t } = useTranslation('code')
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
    }).catch(cause => { if (active) setError(t('delegate.loadFailed', { error: String(cause) })) })
      .finally(() => { if (active) setSessionsLoading(false) })
    return () => { active = false }
  }, [workspaceId, threadProjectId, t])
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
    catch (cause) { setError(humanizeError(cause, t('delegate.checkoutFailed'))) }
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
    } catch (cause) { setError(humanizeError(cause)) }
    finally { setLoading(false) }
  }
  return <Dialog className="delegation-create-dialog" size="xl" title={t('delegate.title')} description={t('delegate.description')} onClose={() => { if (!loading) onClose() }}
    footer={<>
      <Button variant="ghost" loading={loading} disabled={loading || !objective.trim() || (strategy !== 'generated' && !branch.trim())} onClick={() => void inspect()}>{t('delegate.preview')}</Button>
      <Button disabled={loading} onClick={onClose}>{t('ui.cancel', { ns: 'common' })}</Button>
      <Button variant="primary" disabled={loading || !profileId || !preview?.ready || !handoff.trim() || !acceptance.trim()} onClick={() => void create()}>{t('delegate.create')}</Button>
    </>}>
    <div className="delegation-form-body">
      <div className="delegation-context-row">
        <label>{t('delegate.agent')}<Select value={profileId} disabled={loading} onChange={event => setProfileId(event.target.value)}>{profiles.map(profile => <option key={profile.agentProfileId} value={profile.agentProfileId}>{profile.name}</option>)}</Select></label>
        <label>{t('delegate.destination')}<Select value={targetId} disabled={loading} onChange={event => { setTargetId(event.target.value); if (event.target.value.startsWith('thread:')) setSurface('thread') }}><option value={workspaceId}>{t('delegate.thisProject')}</option>{destinations.filter(target => target.workspaceId !== workspaceId).map(target => <option key={target.workspaceId} value={target.workspaceId}>{target.name}</option>)}</Select></label>
        <label>{t('delegate.mode')}<Select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="isolated-change">{t('delegate.modeChange')}</option><option value="analysis">{t('delegate.modeAnalysis')}</option></Select></label>
        <label>{t('delegate.openIn')}<Select value={surface} onChange={event => setSurface(event.target.value as typeof surface)}><option value="thread">{t('delegate.surfaceThread')}</option>{!targetId.startsWith('thread:') && <option value="terminal">{t('delegate.surfaceTerminal')}</option>}</Select></label>
      </div>
      <div className="delegation-columns">
        <section className="delegation-panel" aria-labelledby="delegation-task-heading">
          <div className="delegation-section-heading"><span>01</span><div><h3 id="delegation-task-heading">{t('delegate.brief')}</h3><p>{t('delegate.briefHint')}</p></div></div>
          <label>{t('delegate.objective')}<textarea className="delegation-objective" value={objective} maxLength={2000} onChange={event => { setObjective(event.target.value); setPreview(null) }} placeholder={t('delegate.objectivePlaceholder')} /></label>
          <label>{t('delegate.handoff')}<textarea className="delegation-handoff" value={handoff} maxLength={16000} onChange={event => setHandoff(event.target.value)} placeholder={t('delegate.handoffPlaceholder')} /></label>
          <label>{t('delegate.acceptance')}<textarea className="delegation-acceptance" value={acceptance} maxLength={2000} onChange={event => setAcceptance(event.target.value)} placeholder={t('delegate.acceptancePlaceholder')} /></label>
          <details className="delegation-evidence delegation-sources" open={sourcesExpanded} onToggle={event => setSourcesExpanded(event.currentTarget.open)}>
            <summary>{t('delegate.knowledge')} <span>{t('delegate.knowledgeSummary', { count: sourceThreadIds.length, memory: includeMemory ? t('delegate.memoryOn') : t('delegate.memoryOff') })}</span></summary>
            <p>{t('delegate.knowledgeHint')}</p>
            <div className="delegation-session-list">
              {sessionsLoading ? <p>{t('delegate.loadingConversations')}</p> : sessions.length ? sessions.map(session => <label key={session.id}>
                <input type="checkbox" checked={sourceThreadIds.includes(session.id)} disabled={!sourceThreadIds.includes(session.id) && sourceThreadIds.length >= 5}
                  onChange={event => setSourceThreadIds(current => event.target.checked ? [...current, session.id] : current.filter(id => id !== session.id))} />
                <span><strong>{session.title}</strong><small>{session.provider} · {formatDate(session.updatedAt)} · {session.rootPath}</small></span>
              </label>) : <p>{t('delegate.noConversations')}</p>}
            </div>
            <label className="delegation-memory-option"><input type="checkbox" checked={includeMemory} onChange={event => setIncludeMemory(event.target.checked)} /><span>{t('delegate.includeMemory')} <small>{t('delegate.includeMemoryHint')}</small></span></label>
          </details>
          <details className="delegation-evidence"><summary>{t('delegate.evidence')} <span>{t('delegate.evidenceLimit')}</span></summary><label>{t('delegate.evidencePaths')}<TextArea value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="docs/architecture.md" /></label><p>{t('delegate.evidenceHint')}</p></details>
        </section>
        <section className="delegation-panel" aria-labelledby="delegation-checkout-heading">
          <div className="delegation-section-heading"><span>02</span><div><h3 id="delegation-checkout-heading">{t('delegate.checkout')}</h3><p>{t('delegate.checkoutHint')}</p></div></div>
          <fieldset className="delegation-strategies"><legend>{t('delegate.strategy')}</legend>
            {(['existing', 'create', 'generated'] as const).map(value => <label key={value} data-selected={strategy === value}><input type="radio" name="delegation-branch" checked={strategy === value} onChange={() => { setStrategy(value); setPreview(null) }} />{t(`delegate.strategies.${value}`)}</label>)}
          </fieldset>
          <div className="delegation-branch-fields">
            {strategy === 'generated' ? <><label>{t('delegate.reference')}<TextField value={reference} onChange={event => { setReference(event.target.value); setPreview(null) }} placeholder="CARD-142" /></label><label>{t('delegate.template')}<TextField value={template} onChange={event => { setTemplate(event.target.value); setPreview(null) }} /></label></>
              : <label>{t('delegate.exactBranch')}<TextField value={branch} onChange={event => { setBranch(event.target.value); setPreview(null) }} placeholder="feature/CARD-142-login" /></label>}
            {strategy !== 'existing' && <label>{t('delegate.baseRef')}<TextField value={baseRef} onChange={event => { setBaseRef(event.target.value); setPreview(null) }} placeholder={t('delegate.baseRefPlaceholder')} /></label>}
          </div>
          <div className="delegation-options">
            {strategy === 'existing' && <Checkbox checked={reuse} onChange={event => setReuse(event.target.checked)} label={t('delegate.reuse')} />}
            <Checkbox checked={fetchBase} onChange={event => setFetchBase(event.target.checked)} label={t('delegate.fetch')} />
            {fetchBase && <label className="delegation-remote-field">{t('delegate.remote')}<TextField value={remote} onChange={event => { setRemote(event.target.value); setPreview(null) }} placeholder="origin" /></label>}
          </div>
          {preview && <section className="delegation-preview" aria-label={t('delegate.previewLabel')}><header><Waypoints size={14} /><strong>{preview.ready ? t('delegate.ready') : t('delegate.notReady')}</strong></header>
            <dl><div><dt>{t('delegate.branch')}</dt><dd><GitBranch size={12} />{preview.checkout.branch}</dd></div><div><dt>{t('delegate.base')}</dt><dd>{preview.checkout.baseRef} · {preview.checkout.baseSha.slice(0, 12)}</dd></div><div><dt>{t('delegate.worktree')}</dt><dd>{preview.checkout.path}</dd></div></dl>
            {!preview.ready && <p>{t('delegate.enableFirst')}</p>}
          </section>}
        </section>
      </div>
      {error && <Notice intent="danger" className="delegation-preview-error">{error}</Notice>}
    </div>
  </Dialog>
}
