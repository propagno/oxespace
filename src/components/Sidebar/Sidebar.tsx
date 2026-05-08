import { ChevronDown, ChevronsLeft, ChevronsRight, Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { AgentSection } from './AgentSection'
import { WorkspaceItem } from './WorkspaceItem'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onNewWorkspace: () => void
  onSelectWorkspace: (id: string) => void
  onCloseWorkspace: (id: string) => void
  agentProfiles: AgentProfile[]
  agentReadiness: AgentReadiness[]
  isDiscoveringAgents: boolean
  onDiscoverAgents: () => void
  onConfigureAgent: (profile: AgentProfile) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

function OxeLogo(): ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="oxe-bg" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1e1b4b"/>
          <stop offset="100%" stopColor="#4f46e5"/>
        </linearGradient>
        <radialGradient id="oxe-glow" cx="7" cy="7" r="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect width="28" height="28" rx="7" fill="url(#oxe-bg)"/>
      <rect width="28" height="28" rx="7" fill="url(#oxe-glow)"/>
      <rect x="5" y="5" width="8" height="8" rx="1.5" fill="white" opacity="0.95"/>
      <rect x="15" y="5" width="8" height="8" rx="1.5" fill="white" opacity="0.55"/>
      <rect x="5" y="15" width="8" height="8" rx="1.5" fill="white" opacity="0.35"/>
      <rect x="15" y="15" width="8" height="8" rx="1.5" fill="white" opacity="0.15"/>
      <rect x="6.5" y="11" width="4" height="1.5" rx="0.75" fill="#312e81" opacity="0.8"/>
    </svg>
  )
}

export function Sidebar({
  activeWorkspaceId,
  agentProfiles = [],
  agentReadiness = [],
  isCollapsed,
  isDiscoveringAgents = false,
  onCloseWorkspace,
  onConfigureAgent = () => undefined,
  onDiscoverAgents = () => undefined,
  onNewWorkspace,
  onSelectWorkspace,
  onToggleCollapse,
  workspaces
}: SidebarProps): ReactElement {
  return (
    <aside className={`sidebar${isCollapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <OxeLogo />
        {!isCollapsed && (
          <span className="sidebar-wordmark">
            <span className="wordmark-oxe">OXE</span>
            <span className="wordmark-space">space</span>
          </span>
        )}
      </div>

      {!isCollapsed && (
        <>
          <div className="sidebar-header">
            <span className="sidebar-section-label">WORKSPACES</span>
            <div className="sidebar-header-actions">
              <button
                type="button"
                className="sidebar-btn"
                aria-label="New workspace"
                title="New workspace"
                data-testid="btn-new-workspace"
                onClick={onNewWorkspace}
              >
                <Plus size={11} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="sidebar-btn"
                aria-label="More options"
                title="More options"
              >
                <ChevronDown size={11} aria-hidden="true" />
              </button>
            </div>
          </div>

          <nav className="workspace-list" aria-label="Workspaces">
            {workspaces.length === 0 ? (
              <p className="workspace-list-empty">No workspaces yet.</p>
            ) : (
              workspaces.map((workspace) => (
                <WorkspaceItem
                  key={workspace.id}
                  workspace={workspace}
                  isActive={workspace.id === activeWorkspaceId}
                  onSelect={onSelectWorkspace}
                  onClose={onCloseWorkspace}
                />
              ))
            )}
          </nav>

          <div className="sidebar-divider" />

          <AgentSection
            profiles={agentProfiles}
            readiness={agentReadiness}
            isDiscovering={isDiscoveringAgents}
            onDiscover={onDiscoverAgents}
            onConfigure={onConfigureAgent}
          />
        </>
      )}

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-collapse-btn"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapse}
        >
          {isCollapsed
            ? <ChevronsRight size={14} aria-hidden="true" />
            : <ChevronsLeft size={14} aria-hidden="true" />
          }
        </button>
      </div>
    </aside>
  )
}
