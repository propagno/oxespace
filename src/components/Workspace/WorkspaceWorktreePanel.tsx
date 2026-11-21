import { ChevronsRight, FolderTree, Maximize2, Minimize2 } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { WorktreePanelBody } from '../Worktree/WorktreePanelBody'
import { i18n } from '../../i18n'
import { DockPanel, IconButton } from '../../ui'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceWorktreePanelProps {
  workspace: Workspace
  activePaneId: string | null
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

/**
 * Side-dock wrapper for the Worktree feature, on the src/ui DockPanel like the other OxeCode panels (BRD-15).
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
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')

  return (
    <DockPanel
      testId="workspace-worktree-panel"
      className="workspace-editor-panel workspace-worktree-panel"
      icon={<FolderTree size={14} aria-hidden="true" />}
      title={tc('panels.worktrees')}
      actions={<IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <WorktreePanelBody
          activePane={activePane}
          workspaceId={workspace.id}
          workspaceRootPath={workspace.rootPath}
        />
      </div>
    </DockPanel>
  )
}
