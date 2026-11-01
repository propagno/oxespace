import { useEffect, useRef, useState } from 'react'
import { GitBranch, Plus, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DelegationTask, DelegationRecoveryAction } from '../../../shared/types/delegation'
import type { Workspace } from '../../../shared/types/workspace'
import { DelegationCreateDialog } from './DelegationCreateDialog'
import './DelegatedWorkDialog.css'
import { Button, ConfirmDialog, Dialog, Notice, Select, TextField } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'
import { formatDateTime } from '../../utils/formatTime'

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
  return <><Dialog className="delegated-work-dialog" size="lg" title={t('delegated.title')} description={t('delegated.description')} onClose={onClose}>
    <div className="delegated-work-toolbar">
      <Select aria-label={t('delegated.project')} value={selectedWorkspace} onChange={event => setSelectedWorkspace(event.target.value)}>{workspaces.map(workspace => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</Select>
      <label><Search size={14} /><TextField aria-label={t('delegated.search')} placeholder={t('delegated.searchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <Button variant="primary" icon={<Plus size={14} />} disabled={!origin} onClick={() => setCreating(true)}>{t('delegate.title')}</Button>
    </div>
    {error && <Notice intent="danger">{error}</Notice>}
    <div className="delegated-work-list" aria-busy={busy}>
      {!filtered.length && <p>{busy ? t('delegated.loading') : query ? t('delegated.noMatches') : t('delegated.empty')}</p>}
      {filtered.map(task => <article key={task.id}>
        <header><strong>{task.objective}</strong><span data-state={task.state}>{t(`delegated.states.${task.state}`, { defaultValue: task.state })}</span></header>
        <p className="delegated-work-branch"><GitBranch size={14} />{task.branch}</p>
        <p>{task.nativeSession?.provider ?? task.agentProfileId} · {task.surface === 'thread' ? t('delegated.surfaceThread') : t('delegated.surfaceTerminal')} · {formatDateTime(task.updatedAt)}</p>
        {task.lastReport && <p>{task.lastReport}</p>}
        {task.error && <Notice intent="danger">{task.error}</Notice>}
        <div className="delegated-work-actions">
          <Button size="sm" disabled={!task.destinationThreadId && !task.paneId} onClick={() => { void onOpen(task).then(opened => { if (!opened) setError(task.destinationThreadId ? t('delegated.openConversationFailed') : t('delegated.terminalGone')) }) }}>{task.destinationThreadId ? t('delegated.openConversation') : t('delegated.openTerminal')}</Button>
          {origin && workspaceId === (task.originWorkspaceId ?? task.workspaceId) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
            setBusy(true); setError('')
            void window.oxe.delegation.adopt(workspaceId, task.id, origin.kind === 'thread' ? `thread:${origin.id}` : origin.id)
              .catch(cause => setError(String(cause))).finally(() => setBusy(false))
          }}>{origin.kind === 'thread' ? t('delegated.reconnectConversation') : t('delegated.reconnectTerminal')}</Button>}
          {workspaceId === (task.originWorkspaceId ?? task.workspaceId) && (task.recoveryActions ?? []).filter(action => !['open', 'continue'].includes(action)).map(action => <Button size="sm" variant={action === 'cancel' ? 'ghost' : 'secondary'} key={action} disabled={busy} onClick={() => { if (action === 'new-session' || action === 'cancel') setConfirming({ task, action }); else void act(task, action) }}>{t(`delegated.actions.${action as 'resume'}`)}</Button>)}
        </div>
        <details><summary>{t('delegated.details')}</summary><dl>
          <dt>{t('delegated.taskId')}</dt><dd>{task.id}</dd><dt>{t('delegated.sessionId')}</dt><dd>{task.nativeSession?.nativeSessionId ?? t('delegated.notObserved')}</dd>
          <dt>{t('delegate.worktree')}</dt><dd>{task.path}</dd><dt>{t('delegated.baseCommit')}</dt><dd>{task.baseSha}</dd>
          <dt>{t('delegated.origin')}</dt><dd>{task.originCwd ?? task.cwd}</dd><dt>{t('delegated.handoffRevision')}</dt><dd>{task.knowledgeBundle?.revision ?? 1}</dd>
        </dl><h4>{t('delegated.knowledge')}</h4>{task.knowledgeBundle?.sources.length ? <ul>{task.knowledgeBundle.sources.map((source, index) => <li key={`${source.kind}-${index}`}><strong>{source.kind === 'memory' ? 'AI Memory' : source.kind === 'session' ? t('delegated.conversation') : source.kind}</strong><span>{source.label}</span></li>)}</ul> : <p>{t('delegated.noKnowledge')}</p>}{task.includeMemory && task.knowledgeBundle && !task.knowledgeBundle.sources.some(source => source.kind === 'memory') && <p role="status">{t('delegated.memoryEmpty')}</p>}<pre>{task.context ?? task.handoff}</pre></details>
      </article>)}
    </div>
    {cursor && <Button className="delegated-work-more" disabled={busy} onClick={() => {
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
