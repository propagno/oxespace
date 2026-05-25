import { ChevronDown, Network, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { selectIntegrationsForWorkspace, useIntegrationStore } from '../../store/integration.store'
import { useUIStore } from '../../store/ui.store'
import { PaneSessionRow } from './PaneSessionRow'

interface WorkspaceGroupProps {
  workspace: Workspace
  isActive: boolean
  activePaneId: string | null
  agentProfiles: AgentProfile[]
  defaultExpanded: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onActivatePane: (paneId: string) => void
}

export function WorkspaceGroup({
  workspace,
  isActive,
  activePaneId,
  agentProfiles,
  defaultExpanded,
  onSelect,
  onClose,
  onActivatePane,
}: WorkspaceGroupProps): ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const rootLabel = compactRootLabel(workspace.rootPath)
  // Workspace is part of zero, one, or many integrations. The badge below is
  // only rendered when there's at least one — the selector returns a stable
  // array reference for the same input set, so this doesn't trigger extra
  // re-renders when an unrelated workspace's integration changes.
  const integrations = useIntegrationStore(selectIntegrationsForWorkspace(workspace.id))
  const openIntegrationPanel = useUIStore((s) => s.openIntegrationPanel)
  const setActiveIntegrationGroup = useIntegrationStore((s) => s.setActiveGroup)

  function handleHeaderClick() {
    setExpanded(prev => !prev)
    onSelect(workspace.id)
  }

  function handleIntegrationBadgeClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (integrations.length === 0) return
    // Pre-select the first integration this workspace participates in so the
    // panel opens already focused on a relevant group, not the global default.
    setActiveIntegrationGroup(integrations[0].id)
    onSelect(workspace.id)
    openIntegrationPanel()
  }

  return (
    <div
      className={`ws-group${isActive ? ' active' : ''}${expanded ? ' open' : ''}`}
      data-testid="sidebar-workspace-item"
    >
      <div
        className="ws-group-header"
        role="button"
        tabIndex={0}
        onClick={handleHeaderClick}
        onKeyDown={e => e.key === 'Enter' && handleHeaderClick()}
        data-testid="sidebar-workspace-select"
      >
        <div className="ws-group-title-block">
          <span className="ws-group-name">{workspace.name}</span>
          <span className="ws-group-root" title={workspace.rootPath}>~/{rootLabel}</span>
        </div>
        {integrations.length > 0 ? (
          <button
            type="button"
            className="ws-group-integration-badge"
            title={`Part of: ${integrations.map((g) => g.name).join(' · ')}`}
            aria-label={`Workspace is part of ${integrations.length} integration${integrations.length === 1 ? '' : 's'}`}
            onClick={handleIntegrationBadgeClick}
            data-testid="ws-group-integration-badge"
          >
            <Network size={11} aria-hidden="true" />
            {integrations.length > 1 ? <span className="ws-group-integration-count">{integrations.length}</span> : null}
          </button>
        ) : null}
        <span className="ws-group-count">{workspace.panes.length} pane{workspace.panes.length === 1 ? '' : 's'}</span>
        <ChevronDown
          size={12}
          className={`ws-group-chevron${expanded ? ' open' : ''}`}
          aria-hidden="true"
        />
        <button
          type="button"
          className="ws-group-close"
          aria-label={`Close ${workspace.name}`}
          title="Close workspace"
          onClick={e => {
            e.stopPropagation()
            onClose(workspace.id)
          }}
        >
          <X size={10} aria-hidden="true" />
        </button>
      </div>
      {expanded &&
        workspace.panes.map((pane, index) => (
          <PaneSessionRow
            key={pane.id}
            pane={pane}
            paneIndex={index}
            workspace={workspace}
            isActive={pane.id === activePaneId}
            agentProfiles={agentProfiles}
            onClick={() => onSelect(workspace.id)}
            onActivatePane={onActivatePane}
          />
        ))}
    </div>
  )
}

function compactRootLabel(rootPath: string): string {
  const parts = rootPath.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? 'workspace'
}
