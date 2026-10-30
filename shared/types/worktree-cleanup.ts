/**
 * Worktree cleanup: finds worktrees that are safe (or at least reviewable) to
 * delete and says, per worktree, why it is a candidate and what blocks it.
 */
export type WorktreeCleanupReason = 'idle-clean' | 'merged' | 'missing-directory'

export type WorktreeCleanupBlocker =
  | 'locked'
  | 'git-status-error'
  | 'dirty-files'
  | 'unpushed-commits'
  | 'unknown-base'
  | 'active-workspace'
  | 'running-terminal'
  | 'live-agent'

/** Cannot be removed from the cleanup flow at all. */
export const HARD_CLEANUP_BLOCKERS: readonly WorktreeCleanupBlocker[] = [
  'locked',
  'active-workspace',
  'running-terminal',
  'live-agent'
]

/** Removal needs the user's explicit consent because work would be lost or is unknown. */
export const CONSENT_CLEANUP_BLOCKERS: readonly WorktreeCleanupBlocker[] = [
  'dirty-files',
  'unpushed-commits',
  'unknown-base',
  'git-status-error'
]

export const WORKTREE_IDLE_CLEANUP_MS = 30 * 24 * 60 * 60 * 1000

/**
 * State only the renderer knows (open panes, running shells, agents), passed
 * in by path so the main process can fold it into the same blocker list.
 */
export interface WorktreeCleanupContext {
  activePaths: string[]
  runningTerminalPaths: string[]
  liveAgentPaths: string[]
}

export interface WorktreeCleanupCandidate {
  path: string
  branch: string | null
  head: string | null
  /** Newest of the worktree's own activity signals, ms epoch; null when unknown. */
  lastActivityAt: number | null
  dirtyCount: number
  ahead: number
  reasons: WorktreeCleanupReason[]
  blockers: WorktreeCleanupBlocker[]
  /** Reasons present and nothing blocking: safe to pre-select. */
  selectedByDefault: boolean
}

export interface WorktreeCleanupScanInput {
  rootPath: string
  context?: WorktreeCleanupContext
  /** Injected for tests. */
  now?: number
}

export interface WorktreeCleanupRemoveInput {
  rootPath: string
  targets: Array<{ path: string; /** User consented to discard/unknown state. */ force: boolean }>
  context?: WorktreeCleanupContext
}

export interface WorktreeCleanupRemoveResult {
  /** The sentence above as a message code the window translates (C3); the text stays for logs and older clients. */
  messageCode?: import('../messages').MainMessage
  path: string
  ok: boolean
  message: string
}
