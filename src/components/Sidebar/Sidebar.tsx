import { ChevronsLeft, ChevronsRight, Plus, Search } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import type { IntegrationGroup } from '../../../shared/types/integration'
import type { Workspace } from '../../../shared/types/workspace'
import { useIntegrationStore } from '../../store/integration.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { OxeLogo } from '../Brand/OxeLogo'
import { SidebarIntegrationRow } from './SidebarIntegrationRow'
import { WorkspaceGroup } from './WorkspaceGroup'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  appVersion: string
  onNewWorkspace: () => void
  onSelectWorkspace: (id: string) => void
  onCloseWorkspace: (id: string) => void
  onActivatePane: (paneId: string) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  integrationGroups?: IntegrationGroup[]
}


export function Sidebar({
  activeWorkspaceId,
  appVersion,
  isCollapsed,
  onActivatePane,
  onCloseWorkspace,
  onNewWorkspace,
  onSelectWorkspace,
  onToggleCollapse,
  integrationGroups = [],
  workspaces,
}: SidebarProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all')
  // Drag-and-drop workspace reorder state. We don't use HTML5 dragstart
  // payload because Electron's renderer has quirks with cross-process
  // data transfer — instead we track the source/target ids in component
  // state and only consult dataTransfer for the dragImage / effectAllowed.
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null)
  // Subscribe to terminal store so the filter recomputes when hasUnread toggles.
  // Idle-marker detection (TerminalView) flips hasUnread; markRead clears it.
  const terminalPanes = useTerminalStore((state) => state.panes)
  const activeIntegrationGroupId = useIntegrationStore((state) => state.activeGroupId)
  const activeIntegrationMemberId = useIntegrationStore((state) => state.activeMemberId)
  const setActiveIntegrationGroup = useIntegrationStore((state) => state.setActiveGroup)
  const setActiveIntegrationMember = useIntegrationStore((state) => state.setActiveMember)
  const reorderWorkspaces = useWorkspaceStore((state) => state.reorderWorkspaces)

  const hasUnread = (paneId: string): boolean => terminalPanes[paneId]?.hasUnread === true
  const unreadCount = workspaces.reduce(
    (n, ws) => n + ws.panes.filter(p => hasUnread(p.id)).length,
    0,
  )

  const handleDropOnWorkspace = (targetId: string): void => {
    if (!dragSourceId || dragSourceId === targetId || !dropPosition) {
      setDragSourceId(null)
      setDragOverId(null)
      setDropPosition(null)
      return
    }
    // Build the new order by removing the source and re-inserting it at
    // the position computed from the cursor's Y relative to the target.
    const currentOrder = workspaces.map((w) => w.id)
    const without = currentOrder.filter((id) => id !== dragSourceId)
    const targetIndex = without.indexOf(targetId)
    const insertAt = dropPosition === 'before' ? targetIndex : targetIndex + 1
    const next = [...without.slice(0, insertAt), dragSourceId, ...without.slice(insertAt)]
    setDragSourceId(null)
    setDragOverId(null)
    setDropPosition(null)
    void reorderWorkspaces(next)
  }

  const handleActivatePane = (paneId: string): void => {
    const wasUnread = hasUnread(paneId)
    onActivatePane(paneId)
    useTerminalStore.getState().markRead(paneId)
    if (wasUnread && activeTab === 'unread') setActiveTab('all')
  }

  // Clicking a workspace card in the sidebar activates it. Previously the
  // user reached individual panes through expanded pane-rows; now that the
  // rows are gone we forward "go to first unread pane" semantics here so
  // the unread tab still has a clear action. When no unread pane exists,
  // we simply activate the workspace without touching pane selection.
  const handleSelectWorkspace = (workspaceId: string): void => {
    const target = workspaces.find((ws) => ws.id === workspaceId)
    const firstUnreadPane = target?.panes.find((pane) => hasUnread(pane.id))
    if (firstUnreadPane) {
      handleActivatePane(firstUnreadPane.id)
    }
    onSelectWorkspace(workspaceId)
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
        <nav className="sidebar-rail-list" aria-label="Collapsed workspaces">
          {integrationGroups.map((group) => (
            <div key={group.id} className={`sidebar-rail-integration${group.id === activeIntegrationGroupId ? ' active' : ''}`} title={group.name}>
              <span>{group.name.slice(0, 1).toUpperCase()}</span>
              {group.members.slice(0, 4).map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className={`sidebar-rail-integration-member${member.id === activeIntegrationMemberId ? ' active' : ''}`}
                  title={`${member.role.toUpperCase()} · ${member.alias}`}
                  onClick={() => {
                    setActiveIntegrationGroup(group.id)
                    setActiveIntegrationMember(member.id)
                    onSelectWorkspace(member.workspaceId)
                  }}
                >
                  {member.role.slice(0, 1).toUpperCase()}
                </button>
              ))}
            </div>
          ))}
          {workspaces.map((workspace) => {
            const workspaceUnread = workspace.panes.some((pane) => hasUnread(pane.id))
            return (
              <div key={workspace.id} className={`sidebar-rail-workspace${workspace.id === activeWorkspaceId ? ' active' : ''}`}>
                <button
                  type="button"
                  className="sidebar-rail-workspace-btn"
                  title={workspace.name}
                  aria-label={workspace.name}
                  onClick={() => handleSelectWorkspace(workspace.id)}
                >
                  <span>{workspace.name.slice(0, 2).toUpperCase()}</span>
                  {workspaceUnread ? <i aria-hidden="true" /> : null}
                </button>
              </div>
            )
          })}
        </nav>
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
        {integrationGroups.length > 0 ? (
          <section className="sidebar-integration-list" aria-label="Integration groups">
            <div className="sidebar-section-kicker">Integration</div>
            {integrationGroups.map((group) => (
              <SidebarIntegrationRow
                key={group.id}
                group={group}
                isActive={group.id === activeIntegrationGroupId}
                activeMemberId={activeIntegrationMemberId}
                defaultExpanded={group.id === activeIntegrationGroupId}
                onSelectMember={(groupId, memberId, workspaceId) => {
                  setActiveIntegrationGroup(groupId)
                  setActiveIntegrationMember(memberId)
                  onSelectWorkspace(workspaceId)
                }}
              />
            ))}
          </section>
        ) : null}
        {filtered.length === 0 ? (
          <p className="sidebar-empty">No workspaces.</p>
        ) : (
          filtered.map(ws => (
            <WorkspaceGroup
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeWorkspaceId}
              onSelect={handleSelectWorkspace}
              onClose={onCloseWorkspace}
              isDragging={dragSourceId === ws.id}
              dropPosition={dragOverId === ws.id ? dropPosition : null}
              onDragStart={() => setDragSourceId(ws.id)}
              onDragOver={(position) => { setDragOverId(ws.id); setDropPosition(position) }}
              onDragLeave={() => { if (dragOverId === ws.id) { setDragOverId(null); setDropPosition(null) } }}
              onDrop={() => handleDropOnWorkspace(ws.id)}
              onDragEnd={() => { setDragSourceId(null); setDragOverId(null); setDropPosition(null) }}
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
