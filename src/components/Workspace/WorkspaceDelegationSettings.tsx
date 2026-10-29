import { useEffect, useState } from 'react'
import type { DelegationSnapshot } from '../../../shared/types/delegation'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import './WorkspaceMemorySettings.css'
import { Button, Checkbox, ConfirmDialog, EmptyState, ErrorState, TextField, Select } from '../../ui'
import { useTranslation } from 'react-i18next'
import { humanizeError } from '../../utils/humanizeError'
import { formatDate } from '../../utils/formatTime'

export function WorkspaceDelegationSettings({ workspaceId, paneIds, onOpenTerminal, onOpenDiagnostics }: { workspaceId: string; paneIds?: string[]; onOpenTerminal?: (paneId: string, workspaceId?: string) => void; onOpenDiagnostics?: () => void }) {
  const { t } = useTranslation('code')
  const [snapshot, setSnapshot] = useState<DelegationSnapshot>({ enabled: false, tasks: [] })
  // Approving a result and handing a task's control to a terminal are confirmed in a dialog, never one click.
  const [confirming, setConfirming] = useState<{ title: string; description: string; confirmLabel: string; run: () => Promise<void> } | null>(null)
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
    catch (e) { setError(humanizeError(e)) }
    finally { setBusy(false) }
  }
  return <section className="ws-settings-section memory-settings" aria-labelledby="delegation-title">
    <header className="ws-settings-section-header"><h3 id="delegation-title">{t('workspace.settings.pages.delegation.label')}</h3></header>
    <p>{t('delegation.intro')}</p>
    <Checkbox checked={snapshot.enabled} disabled={!ready || busy} onChange={e => { const enabled = e.target.checked; void act(() => window.oxe.delegation.configure(workspaceId,enabled)) }} label={t('delegation.allow')} />
    <p className="memory-privacy">{t('delegation.privacy')}</p>
    <details className="coordination-destinations">
      <summary>{t('delegation.manage', { count: snapshot.targets?.length ?? 0 })}</summary>
    <fieldset disabled={busy || !ready}>
      <legend>{t('delegation.destinations')}</legend>
      <p>{t('delegation.destinationsIntro')}</p>
      <label>{t('delegation.path')}<TextField value={targetPath} onChange={e => { setTargetPath(e.target.value); setConsent(false) }} placeholder={t('delegation.pathPlaceholder')} /></label>
      <Checkbox checked={allowEvidence} onChange={e => { setAllowEvidence(e.target.checked); setConsent(false) }} label={t('delegation.evidence')} />
      <Checkbox checked={consent} onChange={e => setConsent(e.target.checked)} label={allowEvidence ? t('delegation.consentEvidence') : t('delegation.consent')} />
      <p>{t('delegation.analysis')}</p>
      <Button variant="primary" disabled={!targetPath.trim() || !consent} onClick={() => void act(async () => {
        await window.oxe.delegation.configureTarget(workspaceId, targetPath, true, allowEvidence)
        setTargetPath(''); setConsent(false); await useWorkspaceStore.getState().bootstrap()
      })}>{t('delegation.authorize')}</Button>
      {(snapshot.targets ?? []).map(target => <article className="memory-feedback" key={target.workspaceId}>
        <strong>{target.name}</strong><p>{target.rootPath}</p>
        <p>{t('delegation.expires', { date: formatDate(target.expiresAt) })} · {target.allowEvidence ? t('delegation.evidenceOn') : t('delegation.evidenceOff')}</p>
        <button type="button" onClick={() => void act(() => window.oxe.delegation.configureTarget(workspaceId, target.rootPath, false, false))}>{t('delegation.revoke')}</button>
      </article>)}
    </fieldset>
    </details>
    {error && <ErrorState compact title={t('delegation.failed')} message={error} />}
    {onOpenDiagnostics && <button type="button" onClick={onOpenDiagnostics}>{t('delegation.diagnostics')}</button>}
    {!snapshot.tasks.length && <EmptyState compact title={t('delegation.none')} />}
    {snapshot.tasks.map(task => <article key={task.id} className="memory-feedback">
      <div className="memory-status-line"><strong>{task.objective}</strong><span className="memory-badge" data-state={task.state}>{t(`background.delegationState.${task.state}`)}</span></div>
      <p>{task.branch}</p>
      {task.originWorkspaceId && <p>{workspaces.find(w => w.id === task.originWorkspaceId)?.name ?? t('delegation.origin')} → {workspaces.find(w => w.id === task.workspaceId)?.name ?? t('delegation.destination')} · {task.mode ?? 'isolated-change'}</p>}
      {task.error && <p role="alert">{task.error}</p>}
      {task.lastReport && <p>{task.lastReport}</p>}
      {task.lastMessage && <p>{t('delegation.latest', { message: task.lastMessage })}</p>}
      <div className="memory-task-actions">
        {task.workspaceId !== workspaceId && <button type="button" onClick={() => void act(async () => {
          await useWorkspaceStore.getState().bootstrap()
          if (task.paneId && onOpenTerminal) { onOpenTerminal(task.paneId, task.workspaceId); return }
          await useWorkspaceStore.getState().setActiveWorkspace(task.workspaceId)
          if (task.paneId) useUIStore.getState().setActivePane(task.paneId)
          useUIStore.getState().closeWorkspaceSettings()
        })}>{t('delegation.openDestination')}</button>}
        {task.workspaceId === workspaceId && task.paneId && (!paneIds || paneIds.includes(task.paneId)) && <button type="button" onClick={() => {
          if (onOpenTerminal) onOpenTerminal(task.paneId!)
          else { useUIStore.getState().setActivePane(task.paneId!); useUIStore.getState().closeWorkspaceSettings() }
        }}>{t('delegation.openTerminal')}</button>}
        {(task.originWorkspaceId ?? task.workspaceId) === workspaceId && <>
          {['failed','interrupted'].includes(task.state) && task.nativeSession?.resumable && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'resume'))}>{t('delegation.resume')}</button>}
          {['failed','interrupted'].includes(task.state) && !task.nativeSession?.resumable && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'retry'))}>{t('delegation.retry')}</button>}
          {task.state === 'review' && <button type="button" disabled={busy} aria-haspopup="dialog" onClick={() => setConfirming({ title: t('delegation.approveTitle'), description: t('delegation.approveBody', { objective: task.objective }), confirmLabel: t('delegation.approve'), run: () => window.oxe.delegation.control(workspaceId,task.id,'approve') })}>{t('delegation.approveOpen')}</button>}
          {!['approved','cancelled'].includes(task.state) && <button type="button" disabled={busy} onClick={() => void act(() => window.oxe.delegation.control(workspaceId,task.id,'cancel'))}>{t('delegation.cancel')}</button>}
        </>}
      </div>
      {(task.originWorkspaceId ?? task.workspaceId) === workspaceId && <div>
        <label>{t('delegation.reconnect')}<Select value={adoptPane[task.id] ?? ''} onChange={e => setAdoptPane(value => ({ ...value, [task.id]: e.target.value }))}>
          <option value="">{t('delegation.selectTerminal')}</option>
          {sourcePanes.filter(p => p.id !== task.paneId).map(p => <option key={p.id} value={p.id}>{p.displayName ?? p.id}</option>)}
        </Select></label>
        <button type="button" disabled={busy || !adoptPane[task.id]} aria-haspopup="dialog" onClick={() => setConfirming({ title: t('delegation.adoptTitle'), description: t('delegation.adoptBody'), confirmLabel: t('delegation.adoptConfirm'), run: () => window.oxe.delegation.adopt(workspaceId, task.id, adoptPane[task.id]) })}>{t('delegation.adopt')}</button>
      </div>}
      {task.workspaceId === workspaceId && task.paneId && paneIds && !paneIds.includes(task.paneId) && <p>{t('delegation.closed')}</p>}
      {task.nativeSession && <p>{t('delegation.session')} <code>{task.nativeSession.nativeSessionId}</code> · {t('delegation.generation', { value: task.nativeSession.generation })}</p>}
      <p><code>{task.path}</code></p>
      {['preparing','starting'].includes(task.state) && <p role="status">{task.state === 'preparing' ? t('delegation.preparing') : task.surface === 'thread' ? t('delegation.threadStarted') : t('delegation.terminalStarted')}</p>}
      <details><summary>{t('delegation.handoff')}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.context ?? task.handoff}</pre></details>
    </article>)}
    {confirming && <ConfirmDialog title={confirming.title} description={confirming.description} confirmLabel={confirming.confirmLabel} busy={busy}
      onCancel={() => setConfirming(null)} onConfirm={() => { const run = confirming.run; setConfirming(null); void act(run) }} />}
  </section>
}
