import { useEffect, useMemo, useState, type ComponentType, type ReactElement } from 'react'
import type { ThreadRequest } from '../../../shared/types/thread'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { i18n } from '../../i18n'
import { useKeybindings } from '../../keyboard/keybindings'
import { useThreadStore } from '../../store/thread.store'
import { approvalsApi } from './approvalsApi'
import { handBackAll, schedulePreload, startApprovals } from './approvalsBoot'
import type { ImpactPreviewProps } from './ImpactPreview'
import { startOpenRequestListener, useOpenRequest } from './openRequest'

export { OPEN_APPROVAL_HISTORY_EVENT } from './approvalsBoot'

interface OpenedThreadApproval {
  threadId: string
  request: ThreadRequest
  agent: string
  conversation: string
}

function findPendingThreadApproval(
  requestId: string | null,
  snapshot: ReturnType<typeof useThreadStore.getState>['snapshot'],
  snapshotCache: ReturnType<typeof useThreadStore.getState>['snapshotCache']
): OpenedThreadApproval | null {
  if (!requestId) return null
  const entries = new Map<string, NonNullable<typeof snapshot>>()
  for (const snap of Object.values(snapshotCache)) entries.set(snap.thread.id, snap)
  if (snapshot) entries.set(snapshot.thread.id, snapshot)
  for (const snap of entries.values()) {
    for (const event of snap.events) {
      if (event.type === 'request' && event.request.id === requestId && event.request.state === 'pending') {
        const agent = snap.thread.provider === 'codex'
          ? 'Codex'
          : snap.thread.provider === 'claude'
            ? 'Claude'
            : i18n.t('thread:f7.card.defaultAgent')
        const conversation = snap.thread.title || i18n.t('thread:notify.untitled')
        return { threadId: snap.thread.id, request: event.request, agent, conversation }
      }
    }
  }
  return null
}

/**
 * What stands in for the approval window when it crashed after mounting: every request it held, and every one that
 * arrives later, goes back to main's own dialog (`approvals.unavailable`, once each), and the person is told where to
 * answer. Never an answer, and never nothing (R4).
 */
function ApprovalsUnavailable(): ReactElement {
  useEffect(() => { handBackAll() }, [])
  return <p role="status" data-testid="approvals-unavailable" style={{ position: 'fixed', insetInline: 0, bottom: 0, margin: 0, padding: 'var(--space-2) var(--space-3)', background: 'var(--intent-warning-bg)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', zIndex: 1000 }}>
    {i18n.t('approvals.unavailableWindow')}
  </p>
}

/**
 * Mounted at boot: listens for approval requests and mounts the approval window (its own chunk) when the first one
 * arrives or the history is asked for. The chunk is fetched at idle after the first paint so a request never waits.
 * A window without the preload has no channel and listens to nothing. A crash inside the approval window (it sits
 * outside the page's boundary) hands every request it held back to main.
 */
export function ApprovalsHost(): ReactElement | null {
  // The approval window's component, from its own chunk (loadCenter, a dynamic import), once it is loaded and needed.
  // Held in state instead of React.lazy: the chunk has settled before it renders, so there is nothing to suspend for,
  // and a failed load stays with the fail-safe instead of throwing during render.
  const [Center, setCenter] = useState<ComponentType | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [QueueModal, setQueueModal] = useState<ComponentType<{ onClose: () => void }> | null>(null)
  const [PreviewModal, setPreviewModal] = useState<ComponentType<ImpactPreviewProps> | null>(null)

  const openedRequestId = useOpenRequest(state => state.requestId)
  const snapshot = useThreadStore(state => state.snapshot)
  const snapshotCache = useThreadStore(state => state.snapshotCache)

  const openedTarget = useMemo(
    () => findPendingThreadApproval(openedRequestId, snapshot, snapshotCache),
    [openedRequestId, snapshot, snapshotCache]
  )
  const needsImpactPreview = Boolean(openedTarget?.request.impact && !openedTarget.request.impact.reversible)

  useKeybindings({
    'approvals.queue': () => setQueueOpen(open => !open)
  })

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

  const showPreview = Boolean(needsImpactPreview && openedTarget && PreviewModal)

  if (!Center && !(queueOpen && QueueModal) && !showPreview) return null
  return <>
    {Center ? <ErrorBoundary id="approvals" label={i18n.t('approvals.boundaryLabel')} fallback={<ApprovalsUnavailable />}><Center /></ErrorBoundary> : null}
    {queueOpen && QueueModal ? <QueueModal onClose={() => setQueueOpen(false)} /> : null}
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
  </>
}
