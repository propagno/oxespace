import { useEffect, useRef } from 'react'
import { i18n } from '../i18n'
import type { ConversationThread, ThreadPendingRequestSummary, ThreadStatus } from '../../shared/types/thread'
import { useActivityStore, type ActivityKind } from '../store/activity.store'
import { useSettingsStore } from '../store/settings.store'
import { useThreadStore } from '../store/thread.store'
import { displayThreadTitle } from '../components/Threads/threadTitle'
import { decideThreadAttention, threadAttentionText, type ThreadAttentionKind } from '../utils/threadAttention'
import { sendAgentNotice, type AgentNoticeKind } from './agentNotify'

import { THREAD_NOTIFICATION_PANE_PREFIX } from './notificationPrefixes'
export { THREAD_NOTIFICATION_PANE_PREFIX }

const SETTLE_MS = 300

/**
 * Raises unread markers and OS notifications when a conversation finishes,
 * fails or asks for approval — including while Code mode is showing and the
 * Thread view was never opened, which the Thread store alone cannot see.
 *
 * It keeps its own status map (seeded silently on the first sighting) rather
 * than relying on the store, whose catalog only refreshes while Thread mode is
 * mounted.
 */
export function useThreadAttention(applicationView: import('../keyboard/keybindings').AppView): void {
  const view = useRef(applicationView)
  view.current = applicationView

  useEffect(() => {
    const api = window.oxe?.thread
    if (!api?.list || !api.onChanged) return
    const known = new Map<string, ThreadStatus>()
    let seeded = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const evaluate = async (): Promise<void> => {
      let threads: Awaited<ReturnType<NonNullable<typeof api.list>>>
      try { threads = await api.list!() } catch { return }
      if (disposed) return
      const { selectedId, secondaryId, markUnread } = useThreadStore.getState()
      const focused = typeof document === 'undefined' ? true : document.hasFocus()
      const notificationsEnabled = useSettingsStore.getState().notificationsEnabled

      const activity = useActivityStore.getState()
      if (!seeded && api.pendingRequestsAll) void seedPending(() => api.pendingRequestsAll!(), threads, id => !disposed && known.get(id) === 'approval')
      for (const thread of threads) {
        const previous = seeded ? known.get(thread.id) : undefined
        known.set(thread.id, thread.status)
        // A thread created after the first scan has no previous status either;
        // it is new, not "finished".
        if (!seeded) continue
        // Approved or answered elsewhere: keep the entry in history, read, with its outcome.
        if (previous === 'approval' && thread.status !== 'approval') {
          void resolveApprovalEntry(api.read, thread, () => disposed || known.get(thread.id) === 'approval')
        }
        const watching = view.current === 'thread' && focused && (thread.id === selectedId || thread.id === secondaryId)
        const decision = decideThreadAttention({ previous, current: thread, viewing: watching })
        if (!decision.kind) continue
        const text = threadAttentionText(decision.kind, displayThreadTitle(thread.title), threadPlace(thread))
        activity.record({ source: 'thread', id: thread.id, kind: ACTIVITY_KIND[decision.kind], target: threadTarget(thread), title: displayThreadTitle(thread.title), detail: text.body, place: { project: threadPlace(thread), mode: 'chat' }, read: watching })
        if (decision.unread) markUnread(thread.id)
        if (decision.notify && notificationsEnabled) {
          sendAgentNotice({
            ...text,
            kind: NOTICE_KIND[decision.kind],
            paneId: `${THREAD_NOTIFICATION_PANE_PREFIX}${thread.id}`,
            workspaceId: thread.workspaceId
          })
        }
      }
      seeded = true
    }

    const schedule = (): void => {
      if (timer) return
      timer = setTimeout(() => { timer = undefined; void evaluate() }, SETTLE_MS)
    }

    void evaluate()
    const unsubscribe = api.onChanged(schedule)
    return () => {
      disposed = true
      unsubscribe?.()
      if (timer) clearTimeout(timer)
    }
  }, [])
}

const ACTIVITY_KIND: Record<ThreadAttentionKind, ActivityKind> = { 'needs-approval': 'needs-you', failed: 'failed', finished: 'finished' }
const NOTICE_KIND: Record<ThreadAttentionKind, AgentNoticeKind> = { 'needs-approval': 'needs-you', failed: 'other', finished: 'finished' }

/** Where a conversation is: its project's name, else the folder it runs in. */
export function threadPlace(thread: Pick<ConversationThread, 'projectId' | 'rootPath'>): string {
  const project = useThreadStore.getState().projects.find(candidate => candidate.projectId === thread.projectId)
  const named = project?.displayName?.trim() || project?.contexts.find(context => context.rootPath === thread.rootPath)?.label?.trim()
  if (named) return named
  return (thread.rootPath ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}

function threadTarget(thread: Pick<ConversationThread, 'id' | 'workspaceId'>): { type: 'thread'; threadId: string; workspaceId?: string } {
  return { type: 'thread', threadId: thread.id, ...(thread.workspaceId ? { workspaceId: thread.workspaceId } : {}) }
}

/**
 * Conversations already waiting when the app opened never pass through a transition, so their
 * requests are read once, across every conversation, to fill "Needs you".
 */
async function seedPending(read: () => Promise<ThreadPendingRequestSummary[]>, threads: ConversationThread[], stillWaiting: (threadId: string) => boolean): Promise<void> {
  let pending: ThreadPendingRequestSummary[]
  try { pending = await read() } catch { return }
  // An older main process, or a test double, can answer with something that is not a list.
  if (!Array.isArray(pending)) return
  const byThread = new Map<string, ThreadPendingRequestSummary[]>()
  for (const request of pending) byThread.set(request.threadId, [...(byThread.get(request.threadId) ?? []), request])
  const threadById = new Map(threads.map(thread => [thread.id, thread]))
  const activity = useActivityStore.getState()
  for (const [threadId, requests] of byThread) {
    // Answered while the read was in flight, or the view went away.
    if (!stillWaiting(threadId)) continue
    const first = requests[0]
    const thread = threadById.get(threadId)
    activity.record({
      source: 'thread', id: threadId, kind: 'needs-you',
      target: threadTarget({ id: threadId, workspaceId: first.workspaceId }),
      title: thread ? displayThreadTitle(thread.title) : displayThreadTitle(first.threadTitle),
      detail: requests.length > 1 ? i18n.t('notify.requestsWaiting', { ns: 'thread', count: requests.length }) : first.title,
      place: { project: thread ? threadPlace(thread) : '', mode: 'chat' },
      at: Math.max(...requests.map(request => request.createdAt))
    })
  }
}

function mapResolutionOutcome(resolution: string | undefined): 'allowed' | 'denied' | 'answered' {
  if (resolution === 'approved') return 'allowed'
  if (resolution === 'declined') return 'denied'
  return 'answered'
}

async function resolveApprovalEntry(
  readThread: NonNullable<NonNullable<typeof window.oxe>['thread']>['read'] | undefined,
  thread: ConversationThread,
  cancelled: () => boolean
): Promise<void> {
  let outcome: 'allowed' | 'denied' | 'answered' = 'answered'
  if (readThread) {
    try {
      const data = await readThread(thread.id)
      const resolved = data.events
        .filter((event): event is Extract<typeof event, { type: 'request' }> =>
          event.type === 'request' && event.request.kind === 'approval' && event.request.state === 'resolved'
        )
        .sort((a, b) => (a.request.resolvedAt ?? a.request.createdAt) - (b.request.resolvedAt ?? b.request.createdAt))
        .pop()
      if (resolved) outcome = mapResolutionOutcome(resolved.request.resolution)
    } catch {
      // Fall back to generic 'answered' if the thread cannot be read.
    }
  }
  if (cancelled()) return
  const activity = useActivityStore.getState()
  const existing = activity.items.find(item => item.source === 'thread' && item.id === thread.id)
  if (existing && existing.kind !== 'needs-you') return
  activity.record({
    source: 'thread',
    id: thread.id,
    kind: existing?.kind ?? 'needs-you',
    target: threadTarget(thread),
    title: existing?.title ?? displayThreadTitle(thread.title),
    ...(existing?.detail ? { detail: existing.detail } : {}),
    place: { project: threadPlace(thread), mode: 'chat' },
    outcome,
    at: Date.now(),
    read: true
  })
}
