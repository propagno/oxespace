import { ChevronsRight, Files, GitBranch, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { EditorPane } from '../Editor/EditorPane'
import { useWorkspaceStore } from '../../store/workspace.store'
import { PanelScopeBadge } from './PanelScopeBadge'
import type { WorkspaceScope } from '../../utils/workspaceScope'
import { i18n } from '../../i18n'
import { DockPanel, IconButton } from '../../ui'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceEditorPanelProps {
  workspace: Workspace
  /** Directory to read — the active pane's worktree, or the workspace root. */
  scope: WorkspaceScope
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceEditorPanel({ isExpanded, onCollapse, onToggleExpanded, scope, workspace }: WorkspaceEditorPanelProps): ReactElement {
  const openSourceControl = (): void => {
    void useWorkspaceStore.getState().showRepositoryView(workspace.id, 'git')
  }
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')

  return (
    <DockPanel
      testId="workspace-editor-panel"
      className="workspace-editor-panel"
      icon={<Files size={14} aria-hidden="true" />}
      title={tc('panels.files')}
      count={<PanelScopeBadge workspaceId={workspace.id} scope={scope} />}
      actions={<>
        <span className="repository-view-actions" role="group" aria-label={tc('workspace.panel.repositoryViews')}>
          <IconButton label={tc('workspace.panel.files')} title={tc('workspace.panel.files')} aria-pressed icon={<Files size={14} aria-hidden="true" />} />
          <IconButton label={tc('panels.git')} title={tc('panels.git')} icon={<GitBranch size={14} aria-hidden="true" />} onClick={openSourceControl} />
        </span>
        <IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />
      </>}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <EditorPane workspaceId={workspace.id} rootPath={scope.rootPath} />
      </div>
    </DockPanel>
  )
}
