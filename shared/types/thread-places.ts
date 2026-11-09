import type { FileSystemReadFileResult } from './filesystem'

/** F4 places (1.5.0 A13): where one conversation read or wrote, from evidence only (ccr-t71-task-places.md §2). */
export const THREAD_PLACE_LIMITS = { places: 32, outside: 16 } as const

/** root = the thread's rootPath; worktree = the same repository; checkout = another repository; outside = no git. */
export type ThreadPlaceKind = 'root' | 'worktree' | 'checkout' | 'outside'
export interface ThreadPlaceHead { branch: string | null; commit: string | null }
/** A15 (ccr-t71-task-places.md §4.1 thread:place-drift-answer): the closed list of answers to a branch drift. */
export const THREAD_PLACE_DRIFT_ANSWERS = ['switched-back', 'followed', 'dismissed'] as const
export type ThreadPlaceDriftAnswer = typeof THREAD_PLACE_DRIFT_ANSWERS[number]
/** Captured at first touch inside a running turn; never moves on its own. */
export interface ThreadPlaceBase { commit: string | null; branch: string | null; capturedAt: number; turnId: string | null }
export interface ThreadPlaceDrift {
  from: ThreadPlaceHead
  to: ThreadPlaceHead
  seenAt: number
  /** Panes in that place: a hint, never proof. */
  by: { kind: 'pane'; id: string; title: string }[]
  certain: boolean
  /** Uncommitted changes in the place when the drift was seen; Switch back checks again before it runs. */
  dirty?: boolean
  /** The base had no branch (a detached HEAD): there is no branch to switch back to. */
  detached?: boolean
  answer?: ThreadPlaceDriftAnswer
}
export interface ThreadPlace {
  /** Stable per thread: a hash of the canonical path. */
  id: string
  kind: ThreadPlaceKind
  /** The checkout root, or for outside the folder the write was in. */
  path: string
  firstSeenAt: number
  /** Null for outside, and until the place is first touched inside a running turn. */
  base: ThreadPlaceBase | null
  /** Read on every request, never stored. Null for outside. */
  current: ThreadPlaceHead | null
  drift: ThreadPlaceDrift | null
  /** Files written there, from tool evidence. */
  writes: number
  /** The written paths, relative to the place, newest first. */
  files: string[]
}
export interface ThreadPlaces {
  places: ThreadPlace[]
  /** True once a new place was refused by the 32 + 16 caps. */
  capped: boolean
  /** Evidence paths refused (not absolute, a share, a link out, a missing folder); counted, never stored. */
  refused: number
}
/** One file the task wrote in a place (relative to it), with its tool evidence's counts when the tool gave them. */
export interface ThreadPlaceWrite {
  path: string
  kind: 'add' | 'update' | 'delete' | 'rename'
  additions?: number
  deletions?: number
}
/**
 * A14 (ccr-t71-task-places.md §2.6, §4.1 thread:place-diff): a git place diffs against its own base; a branch switch the
 * task did not follow puts the files it changed in `branchSwitch`. An outside place lists what was written, no diff.
 */
export type ThreadPlaceDiff = {
  place: ThreadPlace
  groups: { task: import('./git').GitDiff; branchSwitch?: import('./git').GitDiff } | { written: ThreadPlaceWrite[] }
}
/** A14 Undo (ccr-f4-places-pr.md §A14 Undo): one file, or one hunk by its header, with the mtime the diff showed. */
export interface ThreadPlaceUndoInput { path: string; hunk?: string; seenMtime: number | null }
/** The restore token is held in memory only: single use, bound to its thread and place, gone at the next turn or 10 minutes. */
export type ThreadPlaceUndoResult = { ok: true; restoreToken: string } | { ok: false; refusal: import('../messages').MainMessage }
export type ThreadPlaceActionResult = { ok: true } | { ok: false; refusal: import('../messages').MainMessage }
/** A17 (ccr-t71-task-places.md §4.1 thread:place-read): fs:read-file's shape for a file in a place from evidence; never writable. */
export interface ThreadPlaceReadResult extends FileSystemReadFileResult { readOnly: true }
/** A pane as the app's pane registry describes it, for the places a pane works in. */
export interface ThreadPaneSource { paneId: string; title: string; workspaceId: string; launchDir: string; agentCwd?: string | null; shellCwd?: string | null; agent?: boolean }
/** How a pane's cwd was known: its shell's OSC report, its agent's hook location, or the folder it was launched in. */
export type ThreadPaneVia = 'launch' | 'agent-location' | 'shell-osc'
/** A18 (ccr-t71-task-places.md §6, thread:panes): a pane whose newest known cwd is in one of the task's places. */
export interface ThreadPane { paneId: string; title: string; workspaceId: string; placeId: string; via: ThreadPaneVia; group: 'agent' | 'yours' }

/**
 * A54 (ccr-f4-places-pr.md §A54): a file this conversation wrote that is still dirty, which another non-archived
 * conversation also wrote and left dirty in the same checkout. `checkoutId` is a hash of the canonical checkout root;
 * a worktree of the same repository is another checkout.
 */
export interface ThreadCollision {
  /** Relative to the checkout root, forward slashes. */
  file: string
  checkoutId: string
  others: { conversationId: string; title: string }[]
}
/** FE-P9 (thread:agent-summary): what the agent did in this conversation; null is a source main could not read, named in failedSources. */
export interface ThreadAgentSummary {
  files: number | null
  databases: number | null
  http: number | null
  httpProduction: number | null
  containers: number | null
  approvals: number | null
  failedSources: string[]
}
/** One conversation's written-and-dirty files in one checkout, the input of the collision intersection. */
export interface ThreadDirtyWrites {
  conversationId: string
  title: string
  checkoutId: string
  /** Relative to the checkout root, forward slashes. */
  files: string[]
}

/** The resolver's order (ccr-t71-task-places.md §3). */
export const THREAD_PATH_STEPS = ['absolute', 'turn-cwd', 'checkout-root', 'task-worktree', 'project-root', 'task-place', 'sibling-worktree'] as const
export type ThreadPathStep = typeof THREAD_PATH_STEPS[number]
export type ThreadPathResolution =
  | { kind: 'found'; path: string; placeId: string | null; via: ThreadPathStep; line?: number }
  | { kind: 'ambiguous'; candidates: { path: string; placeId: string | null; via: ThreadPathStep }[] }
  | { kind: 'missing'; looked: { step: ThreadPathStep; path: string }[] }
