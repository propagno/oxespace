import { useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown } from 'lucide-react'
import { threadAgentName } from '../../../shared/threadProviders'
import { planExecution } from '../../../shared/threadPlanExecution'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import { Button, Spinner, toast } from '../../ui'
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
import { planOnlyTurn, ThreadPlanOnlyHint } from './ThreadPlanOnlyHint'
import { ThreadReasoning } from './ThreadReasoning'
import { ThreadRequestCard } from './ThreadRequestCard'
import { useOpenRequest } from '../Approvals/openRequest'
import { ThreadSubagentActivity } from './ThreadSubagentActivity'
import { ThreadTurnTiming } from './ThreadTurnTiming'
import { ThreadTurnFoldRow } from './ThreadTurnFold'
import { threadFileLabel, threadFileScope, threadWorkingRoot, type ThreadChangeEntry } from './threadChanges'
import type { ThreadTimelineItem } from './threadTimelineModel'
import { PathScopeContext, type PathScope } from '../PathMenu/PathLink'
import { inlinePathExists, inlinePathRoots, resolveInlinePath, turnWorkingDirectory } from './threadInlinePath'

/** Opens an inline code path from the first place that has it (T70), or names the places looked in. */
async function openInlinePath(snapshot: ThreadSnapshot, turnEvents: readonly ThreadEvent[], line: number | undefined, text: string): Promise<void> {
  const { workspaceId } = snapshot.thread
  const result = await resolveInlinePath(text, { cwd: turnWorkingDirectory(turnEvents), thread: snapshot.thread }, place => inlinePathExists(workspaceId, place))
  if ('looked' in result) {
    toast({ title: i18n.t('thread:inlinePath.notFound', { path: text.trim() }), description: i18n.t('thread:inlinePath.looked', { places: result.looked.join('; ') }), intent: 'warning' })
    return
  }
  void useEditorStore.getState().openFile({ workspaceId, rootPath: result.found.root, relativePath: result.found.relativePath, line })
  useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'files' })
}

/**
 * Restores the files of one turn from its checkpoint. The orchestrator refuses
 * when files changed afterwards, so this never overwrites later work — older
 * turns therefore fail with a conflict once newer turns touched the same files.
 */
async function undoTurnChanges(threadId: string, turnId: string): Promise<void> {
  const commands = window.oxe.thread
  if (!commands?.command) throw Error(i18n.t('thread:timeline.restartUndo'))
  const listing = await commands.command(threadId, '/checkpoint')
  const target = listing.rows?.find(row => row.turnId === turnId && row.id?.startsWith('/checkpoint restore '))
  if (!target?.id) throw Error(i18n.t('thread:timeline.noCheckpoint'))
  await commands.command(threadId, target.id)
  await useThreadStore.getState().refresh(threadId)
}

/**
 * Run plan on this turn: planExecution says the action exists, the window has thread.executePlan, and the plan is
 * this turn's (a plan event, or prose when the conversation never recorded one). A later turn does not offer it.
 */
function showRunPlan(snapshot: ThreadSnapshot | null, turnId: string, turnEvents: ThreadEvent[]): boolean {
  if (!snapshot || typeof window.oxe?.thread?.executePlan !== 'function') return false
  if (!planExecution(snapshot, turnId).available) return false
  if (turnEvents.some(event => event.type === 'plan' && event.steps.length > 0)) return true
  return !snapshot.events.some(event => event.type === 'plan' && event.steps.length > 0)
}

/** One Run plan. Disabled while the call to main is in flight, so a second click does not send it again. */
function RunPlanButton({ threadId, turnId }: { threadId: string; turnId: string }) {
  const { t } = useTranslation('thread')
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = (): void => {
    const execute = window.oxe?.thread?.executePlan
    if (pending.current || !execute) return
    pending.current = true
    setBusy(true)
    void execute(threadId, turnId).finally(() => { pending.current = false; setBusy(false) })
  }
  return <div className="thread-plan-run"><Button size="sm" variant="primary" disabled={busy} onClick={run}>{t('plan.run')}</Button></div>
}

/** One virtual row of the conversation, plus the turn's changes and timing after its last row. */
export function ThreadTimelineEntry({ row, snapshot, viewMode, running, pending, pendingRequests, lastResult, lastMessageId, quickReplies, copiedMessageId, action, runCommand, onCopy, onQuickReply, onQuote, onDraft, onPermissions, onToggleFold }: {
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
  onPermissions: () => void
  /** Opens or closes the folded work of a finished turn. */
  onToggleFold?: (turnId: string) => void
}) {
  const { t } = useTranslation('thread')
  const { event, key, turnId, turnEvents, firstInTurn, lastInTurn } = row
  const api = window.oxe?.thread
  const openFile = (entry: ThreadChangeEntry) => {
    if (!snapshot) return
    // A file the agent edited in the worktree it moved into opens from that worktree.
    const root = [threadWorkingRoot(snapshot.thread), snapshot.thread.rootPath].find(candidate => threadFileScope(entry.file.path, candidate) === 'Project')
    if (!root) return
    void useEditorStore.getState().openFile({ workspaceId: snapshot.thread.workspaceId, rootPath: root, relativePath: threadFileLabel(entry.file.path, root) })
    useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'files' })
  }
  // F33: inline code paths in the agent's text open where the agent worked (T70: the turn's folder, the worktree it
  // moved into, then the project root), and say where they looked when none has the file.
  const pathScope: PathScope | null = snapshot ? {
    workspaceId: snapshot.thread.workspaceId,
    rootPath: snapshot.thread.rootPath,
    roots: inlinePathRoots(snapshot.thread),
    openInOxespace: (path, text) => void openInlinePath(snapshot, turnEvents, path.line, text)
  } : null
  const body = (() => {
    if (event.type === 'turn-fold') return <ThreadTurnFoldRow key={key} fold={event} turn={snapshot?.turns?.find(value => value.id === turnId)} events={turnEvents} onToggle={() => onToggleFold?.(turnId)} />
    if (event.type === 'activity-group') {
      if (!event.events.some(item => item.name === 'contextCompaction')) {
        return <ThreadActivityGroup key={key} events={event.events} mode={viewMode} rootPath={snapshot?.thread.rootPath ?? ''} threadId={snapshot?.thread.id} onResolveInterrupted={command => void action(() => runCommand(command))} onDraft={onDraft} />
      }
      const parts: Array<{ kind: 'compaction'; id: string } | { kind: 'tools'; id: string; events: typeof event.events }> = []
      for (const item of event.events) {
        if (item.name === 'contextCompaction') parts.push({ kind: 'compaction', id: item.id })
        else {
          const last = parts.at(-1)
          if (last?.kind === 'tools') last.events.push(item)
          else parts.push({ kind: 'tools', id: item.id, events: [item] })
        }
      }
      return <>{parts.map(part => part.kind === 'compaction'
        ? <div key={part.id} className="thread-compaction-divider" data-ui="compaction-divider" role="separator">{t('timeline.contextCompacted')}</div>
        : <ThreadActivityGroup key={part.id} events={part.events} mode={viewMode} rootPath={snapshot?.thread.rootPath ?? ''} threadId={snapshot?.thread.id} onResolveInterrupted={command => void action(() => runCommand(command))} onDraft={onDraft} />)}</>
    }
    if (event.type === 'plan') return <ThreadPlan key={key} event={event} />
    if (event.type === 'reasoning') return event.text.trim() ? <ThreadReasoning key={key} event={event} running={running && snapshot?.turns?.at(-1)?.id === turnId} /> : null
    if (event.type === 'subagent') return <ThreadSubagentActivity key={key} event={event} compact stopping={pending} onStop={snapshot?.thread.capabilities?.features.subagentLifecycle?.enabled && api?.stopTask && event.receiverThreadIds[0] ? () => void action(() => api.stopTask!(snapshot.thread.id, event.receiverThreadIds[0])) : undefined} />
    if (event.type === 'tool' && event.files?.length) return <ThreadFileActivity key={key} event={event} root={snapshot?.thread.rootPath ?? ''} roots={[snapshot?.thread.observedLocation?.checkoutRoot]} threadId={snapshot!.thread.id} workspaceId={snapshot?.thread.workspaceId} onOpen={openFile} />
    if (event.type === 'message') return <PathScopeContext.Provider key={key} value={pathScope}><ThreadMessageRow event={event} turnEvents={turnEvents} snapshot={snapshot} running={running} pending={pending} copied={copiedMessageId === event.id} action={action} onCopy={onCopy} turnId={turnId}
      quickReplies={event.id === lastMessageId ? quickReplies : []} onQuickReply={onQuickReply} onQuote={onQuote} /></PathScopeContext.Provider>
    if (event.type === 'tool' && event.name === 'contextCompaction') return <div key={key} className="thread-compaction-divider" data-ui="compaction-divider" role="separator">{t('timeline.contextCompacted')}</div>
    if (event.type === 'tool') return <details key={key} className="thread-tool"><summary><ChevronDown size={12} />{event.state === 'running' ? <Spinner size="sm" decorative /> : event.state === 'failed' ? <AlertCircle size={12} /> : <Check size={12} />}{event.name}<small>{t(`activity.state.${event.state === 'running' || event.state === 'failed' || event.state === 'unknown' ? event.state : 'completed'}`)}</small></summary>{event.detail && <pre>{event.detail}</pre>}</details>
    if (event.type === 'request') {
      const root = snapshot!.thread.rootPath
      const place = snapshot!.thread.ownedWorktree?.branch ?? root.split(/[/\\]/).filter(Boolean).at(-1)
      return <div key={key} className="thread-timeline-request" data-request-id={event.request.id}><ThreadRequestCard conversationId={snapshot!.thread.id} agent={threadAgentName(snapshot!.thread.provider)} place={place} request={event.request} turnResult={turnEvents.find((value): value is Extract<ThreadEvent, { type: 'completed' }> => value.type === 'completed')?.status} disabled={pending} onSeeImpact={() => useOpenRequest.getState().open(event.request.id)} onRespond={response => action(() => api!.respond!(snapshot!.thread.id, event.id, response))} /></div>
    }
    if (event.type === 'approval') {
      if (snapshot?.events.some(value => value.type === 'request' && value.id === event.id)) return null
      const unresolved = snapshot?.thread.status === 'approval' && !snapshot.events.some(e => e.type === 'approval-resolved' && e.id === event.id)
      return <details key={key} className="thread-approval" open={Boolean(unresolved)}><summary><AlertCircle size={14} />{event.title}</summary><ThreadApprovalDetails command={event.detail} /* A legacy saved approval carries no structure: read as a command, never from its title (FE-M-11). */ />{unresolved && <div className="thread-approval-actions"><button type="button" disabled={pending} onClick={() => void action(() => api!.approve(snapshot!.thread.id, event.id, 'accept'))}>{t('timeline.approve')}</button><button type="button" disabled={pending} onClick={() => void action(() => api!.approve(snapshot!.thread.id, event.id, 'decline'))}>{t('timeline.decline')}</button></div>}</details>
    }
    if (event.type === 'completed') return event.status === 'failed' ? <ThreadFailureCard key={key} event={event} latest={event === lastResult} disabled={pending} onCompact={() => void action(() => runCommand('/compact'))} onPermissions={onPermissions} onRetry={(() => {
      const prompt = turnEvents.find(value => value.type === 'message' && value.role === 'user')
      if (prompt?.type !== 'message') return undefined
      // The orchestrator can undo the failed turn's files first; older builds only resend.
      return (restoreFiles: boolean) => void action(() => api!.retryTurn
        ? api!.retryTurn(snapshot!.thread.id, turnId, { restoreFiles })
        : api!.send(snapshot!.thread.id, prompt.text, prompt.attachments?.map(attachment => attachment.id) ?? []))
    })()} hasChanges={turnEvents.some(value => (value.type === 'turn-diff' || value.type === 'tool') && Boolean(value.files?.length))} refreshUsage={snapshot?.thread.provider === 'codex' && api?.command ? async () => {
      const result = await api.command!(snapshot.thread.id, '/usage')
      if (!result.usage) throw Error(t('timeline.usageUnavailable'))
      return result.usage
    } : undefined} /> : event.status === 'interrupted' ? <p key={key} className="thread-turn-status"><AlertCircle size={14} />{event.error || t('timeline.interrupted')}</p> : null
    return null
  })()
  const finished = lastInTurn && turnEvents.some(value => value.type === 'completed')
  return <section className={`thread-turn thread-virtual-turn${firstInTurn ? ' is-turn-start' : ''}${lastInTurn ? ' is-turn-end' : ''}`} data-ui="turn" data-turn-id={turnId}>{body}
    {finished && <ThreadTurnChanges openFirst={turnId === snapshot?.turns?.at(-1)?.id} events={turnEvents} workspaceId={snapshot?.thread.workspaceId} root={snapshot?.thread.rootPath ?? ''} roots={[snapshot?.thread.observedLocation?.checkoutRoot]} onOpen={openFile} onViewChanges={() => { if (snapshot) useThreadWorkbenchStore.getState().setView(snapshot.thread.id, { panel: 'changes', turnId }) }} onUndo={snapshot && !running && turnId ? () => undoTurnChanges(snapshot.thread.id, turnId) : undefined} loadFileStates={snapshot && turnId && api?.turnFiles ? () => api.turnFiles!(snapshot.thread.id, turnId) : undefined} onUndoFile={snapshot && !running && turnId && api?.undoTurnFile ? async path => { await api.undoTurnFile!(snapshot.thread.id, turnId, path); await useThreadStore.getState().refresh(snapshot.thread.id) } : undefined}
      loadHunks={snapshot && turnId && api?.turnFileHunks ? path => api.turnFileHunks!(snapshot.thread.id, turnId, path) : undefined}
      onUndoHunk={snapshot && !running && turnId && api?.undoTurnHunk ? async (path, hunkId) => { await api.undoTurnHunk!(snapshot.thread.id, turnId, path, hunkId); await useThreadStore.getState().refresh(snapshot.thread.id) } : undefined}
      onComment={onDraft} />}
    {finished && <ThreadTurnTiming turn={snapshot?.turns?.find(value => value.id === turnId)} events={turnEvents} />}
    {finished && !running && planOnlyTurn(snapshot, turnId) && <ThreadPlanOnlyHint agent={threadAgentName(snapshot!.thread.provider)} onChangeAccess={onPermissions} />}
    {lastInTurn && snapshot && showRunPlan(snapshot, turnId, turnEvents) && <RunPlanButton threadId={snapshot.thread.id} turnId={turnId} />}
  </section>
}
