import { useEffect, useMemo, useState, type ComponentType, type ReactElement } from 'react'
import { threadAgentName } from '../../../shared/threadProviders'
import type { ThreadRequest } from '../../../shared/types/thread'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { i18n } from '../../i18n'
import { useKeybindings } from '../../keyboard/keybindings'
import { useThreadStore } from '../../store/thread.store'
import { usePendingView } from '../../app/viewSwitch'
import { approvalsApi } from './approvalsApi'
import { handBackAll, OPEN_APPROVAL_QUEUE_EVENT, schedulePreload, startApprovals } from './approvalsBoot'
import { ApprovalToast } from './ApprovalToast'
import type { ImpactPreviewProps } from './ImpactPreview'
import { startOpenRequestListener, useOpenRequest } from './openRequest'

export { OPEN_APPROVAL_HISTORY_EVENT, OPEN_APPROVAL_QUEUE_EVENT } from './approvalsBoot'

interface OpenedThreadApproval {
  threadId: string
  request: ThreadRequest
  agent: string
  conversation: string
}

function collectSnapshots(
  snapshot: ReturnType<typeof useThreadStore.getState>['snapshot'],
  snapshotCache: ReturnType<typeof useThreadStore.getState>['snapshotCache']
): Map<string, NonNullable<typeof snapshot>> {
  const entries = new Map<string, NonNullable<typeof snapshot>>()
  for (const snap of Object.values(snapshotCache)) entries.set(snap.thread.id, snap)
  if (snapshot) entries.set(snapshot.thread.id, snapshot)
  return entries
}

function findPendingThreadApproval(
  requestId: string | null,
  snapshot: ReturnType<typeof useThreadStore.getState>['snapshot'],
  snapshotCache: ReturnType<typeof useThreadStore.getState>['snapshotCache']
): OpenedThreadApproval | null {
  if (!requestId) return null
  const entries = collectSnapshots(snapshot, snapshotCache)
  for (const snap of entries.values()) {
    for (const event of snap.events) {
      if (event.type === 'request' && event.request.id === requestId && event.request.state === 'pending') {
        const agent = threadAgentName(snap.thread.provider)
        const conversation = snap.thread.title || i18n.t('thread:notify.untitled')
        return { threadId: snap.thread.id, request: event.request, agent, conversation }
      }
    }
  }
  return null
}

function findBackgroundToastApproval(
  snapshot: ReturnType<typeof useThreadStore.getState>['snapshot'],
  snapshotCache: ReturnType<typeof useThreadStore.getState>['snapshotCache'],
  visibleThreadIds: Set<string>,
  dismissedIds: ReadonlySet<string>,
  openedRequestId: string | null
): OpenedThreadApproval | null {
  const entries = collectSnapshots(snapshot, snapshotCache)
  let best: OpenedThreadApproval | null = null
  for (const snap of entries.values()) {
    if (visibleThreadIds.has(snap.thread.id)) continue
    const agent = threadAgentName(snap.thread.provider)
    const conversation = snap.thread.title || i18n.t('thread:notify.untitled')
    for (const event of snap.events) {
      if (event.type !== 'request' || event.request.kind !== 'approval' || event.request.state !== 'pending') continue
      if (!event.request.impact) continue
      if (dismissedIds.has(event.request.id) || event.request.id === openedRequestId) continue
      if (!best || event.request.createdAt < best.request.createdAt) {
        best = { threadId: snap.thread.id, request: event.request, agent, conversation }
      }
    }
  }
  return best
}

/**
 * What stands in for the approval window when it crashed after mounting: every request it held, and every one that
 * arrives later, goes back to main's own dialog (`approvals.unavailable`, once each), and the person is told where to
 * answer. Never an answer, and never nothing (R4).
 */
function ApprovalsUnavailable(): ReactElement {
  useEffect(() => { handBackAll() }, [])
  return <p role="status" data-testid="approvals-unavailable" style={{ position: 'fixed', insetInline: 0, bottom: 0, margin: 0, padding: 'var(--space-2) var(--space-3)', background: 'var(--intent-warning-bg)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', zIndex: 'var(--layer-toast, var(--layer-popover))' }}>
    {i18n.t('approvals.unavailableWindow')}
  </p>
}

export function ApprovalsHost(): ReactElement | null {
  const [Center, setCenter] = useState<ComponentType | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [initialQueueSelectedId, setInitialQueueSelectedId] = useState<string | null>(null)
  const [QueueModal, setQueueModal] = useState<ComponentType<{ onClose: () => void; initialSelectedId?: string | null }> | null>(null)
  const [PreviewModal, setPreviewModal] = useState<ComponentType<ImpactPreviewProps> | null>(null)
  const [dismissedToastIds, setDismissedToastIds] = useState<Set<string>>(() => new Set())

  const pendingView = usePendingView()
  const openedRequestId = useOpenRequest(state => state.requestId)
  const snapshot = useThreadStore(state => state.snapshot)
  const snapshotCache = useThreadStore(state => state.snapshotCache)
  const selectedThreadId = useThreadStore(state => state.selectedId)
  const secondaryThreadId = useThreadStore(state => state.secondaryId)

  useEffect(() => {
    if (pendingView) {
      setQueueOpen(false)
      setInitialQueueSelectedId(null)
    }
  }, [pendingView])

  const visibleThreadIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedThreadId) ids.add(selectedThreadId)
    if (secondaryThreadId) ids.add(secondaryThreadId)
    return ids
  }, [selectedThreadId, secondaryThreadId])

  const openedTarget = useMemo(
    () => findPendingThreadApproval(openedRequestId, snapshot, snapshotCache),
    [openedRequestId, snapshot, snapshotCache]
  )
  const needsImpactPreview = Boolean(openedTarget?.request.impact && !openedTarget.request.impact.reversible)

  const toastTarget = useMemo(
    () => findBackgroundToastApproval(snapshot, snapshotCache, visibleThreadIds, dismissedToastIds, openedRequestId),
    [snapshot, snapshotCache, visibleThreadIds, dismissedToastIds, openedRequestId]
  )

  useKeybindings({
    'approvals.queue': () => window.dispatchEvent(new CustomEvent(OPEN_APPROVAL_QUEUE_EVENT))
  })
  useEffect(() => {
    const toggle = (): void => {
      setQueueOpen(open => {
        if (open) {
          setInitialQueueSelectedId(null)
          return false
        }
        const currentRequestId = useOpenRequest.getState().requestId
        setInitialQueueSelectedId(currentRequestId)
        if (currentRequestId) useOpenRequest.getState().close()
        return true
      })
    }
    window.addEventListener(OPEN_APPROVAL_QUEUE_EVENT, toggle)
    return () => window.removeEventListener(OPEN_APPROVAL_QUEUE_EVENT, toggle)
  }, [])

  useEffect(() => {
    if (!queueOpen || QueueModal) return
    let alive = true
    void import('./ApprovalQueue')
      .then(mod => {
        if (alive) setQueueModal(() => mod.ApprovalQueueModal)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [queueOpen, QueueModal])

  useEffect(() => {
    if (!needsImpactPreview || PreviewModal) return
    let alive = true
    void import('./ImpactPreview')
      .then(mod => {
        if (alive) setPreviewModal(() => mod.ImpactPreview)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [needsImpactPreview, PreviewModal])

  useEffect(() => {
    if (!openedTarget) return
    void useThreadStore.getState().select(openedTarget.threadId)
    if (!needsImpactPreview) {
      const frame = requestAnimationFrame(() => {
        const deny = document.querySelector<HTMLElement>('.thread-request-approval .thread-request-decline')
        deny?.scrollIntoView?.({ block: 'nearest' })
        deny?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
    return undefined
  }, [openedTarget, needsImpactPreview])

  useEffect(() => {
    const stopOpen = startOpenRequestListener()
    const api = approvalsApi()
    if (!api) return stopOpen
    const stop = startApprovals({ api, onReady: module => setCenter(() => module.ApprovalCenter) })
    const cancelPreload = schedulePreload()
    return () => { stopOpen(); stop(); cancelPreload() }
  }, [])

  const showPreview = Boolean(needsImpactPreview && openedTarget && PreviewModal && !queueOpen)
  const showCenter = Boolean(Center && !queueOpen)
  const showToast = Boolean(toastTarget && !queueOpen && !showPreview)

  if (!showCenter && !(queueOpen && QueueModal) && !showPreview && !showToast) return null
  return <>
    {showCenter && Center ? <ErrorBoundary id="approvals" label={i18n.t('approvals.boundaryLabel')} fallback={<ApprovalsUnavailable />}><Center /></ErrorBoundary> : null}
    {queueOpen && QueueModal ? <QueueModal initialSelectedId={initialQueueSelectedId} onClose={() => { setQueueOpen(false); setInitialQueueSelectedId(null) }} /> : null}
    {showPreview && openedTarget && PreviewModal ? (
      <PreviewModal
        request={openedTarget.request}
        agent={openedTarget.agent}
        conversation={openedTarget.conversation}
        onClose={() => useOpenRequest.getState().close()}
        onRespond={async response => {
          useOpenRequest.getState().close()
          if (window.oxe?.thread?.respond) {
            await window.oxe.thread.respond(openedTarget.threadId, openedTarget.request.id, response)
            await useThreadStore.getState().refresh(openedTarget.threadId)
          }
        }}
      />
    ) : null}
    {showToast && toastTarget ? (
      <ApprovalToast
        request={toastTarget.request}
        agent={toastTarget.agent}
        onClose={() => setDismissedToastIds(prev => new Set(prev).add(toastTarget.request.id))}
        onSeeImpact={() => {
          setDismissedToastIds(prev => new Set(prev).add(toastTarget.request.id))
          if (toastTarget.request.impact && !toastTarget.request.impact.reversible) {
            useOpenRequest.getState().open(toastTarget.request.id)
          } else {
            void useThreadStore.getState().select(toastTarget.threadId)
          }
        }}
        onRespond={async response => {
          setDismissedToastIds(prev => new Set(prev).add(toastTarget.request.id))
          if (window.oxe?.thread?.respond) {
            await window.oxe.thread.respond(toastTarget.threadId, toastTarget.request.id, response)
            await useThreadStore.getState().refresh(toastTarget.threadId)
          }
        }}
      />
    ) : null}
  </>
}
