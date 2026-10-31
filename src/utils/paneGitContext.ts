import type { SessionLocation } from '../../shared/types/agent-hooks'
import type { GitBranchStatus } from '../../shared/types/git'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { i18n } from '../i18n'

export function gitBranchLabel(status: GitBranchStatus | null): string {
  if (!status) return i18n.t('paneMenu.checkingBranch', { ns: 'code' })
  if (status.detached && status.shortSha) return `${i18n.t('changes.detached', { ns: 'code' })} ${status.shortSha}`
  return status.branch ?? i18n.t('paneMenu.noBranch', { ns: 'code' })
}

const key = (path: string): string => /^[a-z]:[\\/]|^\\\\/i.test(path)
  ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : path.replace(/\/$/, '')

export function samePaneRoot(a: string, b: string): boolean { return key(a) === key(b) }

/**
 * The directory whose branch a pane shows. That is the persisted launch scope, unless the pane's agent
 * reported (through its hooks) working in another checkout of the same repository, such as a worktree
 * it created: then that checkout. Never inferred from agent output or a folder name.
 */
export function paneGitContext(workspace: Workspace, pane: WorkspacePane, location?: SessionLocation | null) {
  const launchRoot = pane.rootPath ?? workspace.rootPath
  const moved = location?.sameRepository && location.checkoutRoot && !samePaneRoot(location.checkoutRoot, launchRoot)
  const rootPath = moved ? location.checkoutRoot! : launchRoot
  // Reported working outside the repository: the badge keeps the launch branch and says where the agent is.
  const outside = location && !location.sameRepository ? location.cwd : null
  const sharedCount = workspace.panes.filter(p => p.type === 'terminal' && key(p.rootPath ?? workspace.rootPath) === key(launchRoot)).length
  return { rootPath, launchRoot, moved: Boolean(moved), outside, sharedCount }
}
