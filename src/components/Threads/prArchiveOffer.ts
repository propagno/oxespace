import type { GitHubPrStatus } from '../../../shared/types/github'
import type { ConversationThread } from '../../../shared/types/thread'

/** How long the offer to archive waits before archiving, counted while the toast is not paused (T40). */
export const PR_ARCHIVE_OFFER_MS = 10_000

/**
 * T40 (B20, the person's decision of 31/10): the pull request of a conversation's own worktree closed or merged, so
 * the conversation is offered to be archived. Only the conversation linked to that PR: one with its own worktree whose
 * branch is the PR's head. Never one at the project root (many conversations share that branch), never one already
 * archived, never again for a PR the person chose to keep it through.
 */
export function prArchiveOffer(thread: Pick<ConversationThread, 'archived' | 'ownedWorktree' | 'keptAfterPr'>, status: GitHubPrStatus | null): { prNumber: number; merged: boolean } | null {
  if (!status || (status.state !== 'MERGED' && status.state !== 'CLOSED')) return null
  const branch = thread.ownedWorktree?.branch
  if (thread.archived || !branch || status.headRefName !== branch) return null
  if (thread.keptAfterPr?.includes(status.number)) return null
  return { prNumber: status.number, merged: status.state === 'MERGED' }
}
