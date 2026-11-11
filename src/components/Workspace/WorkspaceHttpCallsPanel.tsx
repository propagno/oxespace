import { ChevronsRight, Maximize2, Minimize2, Network } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { HttpCallsPanel } from '../HttpCalls/HttpCallsPanel'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface WorkspaceHttpCallsPanelProps {
  workspace: Workspace
  isExpanded: boolean
  onCollapse: () => void
  onToggleExpanded: () => void
}

export function WorkspaceHttpCallsPanel({ isExpanded, onCollapse, onToggleExpanded, workspace }: WorkspaceHttpCallsPanelProps): ReactElement {
  return (
    <section className="workspace-editor-panel workspace-background-panel" data-testid="workspace-http-calls-panel">
      <header className="workspace-editor-header">
        <div className="workspace-editor-title">
          <Network size={12} aria-hidden="true" />
          <span>{tc('panels.httpCalls')}</span>
        </div>
        <div className="workspace-editor-actions" aria-label={tc('workspace.panel.actions')}>
          <button
            type="button"
            className="tile-btn"
            aria-label={isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')}
            title={isExpanded ? tc('workspace.panel.restore') : tc('workspace.panel.expand')}
            onClick={onToggleExpanded}
          >
            {isExpanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <button type="button" className="tile-btn" aria-label={tc('workspace.panel.collapse')} title={tc('workspace.panel.collapse')} onClick={onCollapse}>
            <ChevronsRight size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="workspace-editor-content">
        <HttpCallsPanel workspaceId={workspace.id} />
      </div>
    </section>
  )
}
