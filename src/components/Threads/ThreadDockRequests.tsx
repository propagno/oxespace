import { useMemo, useState, type KeyboardEvent, type RefObject } from 'react'
import { threadAgentName } from '../../../shared/threadProviders'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState, IconButton } from '../../ui'
import type { ThreadRequest, ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { useOpenRequest } from '../Approvals/openRequest'
import { focusIsEditable } from '../Approvals/typingFocus'
import { isStrictlySafeApproval } from './threadApprovalRisk'
import { QueuedMessageRow } from './QueuedMessageRow'
import { ThreadRequestCard } from './ThreadRequestCard'
import { ThreadPromptQueue } from './ThreadPromptQueue'
import styles from './ThreadDockRequests.module.css'

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
  const [batchBusy, setBatchBusy] = useState(false)
  const [nav, setNav] = useState<{ index: number; id: string | null; key: string }>(() => ({
    index: 0,
    id: pendingRequests[0]?.id ?? null,
    key: requestKey
  }))

  let activeIndex = nav.index
  if (nav.key !== requestKey) {
    const kept = nav.id ? pendingRequests.findIndex(request => request.id === nav.id) : -1
    activeIndex = kept >= 0 ? kept : Math.max(0, Math.min(nav.index, pendingRequests.length - 1))
    setNav({ index: activeIndex, id: pendingRequests[activeIndex]?.id ?? null, key: requestKey })
  } else {
    activeIndex = Math.max(0, Math.min(nav.index, Math.max(0, pendingRequests.length - 1)))
  }

  const goTo = (nextIndex: number) => {
    if (!pendingRequests.length) return
    const clamped = Math.max(0, Math.min(nextIndex, pendingRequests.length - 1))
    setNav({ index: clamped, id: pendingRequests[clamped]?.id ?? null, key: requestKey })
  }

  const isCarousel = pendingRequests.length > 1
  const activeRequest = pendingRequests[activeIndex]
  const safeRequests = useMemo(
    () => (isCarousel ? pendingRequests.filter(isStrictlySafeApproval) : []),
    [isCarousel, pendingRequests]
  )

  const allowAllSafe = async () => {
    if (batchBusy || pending || !api?.respond) return
    const targets = safeRequests.slice()
    if (targets.length < 2) return
    setBatchBusy(true)
    try {
      await action(async () => {
        for (const req of targets) {
          await api.respond!(id, req.id, { decision: 'accept' })
        }
      })
    } finally {
      setBatchBusy(false)
    }
  }

  const onCarouselKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (hidden || !isCarousel || batchBusy) return
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    if (focusIsEditable(event.target instanceof Element ? event.target : null)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft') goTo(activeIndex - 1)
    else goTo(activeIndex + 1)
  }

  const toggleExpanded = () => { const next = !expanded; setExpanded(next); try { localStorage.setItem(EXPANDED_KEY, next ? '1' : '0') } catch { /* not remembered */ } }
  const agentName = threadAgentName(snapshot.thread.provider)
  return <div className={styles.dock} onKeyDown={onCarouselKeyDown}>
    {pendingRequests.length > 0 && <div className="thread-pending-requests-bar" data-ui={isCarousel ? 'requests-carousel' : undefined}>
      {/* One request is named by its own card; repeating its title here said it twice (T67, DESIGN #568 C-01). */}
      {isCarousel && <div className={styles.carouselNav} data-ui="requests-carousel-nav">
        <IconButton size="sm" className="thread-pending-requests-icon" disabled={activeIndex <= 0 || batchBusy} label={t('requests.previous')} title={t('requests.previousTitle')} icon={<ArrowLeft size={13} aria-hidden="true" />} onClick={() => goTo(activeIndex - 1)} />
        <span className={styles.counter} data-ui="requests-counter" aria-live="polite">{t('requests.carouselCounter', { current: activeIndex + 1, total: pendingRequests.length })}</span>
        <IconButton size="sm" className="thread-pending-requests-icon" disabled={activeIndex >= pendingRequests.length - 1 || batchBusy} label={t('requests.next')} title={t('requests.nextTitle')} icon={<ArrowRight size={13} aria-hidden="true" />} onClick={() => goTo(activeIndex + 1)} />
      </div>}
      <span className="thread-pending-requests-actions">
        {isCarousel && safeRequests.length >= 2 && <Button size="sm" variant="secondary" className={styles.allowSafe} data-ui="allow-all-safe" disabled={pending || batchBusy} title={t('requests.allowSafeTitle', { count: safeRequests.length })} onClick={() => void allowAllSafe()}>{t('requests.allowSafe', { count: safeRequests.length })}</Button>}
        {/* Icon buttons: the word is their name, the tooltip says what they do. */}
        {!hidden && <IconButton size="sm" className="thread-pending-requests-icon" aria-pressed={expanded} label={expanded ? t('requests.shrink') : t('requests.expand')} title={expanded ? t('requests.shrinkTitle') : t('requests.expandTitle')} icon={expanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />} onClick={toggleExpanded} />}
        <IconButton size="sm" className="thread-pending-requests-icon" aria-expanded={!hidden} aria-controls={listId} label={hidden ? t('requests.show') : t('requests.hide')} title={hidden ? t('requests.showTitle') : t('requests.hideTitle')} icon={hidden ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />} onClick={() => setHiddenKey(hidden ? null : requestKey)} />
      </span>
    </div>}
    {pendingRequests.length > 0 && activeRequest && <section id={listId} className="thread-pending-requests" aria-label={t('requests.label')} hidden={hidden} data-expanded={expanded || undefined}>
      <ThreadRequestCard key={`${id}:${activeRequest.id}:${activeRequest.generation}`} conversationId={id} agent={agentName} request={activeRequest} disabled={pending || batchBusy} onSeeImpact={() => useOpenRequest.getState().open(activeRequest.id)} onRespond={response => action(() => api!.respond!(id, activeRequest.id, response))}
        onRemember={api?.addPermissionRule ? async suggestions => { for (const item of suggestions) await api.addPermissionRule!(id, { kind: item.kind, pattern: item.pattern, decision: 'allow', scope: 'project' }) } : undefined} />
    </section>}
    {orphanedApproval && <ErrorState compact title={t('requests.orphaned')} actions={<Button size="sm" variant="secondary" disabled={pending} onClick={() => void action(() => useThreadStore.getState().refresh(id))}>{t('requests.refresh')}</Button>} />}
  </div>
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
