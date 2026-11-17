import { ChevronsRight, Maximize2, Minimize2, Network } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { HttpCallsPanel } from '../HttpCalls/HttpCallsPanel'
import { i18n } from '../../i18n'
import { DockPanel, IconButton } from '../../ui'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceHttpCallsPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceHttpCallsPanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceHttpCallsPanelProps): ReactElement {
  const expandLabel = isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')
  return (
    <DockPanel
      testId="workspace-http-calls-panel"
      className="workspace-editor-panel"
      icon={<Network size={14} aria-hidden="true" />}
      title={tc('panels.httpCalls')}
      actions={<IconButton label={expandLabel} title={expandLabel} icon={isExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />} onClick={onToggleExpanded} />}
      close={<IconButton label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} icon={<ChevronsRight size={14} aria-hidden="true" />} onClick={onCollapse} />}
    >
      <div className="workspace-editor-content">
        <HttpCallsPanel workspaceId={workspace.id} />
      </div>
    </DockPanel>
  )
}
