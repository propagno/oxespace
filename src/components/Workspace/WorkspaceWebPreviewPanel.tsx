import { ChevronsRight, Maximize2, Minimize2, MonitorPlay } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { WebPreviewPanel } from '../WebPreview/WebPreviewPanel'
import { i18n } from '../../i18n'
import { DockPanel, IconButton } from '../../ui'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceWebPreviewPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
  onRunCommand: (command: string) => void
}

export function WorkspaceWebPreviewPanel({ isExpanded, onCollapse, onRunCommand, onToggleExpanded, workspace }: WorkspaceWebPreviewPanelProps): ReactElement {
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')
  return (
    <DockPanel
      testId="workspace-web-preview-panel"
      className="workspace-editor-panel"
      icon={<MonitorPlay size={14} aria-hidden="true" />}
      title={tc('panels.browser')}
      actions={<IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <WebPreviewPanel workspace={workspace} embedded onRunCommand={onRunCommand} onClose={onCollapse} />
      </div>
    </DockPanel>
  )
}
