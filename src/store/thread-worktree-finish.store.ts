import { create } from 'zustand'
import type { ThreadWorktreeFinishAction } from '../../shared/threadWorktree'

/**
 * A request to archive or delete a conversation that owns a worktree. The conversation actions (sidebar menu,
 * `/archive`, `/delete`) only record it here; the sidebar shows the question, so there is one place that asks.
 */
export const useThreadWorktreeFinishStore = create<{
  request: { threadId: string; action: ThreadWorktreeFinishAction } | null
  ask: (threadId: string, action: ThreadWorktreeFinishAction) => void
  clear: () => void
}>(set => ({
  request: null,
  ask: (threadId, action) => set({ request: { threadId, action } }),
  clear: () => set({ request: null })
}))
