import { GitBranch } from 'lucide-react'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { gitBranchLabel, paneGitContext } from '../../utils/paneGitContext'

export function PaneBranchBadge({ workspace, pane }: { workspace: Workspace; pane: WorkspacePane }) {
  const { rootPath, sharedCount } = paneGitContext(workspace, pane)
  const status = useGitBranch(workspace.id, rootPath)
  const label = gitBranchLabel(status)
  // A folder that is simply not a git repository has no branch to report; saying so on every pane is noise.
  if (status && !status.branch && !status.detached && !status.error) return null
  const warning = sharedCount > 1 ? `\n${sharedCount} terminals share this directory; branch changes affect all of them.` : ''
  return <span className="pane-branch-badge" data-testid="pane-branch-badge"
    title={`${label}\nConfigured terminal directory: ${rootPath}${warning}${status?.error ? `\n${status.error}` : ''}`}>
    <GitBranch size={12} aria-hidden="true" />
    <span>{label}</span>
    {sharedCount > 1 && <span aria-label={`${sharedCount} terminals share this directory`}>· {sharedCount}</span>}
  </span>
}
