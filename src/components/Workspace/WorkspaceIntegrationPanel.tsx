import { Maximize2, Network, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { IntegrationPanel } from '../Integration/IntegrationPanel'
import { Button } from '../../ui'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceIntegrationPanelProps {
  activePaneId: string | null
  isExpanded: boolean
  onCollapse: () => void
  onRunCommand: (command: string) => void
  onSelectWorkspace: (workspaceId: string) => void
  onToggleExpanded: () => void
  workspace: Workspace
  workspaces: Workspace[]
}

export function WorkspaceIntegrationPanel({ activePaneId, isExpanded, onCollapse, onRunCommand, onSelectWorkspace, onToggleExpanded, workspace, workspaces }: WorkspaceIntegrationPanelProps): ReactElement {
  return (
    <aside
      className={`workspace-editor-panel workspace-integration-panel${isExpanded ? ' expanded' : ''}`}
      data-testid="workspace-integration-panel"
    >
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Network size={14} aria-hidden="true" />
          <strong>{tc('tools.integration.label')}</strong>
        </div>
        <div className="workspace-editor-actions">
          <Button variant="ghost" size="sm" square aria-label={tc('workspace.panel.expand')} title={tc('workspace.panel.expand')} onClick={onToggleExpanded}>
            <Maximize2 size={14} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" square aria-label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} onClick={onCollapse}>
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <IntegrationPanel
        activePaneId={activePaneId}
        workspace={workspace}
        workspaces={workspaces}
        onRunInTerminal={onRunCommand}
        onSelectWorkspace={onSelectWorkspace}
      />
    </aside>
  )
}
