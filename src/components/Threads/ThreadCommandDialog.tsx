import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { DelegationTask } from '../../../shared/types/delegation'
import { useThreadStore } from '../../store/thread.store'
import { DetailList } from '../Navigation/DetailList'
import { ThreadUsageDetails } from './ThreadFailureCard'
import ThreadEventsPanel from './ThreadEventsPanel'
import ThreadPermissionsPanel from './ThreadPermissionsPanel'
import ThreadUsagePanel from './ThreadUsagePanel'
import ThreadWorkPanel from './ThreadWorkPanel'
import type { ThreadPanelState } from './threadCommandPanels'
import { threadNavigationStatus } from './threadNavigationStatus'
import { Button, ConfirmDialog, Dialog, EmptyState, ErrorState, TextField } from '../../ui'
import { formatDateTime } from '../../utils/formatTime'
import { localizeConfirmation } from './threadConfirmationText'

function sessionDate(timestamp: number): string { return formatDateTime(timestamp, { dateStyle: 'medium', timeStyle: 'short' }) }

/** Integrated surfaces with a line under their title saying what they are for. Output panels have no description. */
const DESCRIBED = new Set(['rename', 'sessions', 'rules', 'work', 'events', 'spending', 'delegations'])
/** The shape of a native session ID, shown as the placeholder; the same in every language. */
const SESSION_ID_SHAPE = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
/** The rows /status sends, in the order shown, with their catalog keys; the main process names them in English. */
const STATUS_ROWS: Record<string, string> = { Provider: 'provider', 'Native session ID (resume)': 'nativeSession', Status: 'status', Model: 'model', Effort: 'effort', Access: 'access', Network: 'network', Approvals: 'approvals', Mode: 'mode', Connection: 'connection', Directory: 'directory' }
const INTERNAL_ROWS: Record<string, string> = { 'Conversation ID': 'threadId', 'Project ID': 'projectId', 'Workspace ID': 'workspaceId', Generation: 'generation', Operation: 'operation', Hooks: 'hooks' }

/** The dialog a desktop command opens: confirmations, command output, rename, resume, delegations and permission rules. Loaded on demand. */
export default function ThreadCommandDialog({ panel, snapshot, pending, error, onClose, onError, action, runCommand, onDelegations }: {
  panel: ThreadPanelState
  snapshot: ThreadSnapshot | null
  pending: boolean
  error: string
  onClose: () => void
  onError: (message: string) => void
  action: (run: () => Promise<unknown>) => Promise<void>
  runCommand: (text: string) => Promise<void>
  onDelegations?: () => void
}) {
  const { t } = useTranslation('thread')
  const [rename, setRename] = useState(snapshot?.thread.title ?? '')
  const [resumeQuery, setResumeQuery] = useState('')
  const [nativeResumeId, setNativeResumeId] = useState('')
  const api = window.oxe?.thread
  const canRename = !pending && Boolean(rename.trim()) && rename.trim() !== snapshot?.thread.title
  // A panel whose rows are commands explains them in its text: show it as prose, not as copyable output.
  const explanation = Boolean(panel.rows?.some(row => row.id))
  const output = panel.text !== undefined && !explanation
  const resume = panel.resume
  const resumeTasks = resume?.tasks ?? [], nativeSessions = resume?.nativeSessions ?? []
  const resumeMatches = (parts: Array<string | number | null | undefined>) => !resumeQuery.trim() || parts.some(value => String(value ?? '').toLowerCase().includes(resumeQuery.trim().toLowerCase()))
  const openDelegatedSession = async (task: DelegationTask) => {
    if (!task.destinationThreadId || !api) throw Error(t('commandDialog.noSavedConversation'))
    const originWorkspaceId = task.originWorkspaceId ?? task.workspaceId
    if (task.recoveryActions?.includes('resume') && snapshot?.thread.workspaceId === originWorkspaceId) await window.oxe.delegation.control(originWorkspaceId, task.id, 'resume')
    useThreadStore.getState().adopt(await api.read(task.destinationThreadId))
    onClose()
  }

  // Archive, delete and rewind: one question, Cancel and one action.
  if (panel.kind === 'confirm' && panel.confirm) {
    const confirm = localizeConfirmation(panel.confirm)
    return <ConfirmDialog cancelLabel={t('common.cancel')} title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} danger={confirm.danger} busy={pending} error={error}
      onCancel={onClose} onConfirm={() => void action(async () => { await runCommand(confirm.command); onClose() })} />
  }

  const footer = panel.surface === 'rename'
    ? <><Button onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="thread-rename-form" variant="primary" loading={pending} disabled={!canRename}>{t('commandDialog.rename')}</Button></>
    : !panel.surface && output && panel.externalUrl ? <Button onClick={() => window.open(panel.externalUrl, '_blank', 'noopener,noreferrer')}>{t('commandDialog.openBrowser')}</Button>
    : !panel.surface && output && panel.text ? <Button onClick={() => void navigator.clipboard.writeText(panel.text!).catch(() => onError(t('commandDialog.copyFailed')))}>{t('commandDialog.copy')}</Button>
    : undefined

  return <Dialog closeLabel={t('common.close')} className={`thread-command-dialog${panel.surface === 'sessions' ? ' thread-resume-dialog' : ''}`} size={panel.surface === 'sessions' || panel.surface === 'events' || panel.surface === 'spending' ? 'lg' : 'md'}
    title={panel.surface === 'sessions' ? t('commandDialog.resume') : panel.title === 'Conversation status' ? t('commandDialog.statusTitle') : panel.title || t('commandDialog.conversation')} description={panel.surface && DESCRIBED.has(panel.surface) ? t(`commandDialog.surface.${panel.surface as 'rename'}`) : undefined} onClose={onClose} footer={footer}>
    {error && <ErrorState compact title={error} />}
    {panel.surface === 'rename' ? <form id="thread-rename-form" className="thread-command-form" onSubmit={event => { event.preventDefault(); if (!canRename) return; void action(async () => { await runCommand(`/rename ${rename.trim()}`); onClose() }) }}>
      <label>{t('commandDialog.name')}<TextField aria-label={t('commandDialog.name')} value={rename} maxLength={120} autoFocus onFocus={event => event.currentTarget.select()} onChange={event => setRename(event.target.value)} /></label>
    </form>
    : panel.surface === 'rules' && snapshot ? <ThreadPermissionsPanel threadId={snapshot.thread.id} />
    : panel.surface === 'work' && snapshot ? <ThreadWorkPanel threadId={snapshot.thread.id} onOpenThread={threadId => { onClose(); void useThreadStore.getState().select(threadId) }} />
    : panel.surface === 'events' && snapshot ? <ThreadEventsPanel threadId={snapshot.thread.id} />
    : panel.surface === 'spending' && snapshot ? <ThreadUsagePanel threadId={snapshot.thread.id} />
    : panel.surface === 'sessions' ? <div className="thread-resume-sections">
      <label className="thread-resume-search">{t('commandDialog.find')}<TextField aria-label={t('commandDialog.find')} type="search" placeholder={t('commandDialog.findPlaceholder')} value={resumeQuery} onChange={event => setResumeQuery(event.target.value)} /></label>
      <section><h3>{t('commandDialog.saved')}</h3><p>{t('commandDialog.savedHint')}</p>
        <div className="thread-panel-list">{useThreadStore.getState().threads.filter(thread => thread.id !== snapshot?.thread.id && thread.provider === snapshot?.thread.provider && thread.rootPath === snapshot?.thread.rootPath && resumeMatches([thread.title, thread.nativeSessionId, thread.id, thread.status])).map(thread => <button key={thread.id} type="button" disabled={pending} onClick={() => void action(() => runCommand(`/resume ${thread.id}`))}><strong>{thread.title}</strong><span>{thread.nativeSessionId ? t('commandDialog.session', { id: thread.nativeSessionId }) : t('commandDialog.notStarted')} · {thread.archived ? t('commandDialog.archived') : threadNavigationStatus(thread).label}</span></button>)}
          {!useThreadStore.getState().threads.some(thread => thread.id !== snapshot?.thread.id && thread.provider === snapshot?.thread.provider && thread.rootPath === snapshot?.thread.rootPath && resumeMatches([thread.title, thread.nativeSessionId, thread.id, thread.status])) && <EmptyState compact title={resumeQuery ? t('commandDialog.noSavedMatch') : t('commandDialog.noSaved')} />}
        </div>
      </section>
      <section><h3>{t('commandDialog.delegated')}</h3>{resume?.notice && <p role="status">{resume.notice}</p>}
        <div className="thread-panel-list">{resumeTasks.filter(task => resumeMatches([task.objective, task.branch, task.state, task.id, task.nativeSession?.nativeSessionId])).map(task => <button key={task.id} type="button" disabled={pending || !task.destinationThreadId} onClick={() => void action(() => openDelegatedSession(task))}><strong>{task.objective}</strong><span>{task.branch} · {task.state} · {task.nativeSession?.provider ?? task.agentProfileId}</span><span>{task.nativeSession?.nativeSessionId ? t('commandDialog.session', { id: task.nativeSession.nativeSessionId }) : t('commandDialog.noNativeId')}</span></button>)}
          {!resumeTasks.some(task => resumeMatches([task.objective, task.branch, task.state, task.id, task.nativeSession?.nativeSessionId])) && <EmptyState compact title={resumeQuery ? t('commandDialog.noDelegatedMatch') : t('commandDialog.noDelegated')} />}
        </div>
        {onDelegations && <Button variant="link" size="sm" className="thread-resume-all" onClick={() => { onClose(); onDelegations() }}>{t('commandDialog.openDelegated')}</Button>}
      </section>
      <section><h3>{t('commandDialog.nativeTitle', { provider: snapshot?.thread.provider === 'codex' ? 'Codex' : 'Claude' })}</h3><p>{t('commandDialog.nativeHint')}</p>
        {resume?.nativeNotice && <p role="status">{resume.nativeNotice}</p>}
        <div className="thread-panel-list thread-native-session-list">{nativeSessions.filter(session => resumeMatches([session.firstMessagePreview, session.modelId, session.sessionId, formatDateTime(session.sessionStartedAtMs), formatDateTime(session.lastUpdatedMs)])).map(session => <button key={session.sessionId} type="button" disabled={pending} onClick={() => void action(() => runCommand(`/resume ${session.sessionId}`))}><strong>{session.firstMessagePreview || t('commandDialog.providerSession', { provider: session.provider === 'codex' ? 'Codex' : 'Claude' })}</strong><span className="thread-session-meta"><span>{t('commandDialog.updated', { date: sessionDate(session.lastUpdatedMs) })}</span><span>{session.modelId || t('commandDialog.modelUnknown')}</span>{session.requestCount > 0 && <span>{t('commandDialog.requests', { count: session.requestCount })}</span>}</span><span className="thread-session-foot"><span>{t('commandDialog.started', { date: sessionDate(session.sessionStartedAtMs) })}</span><code>{session.sessionId}</code></span></button>)}
          {!nativeSessions.some(session => resumeMatches([session.firstMessagePreview, session.modelId, session.sessionId, formatDateTime(session.sessionStartedAtMs), formatDateTime(session.lastUpdatedMs)])) && !resume?.nativeNotice && <EmptyState compact title={resumeQuery ? t('commandDialog.noNativeMatch') : t('commandDialog.noNative')} />}
        </div>
      </section>
      <section><h3>{t('commandDialog.exactTitle')}</h3><p>{t('commandDialog.exactHint')}</p>
        <form className="thread-resume-native" onSubmit={event => { event.preventDefault(); void action(() => runCommand(`/resume ${nativeResumeId.trim()}`)) }}><label className="thread-resume-native-label">{t('commandDialog.nativeId')}<TextField aria-label={t('commandDialog.nativeId')} value={nativeResumeId} onChange={event => setNativeResumeId(event.target.value)} placeholder={SESSION_ID_SHAPE} /></label><Button type="submit" disabled={pending || !nativeResumeId.trim()}>{t('commandDialog.openSession')}</Button></form>
      </section>
    </div>
    : panel.surface === 'delegations' ? <div className="thread-panel-list">{panel.rows?.length ? panel.rows.map((row, index) => <button key={index} type="button" disabled={pending || !row.id} onClick={() => { if (row.id) { onClose(); void useThreadStore.getState().select(row.id) } }}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button>) : <EmptyState compact title={t('commandDialog.noDelegations')} />}</div>
    : <>{panel.text !== undefined && (explanation ? <p className="thread-command-explanation">{panel.text}</p> : <pre>{panel.text || t('commandDialog.noContent')}</pre>)}
      {panel.usage ? <ThreadUsageDetails usage={panel.usage} /> : panel.title === 'Conversation status' && panel.rows ? <div className="thread-status-summary">
        <p className="terminal-session-identity-note">{t('commandDialog.statusNote')}</p>
        <DetailList rows={Object.entries(STATUS_ROWS).flatMap(([label, key]) => panel.rows!.filter(row => row.label === label).map(row => ({ ...row, label: t(`commandDialog.statusRow.${key as 'provider'}`) })))} />
        <details className="terminal-technical-details"><summary>{t('commandDialog.internal')}</summary><DetailList rows={Object.entries(INTERNAL_ROWS).flatMap(([label, key]) => panel.rows!.filter(row => row.label === label).map(row => ({ ...row, label: t(`commandDialog.statusRow.${key as 'provider'}`) })))} /></details>
      </div> : panel.rows && (panel.rows.length && panel.rows.every(row => !row.id) ? <DetailList rows={panel.rows} /> : <div className="thread-panel-list">{panel.rows.length ? panel.rows.map((row, index) => row.id ? <button type="button" key={index} disabled={pending} onClick={() => void action(async () => { onClose(); await runCommand(row.id!) })}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button> : <div key={index}><strong>{row.label}</strong><span>{row.detail}</span></div>) : <EmptyState compact title={t('commandDialog.noItems')} />}</div>)}</>}
  </Dialog>
}
