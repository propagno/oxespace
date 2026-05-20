import { ChevronsLeft, ChevronsRight, Plus, Search } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
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
  isCollapsed: boolean
  onToggleCollapse: () => void
}


export function Sidebar({
  activeWorkspaceId,
  activePaneId,
  agentProfiles,
  appVersion,
  isCollapsed,
  onActivatePane,
  onCloseWorkspace,
  onNewWorkspace,
  onSelectWorkspace,
  onToggleCollapse,
  workspaces,
}: SidebarProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all')
  // Subscribe to terminal store so the filter recomputes when hasUnread toggles.
  // Idle-marker detection (TerminalView) flips hasUnread; markRead clears it.
  const terminalPanes = useTerminalStore((state) => state.panes)

  const hasUnread = (paneId: string): boolean => terminalPanes[paneId]?.hasUnread === true
  const unreadCount = workspaces.reduce(
    (n, ws) => n + ws.panes.filter(p => hasUnread(p.id)).length,
    0,
  )

  const handleActivatePane = (paneId: string): void => {
    const wasUnread = hasUnread(paneId)
    onActivatePane(paneId)
    if (wasUnread && activeTab === 'unread') setActiveTab('all')
  }

  if (isCollapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <div className="sidebar-brand sidebar-brand-collapsed">
          <OxeLogo />
          {unreadCount > 0 ? (
            <span className="sidebar-rail-unread" aria-label={`${unreadCount} unread pane${unreadCount === 1 ? '' : 's'}`}>
              {unreadCount}
            </span>
          ) : null}
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

  const filtered = workspaces.filter(ws => {
    const matchesSearch =
      !searchQuery ||
      ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ws.panes.some(p =>
        (p.agentName ?? p.type).toLowerCase().includes(searchQuery.toLowerCase()),
      )
    const matchesTab =
      activeTab === 'all' || ws.panes.some(p => hasUnread(p.id))
    return matchesSearch && matchesTab
  })

  return (
    <aside className="sidebar">
      <div className="sidebar-header-bar">
        <OxeLogo size={22} variant="wordmark" />
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
          aria-selected={activeTab === 'unread'}
          onClick={() => setActiveTab('unread')}
        >
          Unread
          {unreadCount > 0 && <span className="tab-badge">{unreadCount}</span>}
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
              onActivatePane={handleActivatePane}
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
