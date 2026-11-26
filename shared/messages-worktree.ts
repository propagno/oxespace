/**
 * OXE-444 · C3 codes for declarative worktree templates (sharedDirectories check-ignore and sensitive-pattern opt-in),
 * split out of shared/messages.ts to keep it under its 1000-line limit.
 */

export interface WorktreeTemplateMessageParams {
  /** OXE-444: sensitive files blocked until the person explicitly opts in for this repository. */
  'worktree.copyFiles.sensitiveOptInRequired': { paths: string[] }
  /** OXE-444: shared directories linked into the new worktree. */
  'worktree.sharedDirs.linked': { count: number }
  /** OXE-444: shared directories refused because Git tracks them (not gitignored). */
  'worktree.sharedDirs.trackedInGit': { paths: string[] }
  /** OXE-444: git check-ignore failed while validating sharedDirectories; nothing was linked. */
  'worktree.sharedDirs.ignoreCheckFailed': Record<string, never>
}

export const WORKTREE_TEMPLATE_MESSAGE_CODES = [
  'worktree.copyFiles.sensitiveOptInRequired',
  'worktree.sharedDirs.linked',
  'worktree.sharedDirs.trackedInGit',
  'worktree.sharedDirs.ignoreCheckFailed'
] as const satisfies readonly (keyof WorktreeTemplateMessageParams)[]
