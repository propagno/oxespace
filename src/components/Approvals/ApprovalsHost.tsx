import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type ReactElement } from 'react'
import { threadAgentName } from '../../../shared/threadProviders'
import type { ThreadRequest } from '../../../shared/types/thread'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { i18n } from '../../i18n'
import { useKeybindings } from '../../keyboard/keybindings'
import { useThreadStore } from '../../store/thread.store'
import { usePendingView } from '../../app/viewSwitch'
import { useGitBranch } from '../../hooks/useGitBranch'
import { scopeBadgeLabel } from '../../utils/paneGitContext'
import { approvalsApi } from './approvalsApi'
import { handBackAll, OPEN_APPROVAL_QUEUE_EVENT, schedulePreload, startApprovals } from './approvalsBoot'
import type { ApprovalToast as ApprovalToastType } from './ApprovalToast'
import type { ImpactPreviewProps } from './ImpactPreview'
import { startOpenRequestListener, useOpenRequest } from './openRequest'

export { OPEN_APPROVAL_HISTORY_EVENT, OPEN_APPROVAL_QUEUE_EVENT } from './approvalsBoot'

interface OpenedThreadApproval {
  threadId: string
  workspaceId: string
  rootPath: string
  ownedWorktreeBranch: string | null
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
        return {
          threadId: snap.thread.id,
          workspaceId: snap.thread.workspaceId,
          rootPath: snap.thread.rootPath,
          ownedWorktreeBranch: snap.thread.ownedWorktree?.branch ?? null,
          request: event.request,
          agent,
          conversation
        }
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
        best = {
          threadId: snap.thread.id,
          workspaceId: snap.thread.workspaceId,
          rootPath: snap.thread.rootPath,
          ownedWorktreeBranch: snap.thread.ownedWorktree?.branch ?? null,
          request: event.request,
          agent,
          conversation
        }
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
  return <p role="status" data-testid="approvals-unavailable" style={{ position: 'fixed', insetInline: 0, bottom: 0, margin: 0, padding: 'var(--space-2) var(--space-3)', background: 'var(--intent-warning-bg)', color: 'var(--tx-primary)', fontSize: 'var(--fs-sm)', zIndex: 'var(--layer-toast)' }}>
    {i18n.t('approvals.unavailableWindow')}
  </p>
}

export function ApprovalsHost(): ReactElement | null {
  const [Center, setCenter] = useState<ComponentType | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [initialQueueSelectedId, setInitialQueueSelectedId] = useState<string | null>(null)
  const [QueueModal, setQueueModal] = useState<ComponentType<{ onClose: () => void; initialSelectedId?: string | null }> | null>(null)
  const [PreviewModal, setPreviewModal] = useState<ComponentType<ImpactPreviewProps> | null>(null)
  const [ToastView, setToastView] = useState<ComponentType<ComponentProps<typeof ApprovalToastType>> | null>(null)
  const [dismissedToastIds, setDismissedToastIds] = useState<Set<string>>(() => new Set())

  const pendingView = usePendingView()
  const openedRequestId = useOpenRequest(state => state.requestId)
  const openedThreadId = useOpenRequest(state => state.threadId)
  /** The opened request already sent to OxeChat (OXE-332): once per opening, not on every snapshot refresh. */
  const sentToThread = useRef<string | null>(null)
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
  // OXE-332: a request whose conversation is not cached loads it (select reads it); the request shows once it arrives.
  const hasOpenedTarget = Boolean(openedTarget)
  useEffect(() => {
    if (!openedRequestId) { sentToThread.current = null; return }
    if (!hasOpenedTarget && openedThreadId) void useThreadStore.getState().select(openedThreadId)
  }, [openedRequestId, openedThreadId, hasOpenedTarget])

  const toastTarget = useMemo(
    () => findBackgroundToastApproval(snapshot, snapshotCache, visibleThreadIds, dismissedToastIds, openedRequestId),
    [snapshot, snapshotCache, visibleThreadIds, dismissedToastIds, openedRequestId]
  )
  const [approvalsQueueLength, setApprovalsQueueLength] = useState<number | null>(null)
  const hasToastTarget = Boolean(toastTarget)
  useEffect(() => {
    if (!hasToastTarget) return
    let alive = true
    let unsubscribe: (() => void) | undefined
    void Promise.all([import('./approvals.store'), import('./ApprovalToast')])
      .then(([mod, toastMod]) => {
        if (!alive) return
        setToastView(() => toastMod.ApprovalToast)
        setApprovalsQueueLength(mod.useApprovalsStore.getState().queue.length)
        unsubscribe = mod.useApprovalsStore.subscribe(state => {
          if (alive) setApprovalsQueueLength(state.queue.length)
        })
      })
      .catch(() => {
        if (alive) setApprovalsQueueLength(0)
      })
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [hasToastTarget])
  const queuedCount = useMemo(() => {
    if (!toastTarget || approvalsQueueLength === null) return 0
    let pending = approvalsQueueLength
    for (const snap of collectSnapshots(snapshot, snapshotCache).values()) {
      for (const event of snap.events) {
        if (event.type === 'request' && event.request.kind === 'approval' && event.request.state === 'pending') pending += 1
      }
    }
    return Math.max(0, pending - 1)
  }, [toastTarget, approvalsQueueLength, snapshot, snapshotCache])
  const needsBranchLookup = Boolean(toastTarget && !toastTarget.ownedWorktreeBranch)
  const gitBranchStatus = useGitBranch(
    toastTarget?.workspaceId ?? '',
    needsBranchLookup ? (toastTarget?.rootPath ?? null) : null,
    needsBranchLookup
  )
  const toastPlace = useMemo(() => {
    if (!toastTarget) return undefined
    if (toastTarget.ownedWorktreeBranch) return toastTarget.ownedWorktreeBranch
    const folderName = toastTarget.rootPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop() ?? toastTarget.rootPath
    if (!gitBranchStatus) return folderName
    return scopeBadgeLabel(gitBranchStatus, folderName) || folderName
  }, [toastTarget, gitBranchStatus])

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
    // Only when it is not already the selected one: select re-reads the conversation, and the fresh snapshot would
    // rebuild openedTarget and run this again without end (OXE-332).
    if (useThreadStore.getState().selectedId !== openedTarget.threadId) void useThreadStore.getState().select(openedTarget.threadId)
    // Answered inline: the window goes to OxeChat on that conversation (App listens; src/app/openThread.ts).
    if (!needsImpactPreview && sentToThread.current !== openedTarget.request.id) {
      sentToThread.current = openedTarget.request.id
      window.dispatchEvent(new CustomEvent('oxe:open-thread', { detail: { threadId: openedTarget.threadId } }))
    }
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
  const showToast = Boolean(toastTarget && ToastView && !queueOpen && !showPreview && approvalsQueueLength !== null)

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
    {showToast && toastTarget && ToastView ? (
      <ToastView
        request={toastTarget.request}
        agent={toastTarget.agent}
        conversation={toastTarget.conversation}
        place={toastPlace}
        queued={queuedCount}
        onClose={() => setDismissedToastIds(prev => new Set(prev).add(toastTarget.request.id))}
        onOpenConversation={() => {
          setDismissedToastIds(prev => new Set(prev).add(toastTarget.request.id))
          void useThreadStore.getState().select(toastTarget.threadId)
        }}
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
