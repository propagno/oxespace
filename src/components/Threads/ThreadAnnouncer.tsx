import { useEffect, useRef, useState } from 'react'
import type { ConversationThread } from '../../../shared/types/thread'
import { i18n } from '../../i18n'

const THROTTLE_MS = 2000

/** What a screen reader should hear when the conversation's state changes; null when nothing is worth saying. */
export function threadAnnouncement(previous: Pick<ConversationThread, 'status' | 'lastTurnStatus'>, current: Pick<ConversationThread, 'status' | 'lastTurnStatus'>, pendingRequests: number): string | null {
  if (previous.status === current.status) return null
  if (current.status === 'approval') return pendingRequests > 1 ? i18n.t('thread:announce.needsInputMany', { count: pendingRequests }) : i18n.t('thread:announce.needsInput')
  // Resuming after an answer is the same turn, not news.
  if (current.status === 'running') return previous.status === 'approval' ? null : i18n.t('thread:announce.working')
  if (current.status === 'failed') return i18n.t('thread:announce.failed')
  if (current.status === 'interrupted') return i18n.t('thread:announce.stopped')
  if (previous.status !== 'running' && previous.status !== 'approval') return null
  return current.lastTurnStatus === 'failed' ? i18n.t('thread:announce.failed') : current.lastTurnStatus === 'interrupted' ? i18n.t('thread:announce.stopped') : i18n.t('thread:announce.finished')
}

/**
 * A polite live region for the conversation's state: working, waiting for
 * input, finished or failed. Throttled so a busy turn does not flood the
 * screen reader; the latest state always wins.
 */
export function ThreadAnnouncer({ thread, pendingRequests }: { thread: ConversationThread; pendingRequests: number }) {
  const [message, setMessage] = useState('')
  const previous = useRef<{ id: string; status: ConversationThread['status']; lastTurnStatus?: ConversationThread['lastTurnStatus'] } | null>(null)
  const lastSpoken = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const before = previous.current?.id === thread.id ? previous.current : null
    previous.current = { id: thread.id, status: thread.status, lastTurnStatus: thread.lastTurnStatus }
    // Opening a conversation is not a change worth announcing.
    if (!before) return
    const next = threadAnnouncement(before, thread, pendingRequests)
    if (!next) return
    if (timer.current) clearTimeout(timer.current)
    const wait = Math.max(0, lastSpoken.current + THROTTLE_MS - Date.now())
    timer.current = setTimeout(() => { lastSpoken.current = Date.now(); setMessage(next) }, wait)
  }, [thread, pendingRequests])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return <div className="thread-sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</div>
}
