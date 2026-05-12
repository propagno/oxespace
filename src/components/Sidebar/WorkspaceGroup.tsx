import { ChevronRight, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
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

  function handleHeaderClick() {
    setExpanded(prev => !prev)
    onSelect(workspace.id)
  }

  return (
    <div
      className={`ws-group${isActive ? ' active' : ''}`}
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
        <ChevronRight
          size={11}
          className={`ws-group-chevron${expanded ? ' open' : ''}`}
          aria-hidden="true"
        />
        <span className="ws-group-name">{workspace.name}</span>
        {workspace.panes.length > 0 && (
          <span className="ws-group-count">{workspace.panes.length}</span>
        )}
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
            isActive={pane.id === activePaneId}
            agentProfiles={agentProfiles}
            onClick={() => onSelect(workspace.id)}
            onActivatePane={onActivatePane}
          />
        ))}
    </div>
  )
}
