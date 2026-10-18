import { useState } from 'react'
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
import { Button, ConfirmDialog, Dialog, TextField } from '../../ui'

function sessionDate(timestamp: number): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp) }

/** What each integrated surface is for, under its title. Output panels have no description. */
const SURFACE_DESCRIPTION: Partial<Record<NonNullable<ThreadPanelState['surface']>, string>> = {
  rename: 'The new name appears in the session list and conversation header.',
  sessions: 'Choose a saved conversation or provider session in this project.',
  rules: 'Rules that answer this conversation’s approval prompts.',
  work: 'Plans this conversation runs through worker conversations.',
  events: 'The saved events of this conversation, newest first.',
  spending: 'What this conversation, its project and all projects cost.',
  delegations: 'Work delegated from this project to other worktrees.'
}

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
    if (!task.destinationThreadId || !api) throw Error('This delegation has no saved Thread conversation. Open Delegated Work for recovery options.')
    const originWorkspaceId = task.originWorkspaceId ?? task.workspaceId
    if (task.recoveryActions?.includes('resume') && snapshot?.thread.workspaceId === originWorkspaceId) await window.oxe.delegation.control(originWorkspaceId, task.id, 'resume')
    useThreadStore.getState().adopt(await api.read(task.destinationThreadId))
    onClose()
  }

  // Archive, delete and rewind: one question, Cancel and one action.
  if (panel.kind === 'confirm' && panel.confirm) {
    const confirm = panel.confirm
    return <ConfirmDialog title={confirm.title} description={confirm.description} confirmLabel={confirm.confirmLabel} danger={confirm.danger} busy={pending} error={error}
      onCancel={onClose} onConfirm={() => void action(async () => { await runCommand(confirm.command); onClose() })} />
  }

  const footer = panel.surface === 'rename'
    ? <><Button onClick={onClose}>Cancel</Button><Button type="submit" form="thread-rename-form" variant="primary" loading={pending} disabled={!canRename}>Rename conversation</Button></>
    : !panel.surface && output && panel.externalUrl ? <Button onClick={() => window.open(panel.externalUrl, '_blank', 'noopener,noreferrer')}>Open in browser</Button>
    : !panel.surface && output && panel.text ? <Button onClick={() => void navigator.clipboard.writeText(panel.text!).catch(() => onError('Could not copy text.'))}>Copy text</Button>
    : undefined

  return <Dialog className={`thread-command-dialog${panel.surface === 'sessions' ? ' thread-resume-dialog' : ''}`} size={panel.surface === 'sessions' || panel.surface === 'events' || panel.surface === 'spending' ? 'lg' : 'md'}
    title={panel.surface === 'sessions' ? 'Resume work' : panel.title || 'Conversation'} description={panel.surface ? SURFACE_DESCRIPTION[panel.surface] : undefined} onClose={onClose} footer={footer}>
    {error && <p role="alert">{error}</p>}
    {panel.surface === 'rename' ? <form id="thread-rename-form" className="thread-command-form" onSubmit={event => { event.preventDefault(); if (!canRename) return; void action(async () => { await runCommand(`/rename ${rename.trim()}`); onClose() }) }}>
      <label>Conversation name<TextField aria-label="Conversation name" value={rename} maxLength={120} autoFocus onFocus={event => event.currentTarget.select()} onChange={event => setRename(event.target.value)} /></label>
    </form>
    : panel.surface === 'rules' && snapshot ? <ThreadPermissionsPanel threadId={snapshot.thread.id} />
    : panel.surface === 'work' && snapshot ? <ThreadWorkPanel threadId={snapshot.thread.id} onOpenThread={threadId => { onClose(); void useThreadStore.getState().select(threadId) }} />
    : panel.surface === 'events' && snapshot ? <ThreadEventsPanel threadId={snapshot.thread.id} />
    : panel.surface === 'spending' && snapshot ? <ThreadUsagePanel threadId={snapshot.thread.id} />
    : panel.surface === 'sessions' ? <div className="thread-resume-sections">
      <label className="thread-resume-search">Find a session<TextField aria-label="Find a session" type="search" placeholder="Search prompt, model, branch, date or ID" value={resumeQuery} onChange={event => setResumeQuery(event.target.value)} /></label>
      <section><h3>Saved conversations</h3><p>The current conversation is already open. Send a message to continue its native session.</p>
        <div className="thread-panel-list">{useThreadStore.getState().threads.filter(thread => thread.id !== snapshot?.thread.id && thread.provider === snapshot?.thread.provider && thread.rootPath === snapshot?.thread.rootPath && resumeMatches([thread.title, thread.nativeSessionId, thread.id, thread.status])).map(thread => <button key={thread.id} type="button" disabled={pending} onClick={() => void action(() => runCommand(`/resume ${thread.id}`))}><strong>{thread.title}</strong><span>{thread.nativeSessionId ? `Session ${thread.nativeSessionId}` : 'Not started'} · {thread.archived ? 'Archived' : thread.status}</span></button>)}
          {!useThreadStore.getState().threads.some(thread => thread.id !== snapshot?.thread.id && thread.provider === snapshot?.thread.provider && thread.rootPath === snapshot?.thread.rootPath && resumeMatches([thread.title, thread.nativeSessionId, thread.id, thread.status])) && <p>{resumeQuery ? 'No saved conversations match this search.' : 'No other saved conversation for this provider and directory.'}</p>}
        </div>
      </section>
      <section><h3>Delegated sessions</h3>{resume?.notice && <p role="status">{resume.notice}</p>}
        <div className="thread-panel-list">{resumeTasks.filter(task => resumeMatches([task.objective, task.branch, task.state, task.id, task.nativeSession?.nativeSessionId])).map(task => <button key={task.id} type="button" disabled={pending || !task.destinationThreadId} onClick={() => void action(() => openDelegatedSession(task))}><strong>{task.objective}</strong><span>{task.branch} · {task.state} · {task.nativeSession?.provider ?? task.agentProfileId}</span><span>{task.nativeSession?.nativeSessionId ? `Session ${task.nativeSession.nativeSessionId}` : 'No native session ID yet'}</span></button>)}
          {!resumeTasks.some(task => resumeMatches([task.objective, task.branch, task.state, task.id, task.nativeSession?.nativeSessionId])) && <p>{resumeQuery ? 'No delegated sessions match this search.' : 'No delegated session in this workspace.'}</p>}
        </div>
        {onDelegations && <Button variant="link" size="sm" className="thread-resume-all" onClick={() => { onClose(); onDelegations() }}>Open all delegated work</Button>}
      </section>
      <section><h3>{snapshot?.thread.provider === 'codex' ? 'Codex' : 'Claude'} sessions in this directory</h3><p>Terminal PTY, pane and workspace IDs are not provider conversation IDs. Choose a native session by its start time and model.</p>
        {resume?.nativeNotice && <p role="status">{resume.nativeNotice}</p>}
        <div className="thread-panel-list thread-native-session-list">{nativeSessions.filter(session => resumeMatches([session.firstMessagePreview, session.modelId, session.sessionId, new Date(session.sessionStartedAtMs).toLocaleString(), new Date(session.lastUpdatedMs).toLocaleString()])).map(session => <button key={session.sessionId} type="button" disabled={pending} onClick={() => void action(() => runCommand(`/resume ${session.sessionId}`))}><strong>{session.firstMessagePreview || `${session.provider === 'codex' ? 'Codex' : 'Claude'} session`}</strong><span className="thread-session-meta"><span>Updated {sessionDate(session.lastUpdatedMs)}</span><span>{session.modelId || 'Model unknown'}</span>{session.requestCount > 0 && <span>{session.requestCount} requests</span>}</span><span className="thread-session-foot"><span>Started {sessionDate(session.sessionStartedAtMs)}</span><code>{session.sessionId}</code></span></button>)}
          {!nativeSessions.some(session => resumeMatches([session.firstMessagePreview, session.modelId, session.sessionId, new Date(session.sessionStartedAtMs).toLocaleString(), new Date(session.lastUpdatedMs).toLocaleString()])) && !resume?.nativeNotice && <p>{resumeQuery ? 'No native sessions match this search.' : 'No native sessions found for this provider and directory.'}</p>}
        </div>
      </section>
      <section><h3>Open an exact native session</h3><p>Use a Claude or Codex session ID from this directory. OXESpace verifies its provider and path before linking it.</p>
        <form className="thread-resume-native" onSubmit={event => { event.preventDefault(); void action(() => runCommand(`/resume ${nativeResumeId.trim()}`)) }}><label className="thread-resume-native-label">Native session ID<TextField aria-label="Native session ID" value={nativeResumeId} onChange={event => setNativeResumeId(event.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label><Button type="submit" disabled={pending || !nativeResumeId.trim()}>Open session</Button></form>
      </section>
    </div>
    : panel.surface === 'delegations' ? <div className="thread-panel-list">{panel.rows?.length ? panel.rows.map((row, index) => <button key={index} type="button" disabled={pending || !row.id} onClick={() => { if (row.id) { onClose(); void useThreadStore.getState().select(row.id) } }}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button>) : <p>No delegated work in this project.</p>}</div>
    : <>{panel.text !== undefined && (explanation ? <p className="thread-command-explanation">{panel.text}</p> : <pre>{panel.text || 'No content available.'}</pre>)}
      {panel.usage ? <ThreadUsageDetails usage={panel.usage} /> : panel.title === 'Conversation status' && panel.rows ? <div className="thread-status-summary">
        <p className="terminal-session-identity-note">The native session ID resumes the Codex or Claude conversation. Thread, project and workspace IDs belong to OXESpace.</p>
        <DetailList rows={['Provider', 'Native session ID (resume)', 'Status', 'Model', 'Effort', 'Access', 'Network', 'Approvals', 'Mode', 'Connection', 'Directory'].flatMap(label => panel.rows!.filter(row => row.label === label))} />
        <details className="terminal-technical-details"><summary>Internal OXESpace IDs and runtime</summary><DetailList rows={['Thread ID', 'Project ID', 'Workspace ID', 'Generation', 'Operation', 'Hooks'].flatMap(label => panel.rows!.filter(row => row.label === label))} /></details>
      </div> : panel.rows && (panel.rows.length && panel.rows.every(row => !row.id) ? <DetailList rows={panel.rows} /> : <div className="thread-panel-list">{panel.rows.length ? panel.rows.map((row, index) => row.id ? <button type="button" key={index} disabled={pending} onClick={() => void action(async () => { onClose(); await runCommand(row.id!) })}><strong>{row.label}</strong>{row.detail && <span>{row.detail}</span>}</button> : <div key={index}><strong>{row.label}</strong><span>{row.detail}</span></div>) : <p>No items returned by the provider.</p>}</div>)}</>}
  </Dialog>
}
