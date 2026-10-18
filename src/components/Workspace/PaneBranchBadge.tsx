import { FolderGit2, GitBranch } from 'lucide-react'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useTerminalStore } from '../../store/terminal.store'
import { gitBranchLabel, paneGitContext } from '../../utils/paneGitContext'

export function PaneBranchBadge({ workspace, pane }: { workspace: Workspace; pane: WorkspacePane }) {
  const location = useTerminalStore(state => state.panes[pane.id]?.location ?? null)
  const { rootPath, launchRoot, moved, outside, sharedCount } = paneGitContext(workspace, pane, location)
  const status = useGitBranch(workspace.id, rootPath)
  const label = gitBranchLabel(status)
  // A folder that is simply not a git repository has no branch to report; saying so on every pane is noise.
  if (status && !status.branch && !status.detached && !status.error) return null
  const warning = !moved && sharedCount > 1 ? `\n${sharedCount} terminals share this directory; branch changes affect all of them.` : ''
  const where = moved
    ? `\nThe agent is working in ${rootPath}\nTerminal opened in ${launchRoot}`
    : `\nConfigured terminal directory: ${rootPath}${outside ? `\nThe agent reports working outside this repository: ${outside}` : ''}`
  return <span className={`pane-branch-badge${moved ? ' is-moved' : ''}`} data-testid="pane-branch-badge" data-moved={moved ? 'true' : undefined}
    title={`${label}${where}${warning}${status?.error ? `\n${status.error}` : ''}`}>
    {moved ? <FolderGit2 size={12} aria-hidden="true" /> : <GitBranch size={12} aria-hidden="true" />}
    <span>{label}</span>
    {moved && <span>· worktree</span>}
    {!moved && sharedCount > 1 && <span aria-label={`${sharedCount} terminals share this directory`}>· {sharedCount}</span>}
  </span>
}
