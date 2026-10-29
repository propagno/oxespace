import { FolderGit2, GitBranch } from 'lucide-react'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useTerminalStore } from '../../store/terminal.store'
import { gitBranchLabel, paneGitContext } from '../../utils/paneGitContext'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

export function PaneBranchBadge({ workspace, pane }: { workspace: Workspace; pane: WorkspacePane }) {
  const location = useTerminalStore(state => state.panes[pane.id]?.location ?? null)
  const { rootPath, launchRoot, moved, outside, sharedCount } = paneGitContext(workspace, pane, location)
  const status = useGitBranch(workspace.id, rootPath)
  const label = gitBranchLabel(status)
  // A folder that is simply not a git repository has no branch to report; saying so on every pane is noise.
  if (status && !status.branch && !status.detached && !status.error) return null
  const warning = !moved && sharedCount > 1 ? `\n${tc('workspace.branch.shared', { count: sharedCount })}` : ''
  const where = moved
    ? `\n${tc('workspace.branch.movedTo', { path: rootPath })}\n${tc('workspace.branch.openedIn', { path: launchRoot })}`
    : `\n${tc('workspace.branch.directory', { path: rootPath })}${outside ? `\n${tc('workspace.branch.outside', { path: outside })}` : ''}`
  return <span className={`pane-branch-badge${moved ? ' is-moved' : ''}`} data-testid="pane-branch-badge" data-moved={moved ? 'true' : undefined}
    title={`${label}${where}${warning}${status?.error ? `\n${status.error}` : ''}`}>
    {moved ? <FolderGit2 size={12} aria-hidden="true" /> : <GitBranch size={12} aria-hidden="true" />}
    <span>{label}</span>
    {moved && <span>· {tc('changes.ref.worktree')}</span>}
    {!moved && sharedCount > 1 && <span aria-label={tc('workspace.branch.shared', { count: sharedCount })}>· {sharedCount}</span>}
  </span>
}
