import { useMemo } from 'react'
import { connectAttentionFeed } from '../store/activity.feed'
import { summarizeAttention, useActivityStore, type AttentionCounts, type AttentionSummary } from '../store/activity.store'

export type { AttentionCounts, AttentionSummary } from '../store/activity.store'

connectAttentionFeed()

/**
 * What needs a person, across every workspace and conversation, so the mode rail can say so
 * even when the project or workspace that holds it is collapsed or in the other mode.
 * Derived from the activity store's live state, the same source the activity center reads.
 */
export function useAttentionSummary(): AttentionSummary {
  const live = useActivityStore(state => state.live)
  return useMemo(() => summarizeAttention(live), [live])
}

/** Spoken form for the badge, so the count is not color alone. */
export function describeAttention(counts: AttentionCounts): string {
  const parts: string[] = []
  if (counts.needsYou) parts.push(`${counts.needsYou} need${counts.needsYou === 1 ? 's' : ''} you`)
  if (counts.failed) parts.push(`${counts.failed} failed`)
  if (!parts.length && counts.working) parts.push(`${counts.working} working`)
  return parts.join(', ')
}
