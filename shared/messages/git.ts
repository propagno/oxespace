/** C3 message codes of the git domain (`linear.*`, `worktree.*`, `github.*`, `git.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface GitMessageParams {
  'linear.worktree.exists': { issue: string; path: string }
  'worktree.cleanup.notRemovable': Record<string, never>
  'worktree.cleanup.blocked': { reasons: string[] }
  'worktree.cleanup.needsConfirmation': { reasons: string[] }
  'github.cli.missing': Record<string, never>
  'git.base.unresolved': { base: string }
}

export const GIT_MESSAGE_CODES = [
  'linear.worktree.exists',
  'worktree.cleanup.notRemovable',
  'worktree.cleanup.blocked',
  'worktree.cleanup.needsConfirmation',
  'github.cli.missing',
  'git.base.unresolved'
] as const satisfies readonly (keyof GitMessageParams)[]
