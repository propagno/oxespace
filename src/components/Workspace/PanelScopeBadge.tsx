import { FolderTree, Pin, PinOff } from 'lucide-react'
import type { ReactElement } from 'react'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useUIStore } from '../../store/ui.store'
import type { WorkspaceScope } from '../../utils/workspaceScope'

interface PanelScopeBadgeProps {
  workspaceId: string
  scope: WorkspaceScope
}

/**
 * Names the directory a side panel is reading.
 *
 * The panels follow the active pane, which means the same panel shows the main
 * checkout one moment and a hotfix worktree the next. That is only safe if the
 * panel says which — a diff that silently swaps repositories is how someone
 * commits to the wrong branch. So this badge is not decoration: it is the
 * disclosure that makes following the pane acceptable at all, and it renders
 * on every scope, worktree or not.
 *
 * Clicking it pins the panels to the workspace root and back, for the case
 * where someone wants to read main while a worktree pane has focus.
 */
export function PanelScopeBadge({ scope, workspaceId }: PanelScopeBadgeProps): ReactElement {
  const pinned = useUIStore((s) => s.panelScopePinnedByWorkspace[workspaceId] === true)
  const togglePin = useUIStore((s) => s.togglePanelScopePin)
  const branch = useGitBranch(workspaceId, scope.rootPath)?.branch ?? null

  const label = branch ?? scope.folderName
  const title = pinned
    ? `Panels pinned to the workspace root (${scope.rootPath}). Click to follow the active pane again.`
    : scope.isWorktree
      ? `Panels are reading the worktree at ${scope.rootPath}. Click to pin them to the workspace root.`
      : `Panels are reading ${scope.rootPath}. Click to pin them here even when a worktree pane is active.`

  return (
    <button
      type="button"
      className={`panel-scope-badge${scope.isWorktree ? ' is-worktree' : ''}${pinned ? ' is-pinned' : ''}`}
      onClick={() => togglePin(workspaceId)}
      title={title}
      aria-label={title}
      data-testid="panel-scope-badge"
    >
      {scope.isWorktree ? <FolderTree size={10} aria-hidden="true" /> : null}
      <span className="panel-scope-badge-label">{label}</span>
      {pinned ? <Pin size={10} aria-hidden="true" /> : <PinOff size={10} aria-hidden="true" className="panel-scope-badge-pin-hint" />}
    </button>
  )
}
