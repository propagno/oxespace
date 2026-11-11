/**
 * C3 codes for F4 places and Remove worktree (A14-A17, A63), split out of shared/messages.ts to keep it under its
 * file-size limit. Same contract: add codes, never repurpose one; the window words them under `messages.<code>`.
 */

/** The F4 place and worktree-remove codes, with their parameters. */
export interface PlaceMessageParams {
  /** F4 (A14): the conversation has no place with this id (it never had one, or the place left). */
  'thread.place.gone': Record<string, never>
  /** F4 (A17): a place that did not come from a tool's write (the root, a worktree, a location-only place) cannot be read here. */
  'thread.place.notEvidence': Record<string, never>
  /** F4 (A17, SECURITY S2): the path leaves the place (an escape, an absolute or device path, a link out). */
  'thread.place.outside': Record<string, never>
  /** F4 (A15): the place has no branch drift left to answer (none was seen, or it was answered already). */
  'thread.place.noDrift': Record<string, never>
  /** F4 (A15, HML 704-3): Switch back waits while this conversation has a running turn. */
  'thread.place.busy': Record<string, never>
  /** F4 (A15): the checkout has uncommitted changes, so Switch back did not run (never stashes, never forces). */
  'thread.place.dirty': Record<string, never>
  /** F4 (A15): the base had no branch (a detached HEAD), so there is no branch to switch back to. */
  'thread.place.detached': Record<string, never>
  /** F4 (A15, HML 704-4): the base branch no longer exists. */
  'thread.place.branchGone': { branch: string }
  /** F4 (A14 Undo): the file changed after its diff was read, or the hunk is no longer in its diff; nothing changed. */
  'thread.place.stale': Record<string, never>
  /** F4 (A14 Undo): the task did not write this file, or it no longer differs from the base; it is never touched. */
  'thread.place.notTask': Record<string, never>
  /** F4 (A14 Restore): the restore token is unknown, used, another conversation's, past the next turn or 10 minutes old. */
  'thread.place.restoreGone': Record<string, never>
  /** F4 (A14 Discard): discarding a place's changes needs the person's confirmation. */
  'thread.place.confirm': Record<string, never>
  /** A63: the path is not one of this repository's worktrees, or it is the main checkout (on its real path). */
  'worktree.remove.notFound': Record<string, never>
  /** A63 / HML 704-6: a pane is inside the worktree, or its conversation is mid-turn. */
  'worktree.remove.busy': { reason: string }
  /** A63 / HML 704-7: the worktree is locked (git worktree lock), with its reason. */
  'worktree.remove.locked': { reason: string }
  /** A63: the worktree has uncommitted changes; Remove never forces. */
  'worktree.remove.dirty': { count: number }
  /** A63 / HML 704-6: git or the OS failed mid-remove (a Windows lock); the worktree stays listed. */
  'worktree.remove.failed': Record<string, never>
  /** A63 / S4: the default branch is never deleted. */
  'worktree.remove.defaultBranch': { branch: string }
  /** A63 / S4: the branch is checked out in another worktree. */
  'worktree.remove.branchInUse': { branch: string }
  /** A63: deleting an unmerged branch needs its own confirmation. */
  'worktree.remove.unmergedBranch': { branch: string }
}

export const PLACE_MESSAGE_CODES = [
  'thread.place.gone',
  'thread.place.notEvidence',
  'thread.place.outside',
  'thread.place.noDrift',
  'thread.place.busy',
  'thread.place.dirty',
  'thread.place.detached',
  'thread.place.branchGone',
  'thread.place.stale',
  'thread.place.notTask',
  'thread.place.restoreGone',
  'thread.place.confirm',
  'worktree.remove.notFound',
  'worktree.remove.busy',
  'worktree.remove.locked',
  'worktree.remove.dirty',
  'worktree.remove.failed',
  'worktree.remove.defaultBranch',
  'worktree.remove.branchInUse',
  'worktree.remove.unmergedBranch'
] as const satisfies readonly (keyof PlaceMessageParams)[]
