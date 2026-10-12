import { useEffect, useRef } from 'react'
import type { ThreadStatus } from '../../shared/types/thread'
import { useSettingsStore } from '../store/settings.store'
import { useThreadStore } from '../store/thread.store'
import { decideThreadAttention, threadAttentionText } from '../utils/threadAttention'

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
export function useThreadAttention(applicationView: 'code' | 'thread' | 'data'): void {
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

      for (const thread of threads) {
        const previous = seeded ? known.get(thread.id) : undefined
        known.set(thread.id, thread.status)
        // A thread created after the first scan has no previous status either;
        // it is new, not "finished".
        if (!seeded) continue
        const watching = view.current === 'thread' && focused && (thread.id === selectedId || thread.id === secondaryId)
        const decision = decideThreadAttention({ previous, current: thread, viewing: watching })
        if (!decision.kind) continue
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
