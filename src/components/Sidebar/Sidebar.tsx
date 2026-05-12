import { ChevronsLeft, ChevronsRight, Plus, Search, Settings } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { OxeLogo } from '../Brand/OxeLogo'
import { WorkspaceGroup } from './WorkspaceGroup'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activePaneId: string | null
  agentProfiles: AgentProfile[]
  appVersion: string
  onNewWorkspace: () => void
  onSelectWorkspace: (id: string) => void
  onCloseWorkspace: (id: string) => void
  onActivatePane: (paneId: string) => void
  isSettingsOpen: boolean
  onToggleSettings: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}


export function Sidebar({
  activeWorkspaceId,
  activePaneId,
  agentProfiles,
  appVersion,
  isCollapsed,
  isSettingsOpen,
  onActivatePane,
  onCloseWorkspace,
  onNewWorkspace,
  onSelectWorkspace,
  onToggleCollapse,
  onToggleSettings,
  workspaces,
}: SidebarProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'active'>('all')

  if (isCollapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <div className="sidebar-brand">
          <OxeLogo />
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-collapse-btn"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={onToggleCollapse}
          >
            <ChevronsRight size={14} aria-hidden="true" />
          </button>
        </div>
      </aside>
    )
  }

  const activeCount = workspaces.reduce(
    (n, ws) => n + ws.panes.filter(p => p.status === 'running').length,
    0,
  )

  const filtered = workspaces.filter(ws => {
    const matchesSearch =
      !searchQuery ||
      ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.panes.some(p =>
        (p.agentName ?? p.type).toLowerCase().includes(searchQuery.toLowerCase()),
      )
    const matchesTab =
      activeTab === 'all' || ws.panes.some(p => p.status === 'running')
    return matchesSearch && matchesTab
  })

  return (
    <aside className="sidebar">
      <div className="sidebar-header-bar">
        <OxeLogo size={20} variant="full" />
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-icon-btn"
            aria-label="New workspace"
            title="New workspace"
            data-testid="btn-new-workspace"
            onClick={onNewWorkspace}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`sidebar-icon-btn${isSettingsOpen ? ' active' : ''}`}
            aria-label="AI Providers"
            title="AI Providers"
            aria-pressed={isSettingsOpen}
            onClick={onToggleSettings}
          >
            <Settings size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="sidebar-search-wrap">
        <Search size={11} className="sidebar-search-icon" aria-hidden="true" />
        <input
          type="text"
          className="sidebar-search-input"
          placeholder="Search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="Search workspaces"
        />
      </div>

      <div className="sidebar-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'active'}
          onClick={() => setActiveTab('active')}
        >
          Active
          {activeCount > 0 && <span className="tab-badge">{activeCount}</span>}
        </button>
      </div>

      <nav className="ws-group-list" aria-label="Workspaces">
        {filtered.length === 0 ? (
          <p className="sidebar-empty">No workspaces.</p>
        ) : (
          filtered.map(ws => (
            <WorkspaceGroup
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeWorkspaceId}
              activePaneId={activePaneId}
              agentProfiles={agentProfiles}
              defaultExpanded={ws.id === activeWorkspaceId}
              onSelect={onSelectWorkspace}
              onClose={onCloseWorkspace}
              onActivatePane={onActivatePane}
            />
          ))
        )}
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-version">v{appVersion}</span>
        <button
          type="button"
          className="sidebar-collapse-btn"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={onToggleCollapse}
        >
          <ChevronsLeft size={14} aria-hidden="true" />
        </button>
      </div>
    </aside>
  )
}
