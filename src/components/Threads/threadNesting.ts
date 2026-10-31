import type { ConversationThread } from '../../../shared/types/thread'
import { parentIdOf } from './sections/sectionsContract'

/** Deeper levels keep this indent: the parent's name in the row tells where they hang. */
export const MAX_NESTING_DEPTH = 3

/**
 * A list in tree order (B1.3): each conversation followed by the ones it started, in the order the list had them.
 * A child whose parent is not in this list (filtered out, in another section) stays where it was, as a root.
 */
export function nestConversations<T extends Pick<ConversationThread, 'id' | 'parent'>>(list: readonly T[]): T[] {
  const ids = new Set(list.map(thread => thread.id))
  const children = new Map<string, T[]>()
  for (const thread of list) {
    const parent = parentIdOf(thread)
    if (parent && ids.has(parent) && parent !== thread.id) children.set(parent, [...(children.get(parent) ?? []), thread])
  }
  const out: T[] = [], seen = new Set<string>()
  const visit = (thread: T): void => {
    if (seen.has(thread.id)) return
    seen.add(thread.id)
    out.push(thread)
    for (const child of children.get(thread.id) ?? []) visit(child)
  }
  for (const thread of list) {
    const parent = parentIdOf(thread)
    if (!parent || !ids.has(parent) || parent === thread.id) visit(thread)
  }
  // A cycle has no root to start from: keep its members rather than lose them.
  for (const thread of list) visit(thread)
  return out
}

/** How many ancestors a conversation has among `all`, up to MAX_NESTING_DEPTH; a cycle stops there too. */
export function nestingDepth(thread: Pick<ConversationThread, 'id' | 'parent'>, byId: ReadonlyMap<string, Pick<ConversationThread, 'id' | 'parent'>>): number {
  let depth = 0
  const seen = new Set([thread.id])
  for (let parent = parentIdOf(thread); parent && byId.has(parent) && !seen.has(parent) && depth < MAX_NESTING_DEPTH; parent = parentIdOf(byId.get(parent)!)) {
    seen.add(parent)
    depth++
  }
  return depth
}

export interface ChildCounts { total: number; working: number; waiting: number; failed: number }

/** The conversations a parent started that are still listed (archived ones are not), by what they are doing. */
export function childCounts(parentId: string, threads: readonly ConversationThread[]): ChildCounts {
  const counts: ChildCounts = { total: 0, working: 0, waiting: 0, failed: 0 }
  for (const thread of threads) {
    if (thread.archived || parentIdOf(thread) !== parentId) continue
    counts.total++
    if (thread.status === 'running') counts.working++
    else if (thread.status === 'approval') counts.waiting++
    else if (thread.status === 'failed') counts.failed++
  }
  return counts
}
