import type { GitBranchStatus } from '../../shared/types/git'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'

export function gitBranchLabel(status: GitBranchStatus | null): string {
  if (!status) return 'Checking branch…'
  if (status.detached && status.shortSha) return `detached ${status.shortSha}`
  return status.branch ?? 'Branch unavailable'
}

/** Persisted launch scope, not an inference from agent output or a folder name. */
export function paneGitContext(workspace: Workspace, pane: WorkspacePane) {
  const rootPath = pane.rootPath ?? workspace.rootPath
  const key = (path: string) => /^[a-z]:[\\/]|^\\\\/i.test(path)
    ? path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : path.replace(/\/$/, '')
  const sharedCount = workspace.panes.filter(p => p.type === 'terminal' && key(p.rootPath ?? workspace.rootPath) === key(rootPath)).length
  return { rootPath, sharedCount }
}
