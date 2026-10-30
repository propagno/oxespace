import { useEffect, useRef } from 'react'
import type { ConversationThread, ThreadPendingRequestSummary, ThreadStatus } from '../../shared/types/thread'
import { useActivityStore, type ActivityKind } from '../store/activity.store'
import { useSettingsStore } from '../store/settings.store'
import { useThreadStore } from '../store/thread.store'
import { decideThreadAttention, threadAttentionText, type ThreadAttentionKind } from '../utils/threadAttention'

/** Prefix that routes a notification click to a thread instead of a terminal pane. */
export const THREAD_NOTIFICATION_PANE_PREFIX = 'thread:'

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
        // Approved or answered elsewhere: the entry no longer waits on anyone.
        if (previous === 'approval' && thread.status !== 'approval') activity.resolve('thread', thread.id)
        const watching = view.current === 'thread' && focused && (thread.id === selectedId || thread.id === secondaryId)
        const decision = decideThreadAttention({ previous, current: thread, viewing: watching })
        if (!decision.kind) continue
        activity.record({ source: 'thread', id: thread.id, kind: ACTIVITY_KIND[decision.kind], target: threadTarget(thread), title: thread.title.trim() || 'Conversation', detail: threadAttentionText(decision.kind, thread.title).body, read: watching })
        if (decision.unread) markUnread(thread.id)
        if (decision.notify && notificationsEnabled) {
          const text = threadAttentionText(decision.kind, thread.title)
          void window.oxe?.notifications?.notify({
            ...text,
            paneId: `${THREAD_NOTIFICATION_PANE_PREFIX}${thread.id}`,
            workspaceId: thread.workspaceId
          }).catch(() => undefined)
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
  const titles = new Map(threads.map(thread => [thread.id, thread.title.trim()]))
  const activity = useActivityStore.getState()
  for (const [threadId, requests] of byThread) {
    // Answered while the read was in flight, or the view went away.
    if (!stillWaiting(threadId)) continue
    const first = requests[0]
    activity.record({
      source: 'thread', id: threadId, kind: 'needs-you',
      target: threadTarget({ id: threadId, workspaceId: first.workspaceId }),
      title: titles.get(threadId) || first.threadTitle || 'Conversation',
      detail: requests.length > 1 ? `${requests.length} requests are waiting for your decision.` : first.title,
      at: Math.max(...requests.map(request => request.createdAt))
    })
  }
}
