import type { ThreadDelta, ThreadSnapshot } from '../../shared/types/thread'

/**
 * Applies an incremental read to a window the renderer already holds. Returns
 * null when the delta does not line up with the window (a gap, an unexpected
 * live count), in which case the caller rereads the full window.
 *
 * The window's tail is the live event table, so live seq `s` sits at
 * `events.length - (live - s)` as long as the window reaches back that far.
 */
export function applyThreadDelta(base: ThreadSnapshot, delta: Extract<ThreadDelta, { ok: true }>): ThreadSnapshot | null {
  const live = base.page?.live
  if (live === undefined || !base.page) return null
  const events = base.events.slice()
  const length = events.length
  let next = live
  for (const { seq, event } of delta.events) {
    if (seq < live) {
      const index = length - (live - seq)
      // Older than the window: the renderer never showed it, so there is nothing to patch.
      if (index >= 0) events[index] = event
    } else {
      if (seq !== next) return null
      events.push(event)
      next++
    }
  }
  if (next !== delta.live) return null
  return {
    ...base,
    thread: delta.thread,
    events,
    turns: delta.turns,
    deliveries: delta.deliveries,
    pendingRequests: delta.pendingRequests,
    sync: { epoch: delta.epoch, revision: delta.revision },
    page: { ...base.page, total: base.page.total + (delta.live - live), live: delta.live }
  }
}
