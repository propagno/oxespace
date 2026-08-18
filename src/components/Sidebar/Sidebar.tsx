import { Activity, ChevronsLeft, ChevronsRight, Code2, Plus, Search, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { IntegrationGroup } from '../../../shared/types/integration'
import type { Workspace } from '../../../shared/types/workspace'
import { useIntegrationStore } from '../../store/integration.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useWorkspaceActivity } from '../../hooks/useWorkspaceActivity'
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
  isCollapsed: boolean
  onToggleCollapse: () => void
  /** Opens the Tools hub modal (workspace panels, MCP, skills, …). */
  onOpenTools: () => void
  /** Background jobs dock (honest label — not Orca "Tasks" until kanban returns). */
  onOpenJobs?: () => void
  /** Scripts discovery panel. */
  onOpenScripts?: () => void
  /** Unified CommandMenu (Ctrl+J). */
  onOpenSearch?: () => void
  integrationGroups?: IntegrationGroup[]
}


export function Sidebar({
  activeWorkspaceId,
  appVersion,
  isCollapsed,
  onCloseWorkspace,
  onNewWorkspace,
  onOpenJobs,
  onOpenScripts,
  onOpenSearch,
  onOpenTools,
  onSelectWorkspace,
  onToggleCollapse,
  integrationGroups = [],
  workspaces,
}: SidebarProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Drag-and-drop workspace reorder state. We don't use HTML5 dragstart
  // payload because Electron's renderer has quirks with cross-process
  // data transfer — instead we track the source/target ids in component
  // state and only consult dataTransfer for the dragImage / effectAllowed.
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null)
  const activeIntegrationGroupId = useIntegrationStore((state) => state.activeGroupId)
  const activeIntegrationMemberId = useIntegrationStore((state) => state.activeMemberId)
  const setActiveIntegrationGroup = useIntegrationStore((state) => state.setActiveGroup)
  const setActiveIntegrationMember = useIntegrationStore((state) => state.setActiveMember)
  const reorderWorkspaces = useWorkspaceStore((state) => state.reorderWorkspaces)

  // Memoized so the O(workspaces × panes) search filter only recomputes when the
  // list or query actually changes — not on every re-render triggered by
  // unrelated terminal-store activity. Declared before the collapsed early
  // return to keep hook order stable.
  const filtered = useMemo(() => {
    if (!searchQuery) return workspaces
    const q = searchQuery.toLowerCase()
    return workspaces.filter((ws) =>
      ws.name.toLowerCase().includes(q) ||
      ws.panes.some((p) => (p.agentName ?? p.type).toLowerCase().includes(q))
    )
  }, [workspaces, searchQuery])

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

  // Clicking a workspace card in the sidebar activates it. Pane-level
  // navigation lives in the grid; per-pane state reads from the status dot.
  const handleSelectWorkspace = (workspaceId: string): void => {
    onSelectWorkspace(workspaceId)
  }

  if (isCollapsed) {
    return (
      <aside className="sidebar sidebar-collapsed">
        <div className="sidebar-brand sidebar-brand-collapsed">
          <OxeLogo />
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
          {workspaces.map((workspace) => (
            <RailWorkspace
              key={workspace.id}
              workspace={workspace}
              isActive={workspace.id === activeWorkspaceId}
              onSelect={() => handleSelectWorkspace(workspace.id)}
            />
          ))}
        </nav>
        <div className="sidebar-footer sidebar-footer-collapsed">
          <button
            type="button"
            className="sidebar-tools-btn"
            aria-label="Open tools"
            title="Tools — panels, MCP, skills"
            data-testid="btn-open-tools"
            onClick={onOpenTools}
          >
            <Wrench size={16} aria-hidden="true" />
          </button>
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

  return (
    <aside className="sidebar">
      <div className="sidebar-header-bar">
        <div className="sidebar-header-brand">
          <OxeLogo size={20} variant="wordmark" />
          <span className="sidebar-version-badge" title={`OXESpace ${appVersion}`}>
            v{appVersion}
          </span>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            className="sidebar-icon-btn sidebar-new-btn"
            aria-label="New workspace"
            title="New workspace"
            data-testid="btn-new-workspace"
            onClick={onNewWorkspace}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav className="sidebar-quick-nav" aria-label="Primary navigation">
        <button type="button" className="sidebar-nav-item" onClick={onOpenJobs} title="Background jobs dock">
          <Activity size={14} className="sidebar-nav-icon" aria-hidden="true" />
          <span className="sidebar-nav-label">Jobs</span>
        </button>
        <button type="button" className="sidebar-nav-item" onClick={onOpenScripts} title="Project scripts">
          <Code2 size={14} className="sidebar-nav-icon" aria-hidden="true" />
          <span className="sidebar-nav-label">Scripts</span>
        </button>
        <button type="button" className="sidebar-nav-item" onClick={onOpenSearch} title="Search files & commands (Ctrl+J)">
          <Search size={14} className="sidebar-nav-icon" aria-hidden="true" />
          <span className="sidebar-nav-label">Search</span>
          <kbd className="sidebar-nav-kbd">Ctrl J</kbd>
        </button>
      </nav>

      <div className="sidebar-search-wrap">
        <Search size={13} className="sidebar-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          className="sidebar-search-input"
          placeholder="Filter projects… (/)"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          aria-label="Filter projects"
          autoComplete="off"
          spellCheck={false}
        />
        {searchQuery ? (
          <button
            type="button"
            className="sidebar-search-clear"
            aria-label="Clear search"
            onClick={() => setSearchQuery('')}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : (
          <kbd className="sidebar-search-kbd">/</kbd>
        )}
      </div>

      <nav className="ws-group-list" aria-label="Workspaces">

        {integrationGroups.length > 0 ? (
          <section className="sidebar-integration-list" aria-label="Integration groups">
            <div className="sidebar-section-header">
              <span>Integration</span>
            </div>
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

        <div className="sidebar-section-header">
          <span>Projects</span>
          <button
            type="button"
            className="sidebar-section-action-btn"
            title="New workspace"
            aria-label="New workspace"
            onClick={onNewWorkspace}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="sidebar-empty-state">
            <div className="sidebar-empty-icon">📁</div>
            <p>No workspaces found.</p>
            {!searchQuery && (
              <button type="button" className="sidebar-empty-btn" onClick={onNewWorkspace}>
                Create workspace
              </button>
            )}
          </div>
        ) : (
          filtered.map((ws) => (
            <WorkspaceGroup
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeWorkspaceId}
              onSelect={handleSelectWorkspace}
              onClose={onCloseWorkspace}
              isDragging={dragSourceId === ws.id}
              dropPosition={dragOverId === ws.id ? dropPosition : null}
              onDragStart={() => setDragSourceId(ws.id)}
              onDragOver={(position) => {
                setDragOverId(ws.id)
                setDropPosition(position)
              }}
              onDragLeave={() => {
                if (dragOverId === ws.id) {
                  setDragOverId(null)
                  setDropPosition(null)
                }
              }}
              onDrop={() => handleDropOnWorkspace(ws.id)}
              onDragEnd={() => {
                setDragSourceId(null)
                setDragOverId(null)
                setDropPosition(null)
              }}
            />
          ))
        )}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-tools-btn sidebar-tools-btn-labeled"
          aria-label="Open tools"
          title="Tools — panels, MCP, skills"
          data-testid="btn-open-tools"
          onClick={onOpenTools}
        >
          <span className="sidebar-tools-btn-icon" aria-hidden="true">
            <Wrench size={14} />
          </span>
          <span className="sidebar-tools-btn-copy">
            <span className="sidebar-tools-btn-label">Tools</span>
            <span className="sidebar-tools-btn-hint">Panels · MCP · Skills</span>
          </span>
        </button>
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

/**
 * Collapsed-rail workspace button. Its status pip is colored by the dominant
 * agent activity tone — same vocabulary as the expanded cards.
 */
function RailWorkspace({ workspace, isActive, onSelect }: {
  workspace: Workspace
  isActive: boolean
  onSelect: () => void
}): ReactElement {
  const activity = useWorkspaceActivity(workspace)
  const tone = activity.dominant
  const showPip = tone !== null && tone !== 'idle' && tone !== 'exited'
  return (
    <div className={`sidebar-rail-workspace${isActive ? ' active' : ''}`}>
      <button
        type="button"
        className="sidebar-rail-workspace-btn"
        title={workspace.name}
        aria-label={workspace.name}
        onClick={onSelect}
      >
        <span>{workspace.name.slice(0, 2).toUpperCase()}</span>
        {showPip ? <i className={`sidebar-rail-pip activity-${tone}`} aria-hidden="true" /> : null}
      </button>
    </div>
  )
}
