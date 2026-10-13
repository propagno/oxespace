import { AlertCircle, Check, ChevronDown, Loader2 } from 'lucide-react'
import type { ThreadEvent, ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'
import type { ThreadViewMode } from '../../store/thread-view-mode.store'
import { useThreadStore } from '../../store/thread.store'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { useEditorStore } from '../../store/editor.store'
import { ThreadActivityGroup } from './ThreadActivityGroup'
import { ThreadApprovalDetails } from './ThreadApprovalDetails'
import { ThreadFailureCard } from './ThreadFailureCard'
import { ThreadFileActivity, ThreadTurnChanges } from './ThreadFileActivity'
import { ThreadMessageRow } from './ThreadMessageRow'
import { ThreadPlan } from './ThreadPlan'
import { ThreadRequestCard } from './ThreadRequestCard'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { ThreadTurnTiming } from './ThreadTurnTiming'
import { threadFileLabel, threadFileScope, type ThreadChangeEntry } from './threadChanges'
import type { ThreadTimelineItem } from './threadTimelineModel'

/**
 * Restores the files of one turn from its checkpoint. The orchestrator refuses
 * when files changed afterwards, so this never overwrites later work — older
 * turns therefore fail with a conflict once newer turns touched the same files.
 */
async function undoTurnChanges(threadId: string, turnId: string): Promise<void> {
  const commands = window.oxe.thread
  if (!commands?.command) throw Error('Restart the updated application to undo changes.')
  const listing = await commands.command(threadId, '/checkpoint')
  const target = listing.rows?.find(row => row.turnId === turnId && row.id?.startsWith('/checkpoint restore '))
  if (!target?.id) throw Error('No restorable checkpoint exists for this turn.')
  await commands.command(threadId, target.id)
  await useThreadStore.getState().refresh(threadId)
}

/** One virtual row of the conversation, plus the turn's changes and timing after its last row. */
export function ThreadTimelineEntry({ row, snapshot, viewMode, running, pending, pendingRequests, lastResult, lastMessageId, quickReplies, copiedMessageId, action, runCommand, onCopy, onQuickReply, onQuote, onDraft, onAccounts, onPermissions }: {
  row: ThreadTimelineItem
  snapshot: ThreadSnapshot | null
  viewMode: ThreadViewMode
  running: boolean
  pending: boolean
  pendingRequests: ThreadRequest[]
  lastResult?: ThreadEvent
  lastMessageId?: string
  quickReplies: { label: string; value: string }[]
  copiedMessageId: string | null
  action: (run: () => Promise<unknown>) => Promise<void>
  runCommand: (text: string) => Promise<void>
  onCopy: (id: string, text: string) => void
  onQuickReply: (value: string) => void
  onQuote: (text: string) => void
  /** Appends text to the composer, e.g. a review comment for the agent. */
  onDraft: (text: string) => void
  onAccounts?: () => void
  onPermissions: () => void
}) {
  const { event, key, turnId, turnEvents, firstInTurn, lastInTurn } = row
  const api = window.oxe?.thread
  const openFile = (entry: ThreadChangeEntry) => {
    if (!snapshot || threadFileScope(entry.file.path, snapshot.thread.rootPath) !== 'Project') return
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: snapshot.thread.rootPath, relativePath: threadFileLabel(entry.file.path, snapshot.thread.rootPath) })
    useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'files' })
  }
  const body = (() => {
    if (event.type === 'activity-group') return <ThreadActivityGroup key={key} events={event.events} mode={viewMode} />
    if (event.type === 'plan') return <ThreadPlan key={key} event={event} />
    if (event.type === 'subagent') return <ThreadSubagentActivity key={key} event={event} compact stopping={pending} onStop={snapshot?.thread.capabilities?.features.subagentLifecycle?.enabled && api?.stopTask && event.receiverThreadIds[0] ? () => void action(() => api.stopTask!(snapshot.thread.id, event.receiverThreadIds[0])) : undefined} />
    if (event.type === 'tool' && event.files?.length) return <ThreadFileActivity key={key} event={event} root={snapshot?.thread.rootPath ?? ''} threadId={snapshot!.thread.id} onOpen={openFile} />
    if (event.type === 'message') return <ThreadMessageRow key={key} event={event} turnEvents={turnEvents} snapshot={snapshot} running={running} pending={pending} copied={copiedMessageId === event.id} action={action} onCopy={onCopy}
      quickReplies={event.id === lastMessageId ? quickReplies : []} onQuickReply={onQuickReply} onQuote={onQuote} />
    if (event.type === 'tool') return <details key={key} className="thread-tool"><summary><ChevronDown size={12} />{event.state === 'running' ? <Loader2 size={12} className="thread-spin" /> : event.state === 'failed' ? <AlertCircle size={12} /> : <Check size={12} />}{event.name}<small>{event.state}</small></summary>{event.detail && <pre>{event.detail}</pre>}</details>
    if (event.type === 'request') return pendingRequests.some(request => request.id === event.request.id) ? null : <ThreadRequestCard key={key} conversationId={snapshot!.thread.id} request={event.request} turnResult={turnEvents.find((value): value is Extract<ThreadEvent, { type: 'completed' }> => value.type === 'completed')?.status} disabled={pending} onRespond={response => action(() => api!.respond!(snapshot!.thread.id, event.id, response))} />
    if (event.type === 'approval') {
      if (snapshot?.events.some(value => value.type === 'request' && value.id === event.id)) return null
      const unresolved = snapshot?.thread.status === 'approval' && !snapshot.events.some(e => e.type === 'approval-resolved' && e.id === event.id)
      return <details key={key} className="thread-approval" open={Boolean(unresolved)}><summary><AlertCircle size={13} />{event.title}</summary><ThreadApprovalDetails command={event.detail} fileChanges={event.title === 'Approve file changes'} />{unresolved && <div className="thread-approval-actions"><button type="button" disabled={pending} onClick={() => void action(() => api!.approve(snapshot!.thread.id, event.id, 'accept'))}>Approve</button><button type="button" disabled={pending} onClick={() => void action(() => api!.approve(snapshot!.thread.id, event.id, 'decline'))}>Decline</button></div>}</details>
    }
    if (event.type === 'completed') return event.status === 'failed' ? <ThreadFailureCard key={key} event={event} latest={event === lastResult} onAccounts={onAccounts} disabled={pending} onCompact={() => void action(() => runCommand('/compact'))} onPermissions={onPermissions} onRetry={(() => { const prompt = turnEvents.find(value => value.type === 'message' && value.role === 'user'); return prompt?.type === 'message' ? () => void action(() => api!.send(snapshot!.thread.id, prompt.text, prompt.attachments?.map(attachment => attachment.id) ?? [])) : undefined })()} refreshUsage={snapshot?.thread.provider === 'codex' && api?.command ? async () => {
      const result = await api.command!(snapshot.thread.id, '/usage')
      if (!result.usage) throw Error('Usage unavailable')
      return result.usage
    } : undefined} /> : event.status === 'interrupted' ? <p key={key} className="thread-turn-status"><AlertCircle size={13} />{event.error || 'Interrupted'}</p> : null
    return null
  })()
  const finished = lastInTurn && turnEvents.some(value => value.type === 'completed')
  return <section className={`thread-turn thread-virtual-turn${firstInTurn ? ' is-turn-start' : ''}${lastInTurn ? ' is-turn-end' : ''}`} data-turn-id={turnId}>{body}
    {finished && <ThreadTurnChanges events={turnEvents} root={snapshot?.thread.rootPath ?? ''} onOpen={openFile} onViewChanges={() => { if (snapshot) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'changes' }) }} onUndo={snapshot && !running && turnId ? () => undoTurnChanges(snapshot.thread.id, turnId) : undefined} loadFileStates={snapshot && turnId && api?.turnFiles ? () => api.turnFiles!(snapshot.thread.id, turnId) : undefined} onUndoFile={snapshot && !running && turnId && api?.undoTurnFile ? async path => { await api.undoTurnFile!(snapshot.thread.id, turnId, path); await useThreadStore.getState().refresh(snapshot.thread.id) } : undefined}
      loadHunks={snapshot && turnId && api?.turnFileHunks ? path => api.turnFileHunks!(snapshot.thread.id, turnId, path) : undefined}
      onUndoHunk={snapshot && !running && turnId && api?.undoTurnHunk ? async (path, hunkId) => { await api.undoTurnHunk!(snapshot.thread.id, turnId, path, hunkId); await useThreadStore.getState().refresh(snapshot.thread.id) } : undefined}
      onComment={onDraft} />}
    {finished && <ThreadTurnTiming turn={snapshot?.turns?.find(value => value.id === turnId)} events={turnEvents} />}
  </section>
}
