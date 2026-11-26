import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, GitBranch, RefreshCw, Waypoints } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DelegationBranchIntent, DelegationPreflight, DelegationTask } from '../../../shared/types/delegation'
import type { AgentProfile } from '../../../shared/types/agent'
import type { ConversationThread } from '../../../shared/types/thread'
import './DelegationCreateDialog.css'
import { Badge, Button, Checkbox, Dialog, Notice, SegmentedControl, Select, TextArea, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDate } from '../../utils/formatTime'

function RequiredLabel({ children }: { children: ReactNode }) {
  return <span className="delegation-required" data-required="true">{children}</span>
}

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
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const sourcesToggledByUser = useRef(false)
  const [evidenceExpanded, setEvidenceExpanded] = useState(false)
  const [includeMemory, setIncludeMemory] = useState(true)
  const [destinations, setDestinations] = useState<Array<{ workspaceId: string; name: string }>>([])
  const [targetId, setTargetId] = useState(workspaceId)
  const [preview, setPreview] = useState<DelegationPreflight | null>(null)
  const [error, setError] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [creating, setCreating] = useState(false)
  const busy = previewing || creating

  useEffect(() => {
    let active = true
    void window.oxe.agent.list().then(all => {
      if (!active) return
      const supported = all.filter(profile => ['claude', 'codex'].includes(profile.parentProvider ?? profile.provider))
      setProfiles(supported)
      setProfileId(supported.find(profile => profile.provider === thread?.provider)?.agentProfileId ?? supported[0]?.agentProfileId ?? '')
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
    sourcesToggledByUser.current = false
    setSourcesExpanded(false)
    const threadApi = window.oxe.thread
    if (!threadApi) { setSessionsLoading(false); return }
    setSessionsLoading(true)
    void threadApi.list().then(async allSessions => {
      if (!active) return
      const list = allSessions
        .filter(item => threadProjectId ? item.projectId === threadProjectId : item.workspaceId === workspaceId)
        .filter(item => !item.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      setSessions(list)
      if (!sourcesToggledByUser.current && list.length > 0) setSourcesExpanded(true)
    }).catch(cause => { if (active) setError(t('delegate.loadFailed', { error: String(cause) })) })
      .finally(() => { if (active) setSessionsLoading(false) })
    return () => { active = false }
  }, [workspaceId, threadProjectId, t])

  const intent = useMemo<DelegationBranchIntent>(() => strategy === 'generated'
    ? { strategy, reference: reference.trim() || undefined, template: template.trim() || undefined, baseRef: baseRef.trim() || undefined, remote: remote.trim() || undefined, fetchBase }
    : { strategy, name: branch || undefined, baseRef: baseRef.trim() || undefined, remote: remote.trim() || undefined, reuseExistingWorktree: reuse, fetchBase }, [strategy, reference, template, branch, baseRef, remote, reuse, fetchBase])

  useEffect(() => { revision.current++; setPreview(null) }, [intent, objective, targetId])

  const hasObjective = Boolean(objective.trim())
  const hasHandoff = Boolean(handoff.trim())
  const hasAcceptance = Boolean(acceptance.trim())
  const hasBranch = strategy === 'generated' || Boolean(branch.trim())
  const canPreview = !busy && hasObjective && hasBranch
  const canCreate = !busy && Boolean(profileId) && Boolean(preview?.ready) && hasHandoff && hasAcceptance

  const previewCue = !hasObjective && !hasBranch
    ? t('delegate.previewRequiresBoth')
    : !hasObjective
      ? t('delegate.previewRequiresObjective')
      : !hasBranch
        ? t('delegate.previewRequiresBranch')
        : null

  const createBlockedHint = busy
    ? null
    : !preview
      ? (!hasObjective || !hasBranch ? t('delegate.createHintFields') : t('delegate.createHintPreview'))
      : !preview.ready
        ? t('delegate.notReady')
        : !hasHandoff || !hasAcceptance
          ? t('delegate.createHintBrief')
          : null

  const inspect = async () => {
    setPreviewing(true); setError(''); setPreview(null)
    const current = ++revision.current
    try {
      const result = await window.oxe.delegation.preview(targetId, objective, intent)
      if (current === revision.current) {
        setPreview(result)
        if (strategy === 'generated') {
          try { localStorage.setItem(`oxe.delegation.template.${workspaceId}`, template) } catch { /* Preferences are optional. */ }
        }
      }
    } catch (cause) { setError(humanizeError(cause, t('delegate.checkoutFailed'))) }
    finally { setPreviewing(false) }
  }

  const create = async () => {
    if (!preview) return
    setCreating(true); setError('')
    try {
      const task = await window.oxe.delegation.create(workspaceId, origin, {
        schemaVersion: 2, key: requestKey.current,
        agentProfileId: profileId, objective: objective.trim(), handoff: handoff.trim(), acceptance: acceptance.trim(),
        targetWorkspaceId: targetId, surface, mode, evidenceFiles: evidence.split(/\r?\n/).map(path => path.trim()).filter(Boolean),
        branchIntent: intent, previewId: preview.previewId, sourceThreadIds, includeMemory
      })
      onCreated?.(task); onClose()
    } catch (cause) { setError(humanizeError(cause)) }
    finally { setCreating(false) }
  }

  const strategyOptions = useMemo(() => (['existing', 'create', 'generated'] as const).map(value => ({
    value,
    label: t(`delegate.strategies.${value}`)
  })), [t])

  return <Dialog size="xl" title={t('delegate.title')} description={t('delegate.description')} onClose={() => { if (!busy) onClose() }}
    footer={<>
      {createBlockedHint && <span className="delegation-footer-hint" data-align="start">{createBlockedHint}</span>}
      <Button variant="secondary" disabled={busy} onClick={onClose}>{t('ui.cancel', { ns: 'common' })}</Button>
      <Button variant="primary" loading={creating} disabled={!canCreate} onClick={() => void create()}>{t('delegate.create')}</Button>
    </>}>
    <div className="delegation-form-body">
      <div className="delegation-context-row">
        <Select className="delegation-control" label={t('delegate.agent')} value={profileId} disabled={busy} onChange={event => setProfileId(event.target.value)}>
          {profiles.map(profile => <option key={profile.agentProfileId} value={profile.agentProfileId}>{profile.name}</option>)}
        </Select>
        <Select className="delegation-control" label={t('delegate.destination')} value={targetId} disabled={busy} onChange={event => { setTargetId(event.target.value); if (event.target.value.startsWith('thread:')) setSurface('thread') }}>
          <option value={workspaceId}>{t('delegate.thisProject')}</option>
          {destinations.filter(target => target.workspaceId !== workspaceId).map(target => <option key={target.workspaceId} value={target.workspaceId}>{target.name}</option>)}
        </Select>
        <Select className="delegation-control" label={t('delegate.mode')} value={mode} disabled={busy} onChange={event => setMode(event.target.value as typeof mode)}>
          <option value="isolated-change">{t('delegate.modeChange')}</option>
          <option value="analysis">{t('delegate.modeAnalysis')}</option>
        </Select>
        <Select className="delegation-control" label={t('delegate.openIn')} value={surface} disabled={busy} onChange={event => setSurface(event.target.value as typeof surface)}>
          <option value="thread">{t('delegate.surfaceThread')}</option>
          {!targetId.startsWith('thread:') && <option value="terminal">{t('delegate.surfaceTerminal')}</option>}
        </Select>
      </div>

      <div className="delegation-columns">
        <section className="delegation-panel" aria-labelledby="delegation-task-heading">
          <div className="delegation-section-heading">
            <span className="delegation-step-badge" aria-hidden="true">01</span>
            <div>
              <h3 id="delegation-task-heading">{t('delegate.brief')}</h3>
              <p>{t('delegate.briefHint')}</p>
            </div>
          </div>

          <TextArea
            label={<RequiredLabel>{t('delegate.objective')}</RequiredLabel>}
            className="delegation-objective"
            value={objective}
            maxLength={2000}
            rows={2}
            required
            disabled={busy}
            onChange={event => { setObjective(event.target.value); setPreview(null) }}
            placeholder={t('delegate.objectivePlaceholder')}
          />

          <TextArea
            label={<RequiredLabel>{t('delegate.handoff')}</RequiredLabel>}
            className="delegation-handoff"
            value={handoff}
            maxLength={16000}
            rows={4}
            required
            disabled={busy}
            onChange={event => setHandoff(event.target.value)}
            placeholder={t('delegate.handoffPlaceholder')}
          />

          <TextArea
            label={<RequiredLabel>{t('delegate.acceptance')}</RequiredLabel>}
            className="delegation-acceptance"
            value={acceptance}
            maxLength={2000}
            rows={3}
            required
            disabled={busy}
            onChange={event => setAcceptance(event.target.value)}
            placeholder={t('delegate.acceptancePlaceholder')}
          />

          <details className="delegation-disclosure delegation-sources" open={sourcesExpanded} onToggle={event => setSourcesExpanded(event.currentTarget.open)}>
            <summary className="delegation-disclosure-summary" onClick={() => { sourcesToggledByUser.current = true }}>
              {sourcesExpanded
                ? <ChevronDown size={14} className="delegation-disclosure-chevron" aria-hidden="true" />
                : <ChevronRight size={14} className="delegation-disclosure-chevron" aria-hidden="true" />}
              <span className="delegation-disclosure-title">{t('delegate.knowledge')}</span>
              <span className="delegation-disclosure-meta">{t('delegate.knowledgeSummary', { count: sourceThreadIds.length, memory: includeMemory ? t('delegate.memoryOn') : t('delegate.memoryOff') })}</span>
            </summary>
            <div className="delegation-disclosure-body">
              <p className="delegation-disclosure-hint">{t('delegate.knowledgeHint')}</p>
              <div className="delegation-session-list">
                {sessionsLoading ? <p className="delegation-disclosure-hint">{t('delegate.loadingConversations')}</p>
                  : sessions.length ? sessions.map(session => {
                    const checked = sourceThreadIds.includes(session.id)
                    return <div key={session.id} className="delegation-session-item" data-checked={checked ? 'true' : undefined}>
                      <Checkbox
                        className="delegation-session-check"
                        checked={checked}
                        disabled={busy || (!checked && sourceThreadIds.length >= 5)}
                        onChange={event => setSourceThreadIds(current => event.target.checked ? [...current, session.id] : current.filter(id => id !== session.id))}
                        label={<span className="delegation-session-meta"><strong>{session.title}</strong><small>{session.provider} · {formatDate(session.updatedAt)} · {session.rootPath}</small></span>}
                      />
                    </div>
                  }) : <p className="delegation-disclosure-hint">{t('delegate.noConversations')}</p>}
              </div>
              <Checkbox
                className="delegation-memory-option"
                checked={includeMemory}
                disabled={busy}
                onChange={event => setIncludeMemory(event.target.checked)}
                label={<span className="delegation-memory-text"><span>{t('delegate.includeMemory')}</span><small>{t('delegate.includeMemoryHint')}</small></span>}
              />
            </div>
          </details>

          <details className="delegation-disclosure delegation-evidence" open={evidenceExpanded} onToggle={event => setEvidenceExpanded(event.currentTarget.open)}>
            <summary className="delegation-disclosure-summary">
              {evidenceExpanded
                ? <ChevronDown size={14} className="delegation-disclosure-chevron" aria-hidden="true" />
                : <ChevronRight size={14} className="delegation-disclosure-chevron" aria-hidden="true" />}
              <span className="delegation-disclosure-title">{t('delegate.evidence')}</span>
              <span className="delegation-disclosure-meta">{t('delegate.evidenceLimit')}</span>
            </summary>
            <div className="delegation-disclosure-body">
              <TextArea
                label={t('delegate.evidencePaths')}
                hint={t('delegate.evidenceHint')}
                value={evidence}
                rows={3}
                mono
                disabled={busy}
                onChange={event => setEvidence(event.target.value)}
                placeholder="docs/architecture.md"
              />
            </div>
          </details>
        </section>

        <section className="delegation-panel" aria-labelledby="delegation-checkout-heading">
          <div className="delegation-section-heading">
            <span className="delegation-step-badge" aria-hidden="true">02</span>
            <div>
              <h3 id="delegation-checkout-heading">{t('delegate.checkout')}</h3>
              <p>{t('delegate.checkoutHint')}</p>
            </div>
          </div>

          <div className="delegation-strategy-group">
            <span className="delegation-field-label">{t('delegate.strategy')}</span>
            <SegmentedControl
              className="delegation-strategy-control"
              label={t('delegate.strategy')}
              value={strategy}
              disabled={busy}
              onChange={next => { setStrategy(next); setPreview(null) }}
              options={strategyOptions}
            />
          </div>

          <div className="delegation-branch-fields">
            {strategy === 'generated' ? <>
              <TextField className="delegation-control" label={t('delegate.reference')} value={reference} disabled={busy} onChange={event => { setReference(event.target.value); setPreview(null) }} placeholder="CARD-142" />
              <TextField className="delegation-control" label={t('delegate.template')} value={template} mono disabled={busy} onChange={event => { setTemplate(event.target.value); setPreview(null) }} />
            </> : <TextField
              className="delegation-control"
              label={<RequiredLabel>{t('delegate.exactBranch')}</RequiredLabel>}
              value={branch}
              mono
              required
              disabled={busy}
              onChange={event => { setBranch(event.target.value); setPreview(null) }}
              placeholder="feature/CARD-142-login"
            />}
            {strategy !== 'existing' && (
              <TextField className="delegation-control" label={t('delegate.baseRef')} value={baseRef} mono disabled={busy} onChange={event => { setBaseRef(event.target.value); setPreview(null) }} placeholder={t('delegate.baseRefPlaceholder')} />
            )}
          </div>

          <div className="delegation-options">
            {strategy === 'existing' && (
              <Checkbox checked={reuse} disabled={busy} onChange={event => setReuse(event.target.checked)} label={t('delegate.reuse')} />
            )}
            <Checkbox checked={fetchBase} disabled={busy} onChange={event => setFetchBase(event.target.checked)} label={t('delegate.fetch')} />
            {fetchBase && (
              <TextField className="delegation-control" label={t('delegate.remote')} value={remote} mono disabled={busy} onChange={event => { setRemote(event.target.value); setPreview(null) }} placeholder="origin" />
            )}
          </div>

          <section className="delegation-preview-card" data-ready={preview ? String(preview.ready) : 'pending'} aria-label={t('delegate.previewLabel')}>
            {preview ? <>
              <header className="delegation-preview-header">
                <div className="delegation-preview-status">
                  {preview.ready
                    ? <CheckCircle2 size={15} className="delegation-preview-icon-ready" aria-hidden="true" />
                    : <AlertTriangle size={15} className="delegation-preview-icon-warn" aria-hidden="true" />}
                  <strong>{preview.ready ? t('delegate.ready') : t('delegate.notReady')}</strong>
                </div>
                <Button size="sm" variant="secondary" icon={<RefreshCw size={12} aria-hidden="true" />} loading={previewing} disabled={!canPreview} onClick={() => void inspect()}>
                  {t('delegate.preview')}
                </Button>
              </header>
              <dl className="delegation-preview-meta">
                <div>
                  <dt>{t('delegate.branch')}</dt>
                  <dd><GitBranch size={12} aria-hidden="true" /><code>{preview.checkout.branch}</code></dd>
                </div>
                <div>
                  <dt>{t('delegate.base')}</dt>
                  <dd><code>{preview.checkout.baseRef} · {preview.checkout.baseSha.slice(0, 12)}</code></dd>
                </div>
                <div>
                  <dt>{t('delegate.worktree')}</dt>
                  <dd><code>{preview.checkout.path}</code></dd>
                </div>
              </dl>
              {!preview.ready && <Notice intent="warning">{t('delegate.enableFirst')}</Notice>}
            </> : <>
              <header className="delegation-preview-header">
                <div className="delegation-preview-status">
                  <Waypoints size={15} className="delegation-preview-icon" aria-hidden="true" />
                  <strong>{t('delegate.previewTitle')}</strong>
                </div>
                <Badge>{t('delegate.previewPending')}</Badge>
              </header>
              <p className="delegation-preview-hint">{t('delegate.previewEmptyHint')}</p>
              <div className="delegation-preview-actions">
                <Button variant="secondary" icon={<Waypoints size={14} aria-hidden="true" />} loading={previewing} disabled={!canPreview} onClick={() => void inspect()}>
                  {t('delegate.preview')}
                </Button>
                {previewCue && <span className="delegation-preview-cue">{previewCue}</span>}
              </div>
            </>}
          </section>
        </section>
      </div>

      {error && <Notice intent="danger" className="delegation-preview-error">{error}</Notice>}
    </div>
  </Dialog>
}
