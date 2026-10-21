import { useState, type RefObject } from 'react'
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import type { ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { ThreadRequestCard } from './ThreadRequestCard'
import { ThreadPromptQueue } from './ThreadPromptQueue'

// Whether requests open with more room; a reading preference, so it is remembered across requests.
const EXPANDED_KEY = 'oxe.thread.request-expanded'
const readExpanded = (): boolean => { try { return localStorage.getItem(EXPANDED_KEY) === '1' } catch { return false } }

/** The agent's pending requests above the composer, or a notice when the provider waits on one OXESpace cannot see. */
export function ThreadDockRequests({ snapshot, pendingRequests, pending, action }: {
  snapshot: ThreadSnapshot
  pendingRequests: ThreadRequest[]
  pending: boolean
  action: (run: () => Promise<unknown>) => Promise<void>
}) {
  const api = window.oxe?.thread
  const id = snapshot.thread.id
  const orphanedApproval = snapshot.thread.status === 'approval' && pendingRequests.length === 0
    && !snapshot.events.some(event => event.type === 'approval' && !snapshot.events.some(other => other.type === 'approval-resolved' && other.id === event.id))
  // Hiding is per set of requests: a new request shows itself again.
  const requestKey = pendingRequests.map(request => `${request.id}:${request.generation}`).join(',')
  const [hiddenKey, setHiddenKey] = useState<string | null>(null)
  const hidden = hiddenKey === requestKey
  const listId = `thread-pending-requests-${id}`
  const [expanded, setExpanded] = useState(readExpanded)
  const toggleExpanded = () => { const next = !expanded; setExpanded(next); try { localStorage.setItem(EXPANDED_KEY, next ? '1' : '0') } catch { /* not remembered */ } }
  return <>
    {pendingRequests.length > 0 && <div className="thread-pending-requests-bar">
      <span>{pendingRequests.length === 1 ? pendingRequests[0].title || 'The agent is waiting for your answer' : `${pendingRequests.length} requests are waiting for your answer`}</span>
      <span className="thread-pending-requests-actions">
        {!hidden && <button type="button" aria-pressed={expanded} title={expanded ? 'Give the room back to the conversation' : 'Give the request more room to read its options'} onClick={toggleExpanded}>{expanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}{expanded ? 'Shrink' : 'Expand'}</button>}
        <button type="button" aria-expanded={!hidden} aria-controls={listId} title={hidden ? 'Show the request' : 'Hide the request to read the conversation; it stays waiting'} onClick={() => setHiddenKey(hidden ? null : requestKey)}>{hidden ? 'Show' : 'Hide'}<ChevronDown size={14} aria-hidden="true" /></button>
      </span>
    </div>}
    {pendingRequests.length > 0 && <section id={listId} className="thread-pending-requests" aria-label="Pending agent requests" hidden={hidden} data-expanded={expanded || undefined}>
      {pendingRequests.map(request => <ThreadRequestCard key={`${id}:${request.id}:${request.generation}`} conversationId={id} request={request} disabled={pending} onRespond={response => action(() => api!.respond!(id, request.id, response))}
        onRemember={api?.addPermissionRule ? async suggestions => { for (const item of suggestions) await api.addPermissionRule!(id, { kind: item.kind, pattern: item.pattern, decision: 'allow', scope: 'project' }) } : undefined} />)}
    </section>}
    {orphanedApproval && <div className="thread-action-error" role="alert"><span>The provider is waiting for input, but its request is unavailable. Refresh the request or stop the turn using the stop button.</span><button type="button" disabled={pending} onClick={() => void action(() => useThreadStore.getState().refresh(id))}>Refresh request</button></div>}
  </>
}

/** Follow-ups queued while a turn runs: edit, reorder, send now, or restore one to the composer. */
export function ThreadDockQueue({ snapshot, pending, textarea, action }: {
  snapshot: ThreadSnapshot
  pending: boolean
  textarea: RefObject<HTMLTextAreaElement | null>
  action: (run: () => Promise<unknown>) => Promise<void>
}) {
  const api = window.oxe?.thread
  const id = snapshot.thread.id
  return <>
    {snapshot.thread.queue && <ThreadPromptQueue items={snapshot.thread.queue} disabled={pending} pause={snapshot.thread.queuePause}
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
      })} onReorder={itemIds => action(() => api!.reorderQueued!(id, itemIds))} />}
  </>
}
