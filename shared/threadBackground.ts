import type { ConversationThread, ThreadEvent } from './types/thread'

/** How long a background task may be reported as running without ever being reported finished. */
export const BACKGROUND_TRUST_MS = 2 * 60 * 60 * 1000

/** The background tasks still running, from the events; undefined when there are none. */
export function backgroundSummary(events: ThreadEvent[], now = Date.now()): ConversationThread['background'] {
  let running = 0, since = Infinity
  for (const event of events) {
    if (event.type !== 'subagent' || event.state !== 'running') continue
    if (event.startedAt !== undefined && now - event.startedAt >= BACKGROUND_TRUST_MS) continue
    running += 1
    since = Math.min(since, event.startedAt ?? now)
  }
  return running ? { running, since } : undefined
}

/** True while a summary says background work runs and it is not too old to trust. */
export function backgroundRunning(thread: Pick<ConversationThread, 'background'>, now = Date.now()): boolean {
  return Boolean(thread.background?.running && now - thread.background.since < BACKGROUND_TRUST_MS)
}
