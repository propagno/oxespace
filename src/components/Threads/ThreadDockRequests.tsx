import { useState, type RefObject } from 'react'
import { threadAgentName } from '../../../shared/threadProviders'
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '../../ui'
import type { ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useOpenRequest } from '../Approvals/openRequest'
import { QueuedMessageRow } from './QueuedMessageRow'
import { ThreadRequestCard } from './ThreadRequestCard'
import { ThreadPromptQueue } from './ThreadPromptQueue'

// Whether requests open with more room; a reading preference, so it is remembered across requests.
const EXPANDED_KEY = 'oxe.thread.request-expanded'
const readExpanded = (): boolean => { try { return localStorage.getItem(EXPANDED_KEY) === '1' } catch { return false } }

/** The agent's pending requests above the composer, or a notice when the provider waits on one OXESpace cannot see. */
export function ThreadDockRequests({ snapshot, pendingRequests, waiting, pending, action }: {
  snapshot: ThreadSnapshot
  /** The pending requests shown here: those with no card of their own in the conversation. */
  pendingRequests: ThreadRequest[]
  /** Every pending request, the ones with a card in the conversation included. */
  waiting: number
  pending: boolean
  action: (run: () => Promise<unknown>) => Promise<void>
}) {
  const { t } = useTranslation('thread')
  const api = window.oxe?.thread
  const id = snapshot.thread.id
  // Unavailable means no request at all. One that has its card in the conversation (a question, an MCP server's
  // request) is not listed here and is still there to answer: the notice beside it said the opposite (CHAT-14).
  const orphanedApproval = snapshot.thread.status === 'approval' && waiting === 0
    && !snapshot.events.some(event => event.type === 'approval' && !snapshot.events.some(other => other.type === 'approval-resolved' && other.id === event.id))
  // Hiding is per set of requests: a new request shows itself again.
  const requestKey = pendingRequests.map(request => `${request.id}:${request.generation}`).join(',')
  const [hiddenKey, setHiddenKey] = useState<string | null>(null)
  const hidden = hiddenKey === requestKey
  const listId = `thread-pending-requests-${id}`
  const [expanded, setExpanded] = useState(readExpanded)
  const toggleExpanded = () => { const next = !expanded; setExpanded(next); try { localStorage.setItem(EXPANDED_KEY, next ? '1' : '0') } catch { /* not remembered */ } }
  const agentName = threadAgentName(snapshot.thread.provider)
  return <>
    {pendingRequests.length > 0 && <div className="thread-pending-requests-bar">
      {/* One request is named by its own card; repeating its title here said it twice (T67, DESIGN #568 C-01). */}
      {pendingRequests.length > 1 && <span>{t('requests.waitingMany', { count: pendingRequests.length })}</span>}
      <span className="thread-pending-requests-actions">
        {/* Icon buttons: the word is their name, the tooltip says what they do. */}
        {!hidden && <button type="button" className="thread-pending-requests-icon" aria-pressed={expanded} aria-label={expanded ? t('requests.shrink') : t('requests.expand')} title={expanded ? t('requests.shrinkTitle') : t('requests.expandTitle')} onClick={toggleExpanded}>{expanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}</button>}
        <button type="button" className="thread-pending-requests-icon" aria-expanded={!hidden} aria-controls={listId} aria-label={hidden ? t('requests.show') : t('requests.hide')} title={hidden ? t('requests.showTitle') : t('requests.hideTitle')} onClick={() => setHiddenKey(hidden ? null : requestKey)}>{hidden ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}</button>
      </span>
    </div>}
    {pendingRequests.length > 0 && <section id={listId} className="thread-pending-requests" aria-label={t('requests.label')} hidden={hidden} data-expanded={expanded || undefined}>
      {pendingRequests.map(request => <ThreadRequestCard key={`${id}:${request.id}:${request.generation}`} conversationId={id} agent={agentName} request={request} disabled={pending} onSeeImpact={() => useOpenRequest.getState().open(request.id)} onRespond={response => action(() => api!.respond!(id, request.id, response))}
        onRemember={api?.addPermissionRule ? async suggestions => { for (const item of suggestions) await api.addPermissionRule!(id, { kind: item.kind, pattern: item.pattern, decision: 'allow', scope: 'project' }) } : undefined} />)}
    </section>}
    {orphanedApproval && <ErrorState compact title={t('requests.orphaned')} actions={<button type="button" disabled={pending} onClick={() => void action(() => useThreadStore.getState().refresh(id))}>{t('requests.refresh')}</button>} />}
  </>
}

/** Follow-ups queued while a turn runs: single compact U6.3 row while steering/running, or full multi-item queue card. */
export function ThreadDockQueue({ snapshot, pending, textarea, action }: {
  snapshot: ThreadSnapshot
  pending: boolean
  textarea: RefObject<HTMLTextAreaElement | null>
  action: (run: () => Promise<unknown>) => Promise<void>
}) {
  const api = window.oxe?.thread
  const id = snapshot.thread.id
  const queue = snapshot.thread.queue
  const canSteer = Boolean(snapshot.thread.capabilities?.features.steering?.enabled)
  const working = snapshot.thread.status === 'running'
  if (!queue?.length) return null
  if (
    queue.length === 1
    && !snapshot.thread.queuePause
    && queue[0].state === 'queued'
    && !queue[0].error
    && canSteer
    && working
  ) {
    return <QueuedMessageRow threadId={id} item={queue[0]} canSteer={canSteer} working={working} />
  }
  return (
    <ThreadPromptQueue threadId={id} canSteer={canSteer} items={queue} disabled={pending} running={working} pause={snapshot.thread.queuePause}
      onResume={api?.resumeQueue ? () => action(() => api.resumeQueue!(id)) : undefined}
      onSendNow={api?.sendQueuedNow ? itemId => action(() => api.sendQueuedNow!(id, itemId)) : undefined}
      onClear={() => action(async () => { for (const item of snapshot.thread.queue ?? []) if (item.state !== 'sending') await api!.deleteQueued!(id, item.id) })}
      onUpdate={(itemId, text) => action(() => api!.updateQueued!(id, itemId, text))} onDelete={itemId => action(() => api!.deleteQueued!(id, itemId))} onRestore={item => action(async () => {
        await api!.deleteQueued!(id, item.id, true)
        useThreadStore.getState().setDraft(id, item.text)
        useThreadStore.getState().clearAttachments(id)
        for (const attachment of item.attachments ?? []) useThreadStore.getState().addAttachment(id, attachment)
        if (item.configuration && api?.configure) useThreadStore.getState().updateSnapshot(await api.configure(id, item.configuration, snapshot.thread.configurationRevision ?? 0))
        requestAnimationFrame(() => textarea.current?.focus())
      })} onReorder={itemIds => action(() => api!.reorderQueued!(id, itemIds))} />
  )
}
