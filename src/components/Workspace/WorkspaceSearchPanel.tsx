import { ChevronsRight, Maximize2, Minimize2, Search } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import type { WorkspaceScope } from '../../utils/workspaceScope'
import { PanelScopeBadge } from './PanelScopeBadge'
import { SearchPanel } from '../Search/SearchPanel'
import { i18n } from '../../i18n'
import { DockPanel, IconButton } from '../../ui'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceSearchPanelProps {
  workspace: Workspace
  /** What the panels read (OXE-191): the active pane's worktree, like Files, Git and the others; else the root. */
  scope: WorkspaceScope
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceSearchPanel({ isExpanded, onCollapse, onToggleExpanded, scope, workspace }: WorkspaceSearchPanelProps): ReactElement {
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')
  return (
    <DockPanel
      testId="workspace-search-panel"
      className="workspace-editor-panel"
      icon={<Search size={14} aria-hidden="true" />}
      title={tc('panels.search')}
      count={scope ? <PanelScopeBadge workspaceId={workspace.id} scope={scope} /> : null}
      actions={<IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <SearchPanel workspace={workspace} rootPath={scope?.rootPath ?? workspace.rootPath} />
      </div>
    </DockPanel>
  )
}
