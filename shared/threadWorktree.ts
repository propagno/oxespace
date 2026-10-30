import type { OwnedThreadWorktree } from './types/thread'

/**
 * Decisions about a conversation's own worktree, kept free of Git and of the screen so the same rules
 * serve the main process (what to remove) and the dialog (what to ask), and can be tested alone.
 */

/** What Git says about a conversation's worktree right now. */
export interface ThreadWorktreeState {
  /** The folder no longer exists (removed outside the app). */
  missing: boolean
  /** Git could not be read, so an empty worktree cannot be told from one with work in it. */
  unreadable?: boolean
  /** Tracked files with staged or unstaged edits. */
  uncommitted: number
  /** New files Git does not ignore. */
  untracked: number
  /** Commits not pushed: ahead of the upstream, or, with no upstream, made since the branch started. */
  unpushed: number
}

export type ThreadWorktreeFinishDecision =
  | { kind: 'gone' }
  | { kind: 'remove' }
  | { kind: 'ask'; uncommitted: number; untracked: number; unpushed: number; unreadable: boolean }

/** A worktree with nothing in it that is not already elsewhere is removed without asking; any work asks. */
export function decideThreadWorktreeFinish(state: ThreadWorktreeState): ThreadWorktreeFinishDecision {
  if (state.missing) return { kind: 'gone' }
  if (!state.unreadable && state.uncommitted + state.untracked + state.unpushed === 0) return { kind: 'remove' }
  return { kind: 'ask', uncommitted: state.uncommitted, untracked: state.untracked, unpushed: state.unpushed, unreadable: Boolean(state.unreadable) }
}

/** What the person chose when archiving or deleting: let the app decide, keep the worktree, or throw its work away. */
export type ThreadWorktreeChoice = 'auto' | 'keep' | 'discard'
export type ThreadWorktreeFinishAction = 'archive' | 'delete'

/** What the main process does to the folder once the conversation itself is archived or deleted. */
export type ThreadWorktreePlan =
  | { kind: 'leave'; reason: 'missing' | 'chosen' | 'changes' }
  | { kind: 'remove'; force: boolean }

/**
 * Re-decided after the conversation stopped, from a fresh reading: the agent may have written something
 * between the question and the answer, and "auto" never removes work it did not see.
 */
export function planThreadWorktreeFinish(choice: ThreadWorktreeChoice, state: ThreadWorktreeState): ThreadWorktreePlan {
  if (state.missing) return { kind: 'leave', reason: 'missing' }
  if (choice === 'keep') return { kind: 'leave', reason: 'chosen' }
  if (choice === 'discard') return { kind: 'remove', force: true }
  return decideThreadWorktreeFinish(state).kind === 'remove' ? { kind: 'remove', force: false } : { kind: 'leave', reason: 'changes' }
}

export interface ThreadWorktreeInspection {
  owned: OwnedThreadWorktree
  state: ThreadWorktreeState
  decision: ThreadWorktreeFinishDecision
}

export interface ThreadWorktreeFinishResult {
  /** The folder was removed. */
  removed: boolean
  /** Why it is still there, when it is. */
  left?: 'missing' | 'chosen' | 'changes' | 'refused'
  /** Git's or the guard's own words when removal was refused. */
  detail?: string
}

/** Why creating a conversation's worktree was refused, so the dialog can say what to do about it. */
export type ThreadWorktreeErrorCode = 'NOT_A_REPO' | 'DIRTY_BASE' | 'BRANCH_EXISTS' | 'INVALID_BRANCH' | 'INVALID_BASE' | 'PATH_EXISTS' | 'CREATE_FAILED'

const ERROR_CODES: readonly string[] = ['NOT_A_REPO', 'DIRTY_BASE', 'BRANCH_EXISTS', 'INVALID_BRANCH', 'INVALID_BASE', 'PATH_EXISTS', 'CREATE_FAILED']
const TAG = /\[thread-worktree:([A-Z_]+)\]\s*/

/** The code travels inside the message because Electron keeps only the text of an error crossing IPC. */
export function tagThreadWorktreeError(code: ThreadWorktreeErrorCode, message: string): string {
  return `[thread-worktree:${code}] ${message}`
}

export function parseThreadWorktreeError(text: string): { code: ThreadWorktreeErrorCode; message: string } | null {
  const match = TAG.exec(text)
  if (!match || !ERROR_CODES.includes(match[1])) return null
  return { code: match[1] as ThreadWorktreeErrorCode, message: text.slice(match.index + match[0].length).trim() || text }
}

export interface ThreadWorktreeFailureAdvice {
  /** The field the person can correct, when the cause is something they typed. */
  fix: 'branch' | 'base' | null
  /** The worktree can still be made once the person accepts the caveat (uncommitted changes stay behind). */
  canContinue: boolean
}

/** Every refusal also offers working in the project folder, but only as a choice the person makes. */
export function threadWorktreeFailureAdvice(code: ThreadWorktreeErrorCode): ThreadWorktreeFailureAdvice {
  switch (code) {
    case 'BRANCH_EXISTS': case 'INVALID_BRANCH': case 'PATH_EXISTS': return { fix: 'branch', canContinue: false }
    case 'INVALID_BASE': return { fix: 'base', canContinue: false }
    case 'DIRTY_BASE': return { fix: null, canContinue: true }
    default: return { fix: null, canContinue: false }
  }
}

/** Per-project "work in a worktree" choice, stored as one JSON object keyed by project id. */
export function parseThreadWorktreePrefs(raw: string | null): Record<string, boolean> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch { return {} }
}

/** `true` is stored; `false` removes the entry, so the default (off) is also what an unknown project gets. */
export function withThreadWorktreePref(prefs: Record<string, boolean>, projectId: string, enabled: boolean): Record<string, boolean> {
  const { [projectId]: _previous, ...rest } = prefs
  return enabled ? { ...rest, [projectId]: true } : rest
}
