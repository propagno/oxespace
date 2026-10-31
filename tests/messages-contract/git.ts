import type { GitMessageParams } from '../../shared/messages/git'

/** The parameter names each git code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const GIT_PARAMETERS: Record<keyof GitMessageParams, string[]> = {
  'linear.worktree.exists': ['issue', 'path'],
  'worktree.cleanup.notRemovable': [],
  'worktree.cleanup.blocked': ['reasons'],
  'worktree.cleanup.needsConfirmation': ['reasons'],
  'github.cli.missing': [],
  'git.base.unresolved': ['base']
}
