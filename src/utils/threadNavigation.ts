import type { ConversationThread } from '../../shared/types/thread'

/**
 * The order a person sees threads in: pinned first, then most recently
 * updated, archived and hidden-project threads excluded.
 */
export function navigableThreads(threads: ConversationThread[], hiddenProjects: string[] = []): ConversationThread[] {
  return threads
    .filter((t) => !t.archived && !hiddenProjects.includes(t.projectId))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

/** Next/previous thread id with wraparound; the first one when nothing is selected. */
export function adjacentThreadId(threads: ConversationThread[], currentId: string | null, delta: 1 | -1): string | null {
  if (threads.length === 0) return null
  const index = threads.findIndex((t) => t.id === currentId)
  if (index === -1) return threads[delta === 1 ? 0 : threads.length - 1].id
  return threads[(index + delta + threads.length) % threads.length].id
}
