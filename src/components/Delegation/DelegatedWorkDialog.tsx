import { useEffect, useRef, useState } from 'react'
import { ChevronRight, GitBranch, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { DelegationRecoveryAction, DelegationState, DelegationTask } from '../../../shared/types/delegation'
import type { Workspace } from '../../../shared/types/workspace'
import { DelegationCreateDialog } from './DelegationCreateDialog'
import './DelegatedWorkDialog.css'
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, LoadingState, Notice, SearchInput, Select, type Intent } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime } from '../../utils/formatTime'

function stateIntent(state: DelegationState): Intent {
  switch (state) {
    case 'approved': return 'success'
    case 'review': return 'attention'
    case 'accepted':
    case 'starting':
    case 'preparing': return 'info'
    case 'blocked':
    case 'interrupted': return 'warning'
    case 'failed': return 'danger'
    case 'cancelled': return 'neutral'
  }
}

function renderDependencyLine(task: DelegationTask, t: TFunction<'code'>) {
  const deps = task.dependencies ?? []
  if (!deps.length) return null
  const failed = deps.find(d => ['failed', 'cancelled', 'interrupted'].includes(d.state))
  if (failed) {
    const obj = failed.objective.length > 60 ? failed.objective.slice(0, 59) + '…' : failed.objective
    return <p className="delegated-work-dependency text-danger">{t('delegated.blocked', { objective: obj })}</p>
  }
  const waiting = deps.filter(d => d.state !== 'approved')
  if (!waiting.length) return null
  const firstObj = waiting[0].objective.length > 60 ? waiting[0].objective.slice(0, 59) + '…' : waiting[0].objective
  if (waiting.length === 1) {
    return <p className="delegated-work-dependency text-secondary">{t('delegated.waitsForOne', { objective: firstObj })}</p>
  }
  return <p className="delegated-work-dependency text-secondary" title={waiting.map(d => d.objective).join(', ')}>{t('delegated.waitsForMany', { first: firstObj, count: waiting.length - 1 })}</p>
}

export function DelegatedWorkDialog({ workspaces, workspaceId, focusTaskId, origin, onClose, onOpen }: {
  workspaces: Workspace[]; workspaceId: string; focusTaskId?: string | null; origin?: { kind: 'pane' | 'thread'; id: string }
  onClose(): void; onOpen(task: DelegationTask): Promise<boolean>
}) {
  const { t } = useTranslation('code')
  const [selectedWorkspace, setSelectedWorkspace] = useState(workspaceId || workspaces[0]?.id || '')
  const [tasks, setTasks] = useState<DelegationTask[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [query, setQuery] = useState(focusTaskId ?? ''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState<{ task: DelegationTask; action: 'new-session' | 'cancel' } | null>(null)
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
    setBusy(true); setError('')
    try {
      await window.oxe.delegation.control(task.originWorkspaceId ?? task.workspaceId, task.id, action)
      const page = await window.oxe.delegation.status(selectedWorkspace, undefined, 50)
      setTasks(page.tasks); setCursor(page.nextCursor ?? null)
    } catch (cause) { setError(humanizeError(cause)) }
    finally { setBusy(false) }
  }

  const filtered = tasks.filter(task => `${task.id} ${task.objective} ${task.branch} ${task.state} ${task.nativeSession?.nativeSessionId ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  if (creating && origin) return <DelegationCreateDialog workspaceId={workspaceId} origin={origin} onClose={() => setCreating(false)} />

  return <><Dialog size="lg" title={t('delegated.title')} description={t('delegated.description')} onClose={onClose}>
    <div className="delegated-work-toolbar">
      <Select aria-label={t('delegated.project')} value={selectedWorkspace} onChange={event => setSelectedWorkspace(event.target.value)}>
        {workspaces.map(workspace => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}
      </Select>
      <SearchInput
        aria-label={t('delegated.search')}
        clearLabel={t('nav.clearSearch', { ns: 'common' })}
        placeholder={t('delegated.searchPlaceholder')}
        value={query}
        onChange={setQuery}
      />
      <Button variant="primary" icon={<Plus size={14} aria-hidden="true" />} disabled={!origin} onClick={() => setCreating(true)}>{t('delegate.title')}</Button>
    </div>
    {error && <Notice intent="danger" className="delegated-work-error">{error}</Notice>}
    <div className="delegated-work-list" aria-busy={busy}>
      {!filtered.length && (busy
        ? <LoadingState label={t('delegated.loading')} />
        : <EmptyState compact title={query ? t('delegated.noMatches') : t('delegated.empty')} />)}
      {filtered.map(task => <article key={task.id} className="delegated-work-card">
        <header className="delegated-work-card-header">
          <strong>{task.objective}</strong>
          <Badge intent={stateIntent(task.state)} data-state={task.state}>{t(`delegated.states.${task.state}`)}</Badge>
        </header>
        <p className="delegated-work-branch"><GitBranch size={13} aria-hidden="true" /><code>{task.branch}</code></p>
        {renderDependencyLine(task, t)}
        <p className="delegated-work-meta">{task.nativeSession?.provider ?? task.agentProfileId} · {task.surface === 'thread' ? t('delegated.surfaceThread') : t('delegated.surfaceTerminal')} · {formatDateTime(task.updatedAt)}</p>
        {task.lastReport && <p className="delegated-work-report">{task.lastReport}</p>}
        {task.error && <Notice intent="danger">{task.error}</Notice>}
        <div className="delegated-work-actions">
          <Button size="sm" variant="secondary" disabled={!task.destinationThreadId && !task.paneId} onClick={() => {
            void onOpen(task).then(opened => { if (!opened) setError(task.destinationThreadId ? t('delegated.openConversationFailed') : t('delegated.terminalGone')) })
          }}>{task.destinationThreadId ? t('delegated.openConversation') : t('delegated.openTerminal')}</Button>
          {origin && workspaceId === (task.originWorkspaceId ?? task.workspaceId) && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
              setBusy(true); setError('')
              void window.oxe.delegation.adopt(workspaceId, task.id, origin.kind === 'thread' ? `thread:${origin.id}` : origin.id)
                .catch(cause => setError(String(cause))).finally(() => setBusy(false))
            }}>{origin.kind === 'thread' ? t('delegated.reconnectConversation') : t('delegated.reconnectTerminal')}</Button>
          )}
          {workspaceId === (task.originWorkspaceId ?? task.workspaceId) && (task.recoveryActions ?? []).filter(action => !['open', 'continue'].includes(action)).map(action => (
            <Button size="sm" variant="secondary" key={action} disabled={busy} onClick={() => {
              if (action === 'new-session' || action === 'cancel') setConfirming({ task, action })
              else void act(task, action)
            }}>{t(`delegated.actions.${action as 'resume'}`)}</Button>
          ))}
        </div>
        <details className="delegated-work-details">
          <summary className="delegated-work-summary">
            <ChevronRight size={14} className="delegated-work-chevron" aria-hidden="true" />
            <span>{t('delegated.details')}</span>
          </summary>
          <div className="delegated-work-details-body">
            <dl>
              <dt>{t('delegated.taskId')}</dt><dd>{task.id}</dd>
              <dt>{t('delegated.sessionId')}</dt><dd>{task.nativeSession?.nativeSessionId ?? t('delegated.notObserved')}</dd>
              <dt>{t('delegate.worktree')}</dt><dd>{task.path}</dd>
              <dt>{t('delegated.baseCommit')}</dt><dd>{task.baseSha}</dd>
              <dt>{t('delegated.origin')}</dt><dd>{task.originCwd ?? task.cwd}</dd>
              <dt>{t('delegated.handoffRevision')}</dt><dd>{task.knowledgeBundle?.revision ?? 1}</dd>
            </dl>
            <div className="delegated-work-knowledge">
              <h4>{t('delegated.knowledge')}</h4>
              {task.knowledgeBundle?.sources.length
                ? <ul>{task.knowledgeBundle.sources.map((source, index) => <li key={`${source.kind}-${index}`}><strong>{t(`delegated.sourceKind.${source.kind}`)}</strong><span>{source.label}</span></li>)}</ul>
                : <p>{t('delegated.noKnowledge')}</p>}
              {task.includeMemory && task.knowledgeBundle && !task.knowledgeBundle.sources.some(source => source.kind === 'memory') && (
                <p role="status">{t('delegated.memoryEmpty')}</p>
              )}
            </div>
            <pre>{task.context ?? task.handoff}</pre>
          </div>
        </details>
      </article>)}
    </div>
    {cursor && <Button variant="secondary" className="delegated-work-more" disabled={busy} onClick={() => {
      const version = ++request.current
      setBusy(true)
      void window.oxe.delegation.status(selectedWorkspace, cursor, 50).then(page => {
        if (version !== request.current) return
        setTasks(current => [...new Map([...current, ...page.tasks].map(task => [task.id, task])).values()]); setCursor(page.nextCursor ?? null)
      }).catch(cause => setError(String(cause))).finally(() => { if (version === request.current) setBusy(false) })
    }}>{t('delegated.loadMore')}</Button>}
  </Dialog>
  {confirming && <ConfirmDialog busy={busy}
    {...(confirming.action === 'new-session'
      ? { title: t('delegated.confirmNew.title'), confirmLabel: t('delegated.confirmNew.confirm'), description: t('delegated.confirmNew.description') }
      : { title: t('delegated.confirmCancel.title'), confirmLabel: t('delegated.actions.cancel'), cancelLabel: t('delegated.confirmCancel.keep'), danger: true, description: t('delegated.confirmCancel.description') })}
    onCancel={() => setConfirming(null)} onConfirm={() => { const { task, action } = confirming; setConfirming(null); void act(task, action) }} />}
  </>
}
