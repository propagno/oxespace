import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import { useThreadStore } from '../../store/thread.store'
import { threadError } from './threadError'

/**
 * Keeps the conversation pinned to the latest message while the person is
 * following it, restores the saved position when a thread reopens, and loads
 * earlier history at the top without jumping. A deliberate scroll (wheel,
 * touch, keys, drag) always wins over automatic positioning.
 */
export function useThreadScrollAnchor(snapshot: ThreadSnapshot | null, selectedId: string | null | undefined) {
  const timeline = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null)
  const updateTimelineViewport = useRef<(() => void) | null>(null)
  const following = useRef(true), initialized = useRef(false), lastCount = useRef(0)
  const userScrollIntent = useRef(false)
  const lastScrollDirection = useRef<'up' | 'down' | null>(null)
  const scrollIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const restoreTop = useRef<number | null>(null)
  const lastTop = useRef(0)
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void } | null>(null)
  const visibleThread = useRef(selectedId)
  visibleThread.current = selectedId
  const [showEnd, setShowEnd] = useState(false), [newMessages, setNewMessages] = useState(0), [loadingEarlier, setLoadingEarlier] = useState(false)
  const [historyFeedback, setHistoryFeedback] = useState<{ id: string; text: string; error?: boolean } | null>(null)
  useEffect(() => () => {
    if (restoreTimer.current) clearTimeout(restoreTimer.current)
    if (scrollIntentTimer.current) clearTimeout(scrollIntentTimer.current)
    // Leaving the conversation keeps where the person was, even mid-scroll.
    if (pendingSave.current) { clearTimeout(pendingSave.current.timer); pendingSave.current.save() }
  }, [])

  const cancelScrollRestore = (direction?: 'up' | 'down') => {
    userScrollIntent.current = true
    lastScrollDirection.current = direction ?? null
    // Leaving the end must take effect now: while following, every resize (rows measured as they mount,
    // a streamed message) pulled the view back down, and a small scroll up shook between the two positions.
    if (direction === 'up') following.current = false
    if (scrollIntentTimer.current) clearTimeout(scrollIntentTimer.current)
    scrollIntentTimer.current = setTimeout(() => { userScrollIntent.current = false; scrollIntentTimer.current = null }, 900)
    restoreTop.current = null
    if (restoreTimer.current) clearTimeout(restoreTimer.current)
    restoreTimer.current = null
  }
  const scrollEnd = () => { if (timeline.current) { cancelScrollRestore('down'); userScrollIntent.current = false; following.current = true; timeline.current.scrollTop = timeline.current.scrollHeight; setShowEnd(false); setNewMessages(0) } }
  const loadEarlier = async () => {
    const el = timeline.current
    if (!el || !snapshot?.page?.hasMore || loadingEarlier) return
    const previousHeight = el.scrollHeight
    const loadingId = snapshot.thread.id
    setLoadingEarlier(true)
    setHistoryFeedback(null)
    try {
      const count = await useThreadStore.getState().loadEarlier(loadingId)
      if (visibleThread.current !== loadingId) return
      if (count) requestAnimationFrame(() => { if (visibleThread.current === loadingId && timeline.current === el) el.scrollTop += el.scrollHeight - previousHeight })
      else setHistoryFeedback({ id: loadingId, text: 'No public messages in this section. Continue loading earlier messages if available.' })
    } catch (cause) { if (visibleThread.current === loadingId) setHistoryFeedback({ id: loadingId, text: threadError(cause), error: true }) }
    finally { setLoadingEarlier(false) }
  }
  useLayoutEffect(() => {
    const el = timeline.current
    if (!el || !snapshot || !el.clientHeight) return
    if (!initialized.current) {
      const saved = useThreadStore.getState().scrollPositions[snapshot.thread.id]
      following.current = saved?.following ?? true
      restoreTop.current = saved && !saved.following ? saved.top : null
      el.scrollTop = saved && !saved.following ? saved.top : el.scrollHeight
      if (restoreTop.current !== null) {
        if (restoreTimer.current) clearTimeout(restoreTimer.current)
        restoreTimer.current = setTimeout(() => {
          if (timeline.current) timeline.current.scrollTop = restoreTop.current ?? timeline.current.scrollTop
          restoreTop.current = null
          if (timeline.current) useThreadStore.getState().setScroll(snapshot.thread.id, timeline.current.scrollTop, false)
        }, 500)
      }
      initialized.current = true
      lastCount.current = snapshot.events.length
    } else if (following.current) el.scrollTop = el.scrollHeight
    if (!following.current && snapshot.events.length > lastCount.current) setNewMessages(count => count + snapshot.events.length - lastCount.current)
    lastCount.current = snapshot.events.length
    setShowEnd(!following.current)
  }, [snapshot])
  useEffect(() => {
    const node = content.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const el = timeline.current
      if (!el?.clientHeight) return
      el.closest<HTMLElement>('.thread-view')?.style.setProperty('--thread-scrollbar-width', `${el.offsetWidth - el.clientWidth}px`)
      if (restoreTop.current !== null) {
        // Estimated virtual rows can initially clamp a saved position. Retry
        // as their real heights arrive, before persisting a provisional offset.
        el.scrollTop = restoreTop.current
      } else if (following.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(node)
    if (timeline.current) observer.observe(timeline.current)
    return () => observer.disconnect()
  }, [])

  /** Handlers for the scrolling timeline element. */
  const timelineProps = {
    onWheel: (event: { deltaY: number }) => cancelScrollRestore(event.deltaY < 0 ? 'up' : 'down'),
    onTouchStart: () => cancelScrollRestore(),
    onTouchMove: () => cancelScrollRestore(),
    onPointerDown: () => cancelScrollRestore(),
    onPointerMove: (event: { buttons: number }) => { if (event.buttons) cancelScrollRestore() },
    onKeyDown: (event: { key: string }) => cancelScrollRestore(['Home', 'PageUp', 'ArrowUp'].includes(event.key) ? 'up' : ['End', 'PageDown', 'ArrowDown'].includes(event.key) ? 'down' : undefined),
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget; if (!el.clientHeight || !snapshot) return
      updateTimelineViewport.current?.()
      if (restoreTop.current !== null) return
      const movedUp = el.scrollTop < lastTop.current - 1
      lastTop.current = el.scrollTop
      // Dragging the scrollbar reports no direction; read it from the movement.
      if (userScrollIntent.current && movedUp) { following.current = false; lastScrollDirection.current = 'up' }
      if (el.scrollTop <= 32 && snapshot.page?.hasMore && !loadingEarlier) void loadEarlier()
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= 64
      if (following.current && !atEnd && !userScrollIntent.current) {
        requestAnimationFrame(() => { if (following.current && timeline.current === el) el.scrollTop = el.scrollHeight })
        return
      }
      // Measurements can shrink a long timeline until the browser clamps its
      // scrollTop near the end. That is not an intentional return to the end.
      following.current = atEnd && !(lastScrollDirection.current === 'up' && !following.current)
      if (following.current) lastScrollDirection.current = null
      setShowEnd(!following.current); if (following.current) setNewMessages(0)
      // Saved once the scroll settles: a store write per scroll event re-rendered its subscribers each frame.
      const threadId = snapshot.thread.id, top = el.scrollTop, follow = following.current
      if (pendingSave.current) clearTimeout(pendingSave.current.timer)
      const save = () => { pendingSave.current = null; useThreadStore.getState().setScroll(threadId, top, follow) }
      pendingSave.current = { timer: setTimeout(save, 150), save }
    }
  }

  return {
    timeline, content, following, updateTimelineViewport, timelineProps,
    showEnd, newMessages, loadingEarlier, historyFeedback, scrollEnd, loadEarlier,
    /** Re-applies the saved position on the next render, e.g. after recovering the conversation. */
    reinitialize: () => { initialized.current = false }
  }
}
