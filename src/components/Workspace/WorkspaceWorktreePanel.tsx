import { ChevronsRight, FolderTree, Maximize2, Minimize2 } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { WorktreePanelBody } from '../Worktree/WorktreePanelBody'

interface WorkspaceWorktreePanelProps {
  workspace: Workspace
  activePaneId: string | null
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

/**
 * Side-dock wrapper for the Worktree feature. Mirrors WorkspaceBackgroundPanel
 * 1:1 — same header chrome (title + expand + close) and content slot — so the
 * Worktree panel sits in the same visual rhythm as the other repo-scoped
 * dock panels (Background, Review, GitHub, Editor).
 *
 * The wrapper resolves the active pane (from workspace.panes) by id and hands
 * the resolved object to the body. Keeps the body free of store-coupling for
 * pane lookup so it stays testable in isolation.
 */
export function WorkspaceWorktreePanel({
  activePaneId,
  isExpanded,
  onCollapse,
  onToggleExpanded,
  workspace
}: WorkspaceWorktreePanelProps): ReactElement {
  const activePane = useMemo(() => {
    if (!activePaneId) return null
    return workspace.panes.find((pane) => pane.id === activePaneId) ?? null
  }, [workspace.panes, activePaneId])

  return (
    <section className="workspace-editor-panel workspace-worktree-panel" data-testid="workspace-worktree-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <FolderTree size={12} aria-hidden="true" />
          <span>Worktrees</span>
        </div>
        <div className="workspace-editor-actions" aria-label="Worktree panel actions">
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? 'Restore panel width' : 'Expand panel'}
            title={isExpanded ? 'Restore panel width' : 'Expand panel'}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label="Collapse panel" title="Collapse panel" onClick={onCollapse}>
            <ChevronsRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <WorktreePanelBody
          activePane={activePane}
          workspaceId={workspace.id}
          workspaceRootPath={workspace.rootPath}
        />
      </div>
    </section>
  )
}
