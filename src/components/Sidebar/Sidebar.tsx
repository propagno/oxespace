import { ChevronDown, FolderOpen, MessagesSquare, Plus, Search, Wrench, Waypoints } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { IntegrationGroup } from '../../../shared/types/integration'
import type { Workspace } from '../../../shared/types/workspace'
import { useIntegrationStore } from '../../store/integration.store'
import { rootPathKey } from '../../../shared/utils/path'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useWorkspaceActivity } from '../../hooks/useWorkspaceActivity'
import { NavigationBrand, NavigationFooter } from '../Navigation/NavigationChrome'
import { useNavigationSearch } from '../Navigation/useNavigationSearch'
import { SearchField } from '../Navigation/SearchField'
import { SidebarIntegrationRow } from './SidebarIntegrationRow'
import { WorkspaceGroup } from './WorkspaceGroup'
import { PaneSessionRow } from './PaneSessionRow'
import { useAgentStore } from '../../store/agent.store'
import { useUIStore } from '../../store/ui.store'
import { useTerminalStore } from '../../store/terminal.store'
import { SIDEBAR_RESIZE_STEP, useNavigationPrefs } from '../../store/navigation-prefs.store'
import './SidebarNavigation.css'
import { cachedBranchLabel } from '../../hooks/useGitBranch'

interface SidebarProps {
  onDelegations?: () => void
  onSwitchToThread?: () => void

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
  onDelegations,
  onSwitchToThread,
  activeWorkspaceId,
  appVersion,
  isCollapsed,
  onCloseWorkspace,
  onNewWorkspace,
  onOpenSearch,
  onOpenTools,
  onSelectWorkspace,
  onToggleCollapse,
  integrationGroups = [],
  workspaces,
}: SidebarProps): ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const width = useNavigationPrefs(s => s.width)
  const expanded = useNavigationPrefs(s => s.expanded)
  const setWidth = useNavigationPrefs(s => s.setWidth)
  const setExpanded = useNavigationPrefs(s => s.setExpanded)
  const profiles = useAgentStore(s => s.allProfiles)
  const activePaneId = useUIStore(s => s.activePaneId)
  const resizing = useRef(false)
  useEffect(() => {
    for (const workspace of workspaces) {
      if (!(workspace.id in expanded)) setExpanded(workspace.id, workspace.id === activeWorkspaceId)
    }
  }, [workspaces, expanded, activeWorkspaceId, setExpanded])
  const activatePane = async (workspaceId: string, paneId: string): Promise<void> => {
    await useWorkspaceStore.getState().setActiveWorkspace(workspaceId)
    useUIStore.getState().setMaximizedPane(null)
    useUIStore.getState().setActivePane(paneId)
    useTerminalStore.getState().setActivePaneId(paneId)
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('oxe:focus-pane', { detail: { paneId } })))
  }
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useNavigationSearch(searchInputRef, isCollapsed, onToggleCollapse)

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
      cachedBranchLabel(ws.rootPath).toLowerCase().includes(q) ||
      ws.panes.some((p) => `${p.displayName ?? ''} ${p.agentName ?? p.type} ${profiles.find(profile => profile.agentProfileId === p.agentProfileId)?.name ?? ''} ${p.rootPath ?? ''} ${cachedBranchLabel(p.rootPath ?? ws.rootPath)}`.toLowerCase().includes(q))
    )
  }, [workspaces, searchQuery, profiles])

  // Workspaces that sit on the same folder are otherwise identical in this list:
  // the name defaults to the folder's basename and the branch is read from the
  // root, so every row renders the same two lines. `create` refuses to make new
  // ones, but databases from before that rule still hold them, and the user has
  // to be able to tell them apart to close the extras. Numbered over the full
  // list rather than the filtered one so a search doesn't renumber the rows.
  const duplicateRoots = useMemo(() => {
    const seen = new Map<string, string[]>()
    for (const ws of workspaces) {
      const key = rootPathKey(ws.rootPath, window.oxe.app.platform)
      const bucket = seen.get(key)
      if (bucket) bucket.push(ws.id)
      else seen.set(key, [ws.id])
    }
    const numbered = new Map<string, { index: number; count: number }>()
    for (const ids of seen.values()) {
      if (ids.length < 2) continue
      ids.forEach((id, index) => numbered.set(id, { index: index + 1, count: ids.length }))
    }
    return numbered
  }, [workspaces])

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
      <aside className="sidebar sidebar-redesign sidebar-collapsed">
        <NavigationBrand collapsed mode="code" onModeChange={onSwitchToThread} version={appVersion} />
        {onSwitchToThread && <nav className="sidebar-mode-rail" aria-label="Application view"><button type="button" className="sidebar-collapse-btn" aria-label="Thread" title="Switch to Thread" aria-pressed={false} onClick={onSwitchToThread}><MessagesSquare size={16} /></button></nav>}
        <nav className="sidebar-rail-list" aria-label="Collapsed workspaces">
          <button type="button" className="desktop-rail-action" data-testid="btn-new-workspace" aria-label="New workspace" title="New workspace" onClick={onNewWorkspace}><Plus size={16} aria-hidden="true" /></button>
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
        <NavigationFooter className="sidebar-footer" collapsed context={{ label: 'Tools', ariaLabel: 'Open tools', icon: Wrench, onClick: onOpenTools, testId: 'btn-open-tools' }} onToggle={onToggleCollapse} />
      </aside>
    )
  }

  return (
    <aside className="sidebar sidebar-redesign" style={{ width, minWidth: width, flexBasis: width }}>
      <div className="sidebar-width-handle" role="separator" aria-label="Sidebar width" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={360} aria-valuenow={width} tabIndex={0}
        onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setWidth(width + (e.key === 'ArrowLeft' ? -SIDEBAR_RESIZE_STEP : SIDEBAR_RESIZE_STEP)) } }}
        onPointerDown={e => { resizing.current = true; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault() }}
        onPointerMove={e => { if (resizing.current) setWidth(e.clientX - (e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0)) }}
        onPointerUp={() => { resizing.current = false }} onPointerCancel={() => { resizing.current = false }} onLostPointerCapture={() => { resizing.current = false }} />
      <NavigationBrand collapsed={false} mode="code" onModeChange={onSwitchToThread} version={appVersion} />
      <nav className="sidebar-quick-nav" aria-label="Primary navigation">
        <button type="button" className="sidebar-nav-item" data-testid="btn-new-workspace" aria-label="New workspace" onClick={onNewWorkspace}><Plus size={16} aria-hidden="true" /><span>New workspace</span></button>
        {onDelegations && <button type="button" className="sidebar-nav-item" onClick={onDelegations}><Waypoints size={15} /><span>Delegated work</span></button>}
        <button type="button" className="sidebar-nav-item" onClick={onOpenSearch} title="Search files & commands (Ctrl+J)">
          <Search size={14} className="sidebar-nav-icon" aria-hidden="true" />
          <span className="sidebar-nav-label">Files &amp; commands</span>
          <kbd className="sidebar-nav-kbd">Ctrl J</kbd>
        </button>
      </nav>

      <SearchField className="sidebar-search-wrap" inputClassName="sidebar-search-input" ref={searchInputRef} label="Filter workspaces" placeholder="Filter workspaces" value={searchQuery} onChange={setSearchQuery} shortcut="/" />

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
          <span>Workspaces</span>
          {workspaces.length > 0 && !searchQuery && <button type="button" className="sidebar-section-action-btn" aria-label="Toggle all workspace terminals" onClick={() => {
            const shouldExpand = workspaces.some(w => !(expanded[w.id] ?? w.id === activeWorkspaceId))
            workspaces.forEach(w => setExpanded(w.id, shouldExpand))
          }}><ChevronDown size={12} /></button>}

        </div>

        {filtered.length === 0 ? (
          <div className="sidebar-empty-state">
            <FolderOpen size={22} aria-hidden="true" />
            <p>{searchQuery ? 'No matching workspaces.' : 'No workspaces yet.'}</p>
          </div>
        ) : (
          filtered.map((ws) => (
            <section key={ws.id} className={`sidebar-workspace-tree${ws.id === activeWorkspaceId ? ' active' : ''}`}>
            <WorkspaceGroup
              key={ws.id}
              workspace={ws}
              isActive={ws.id === activeWorkspaceId}
              duplicate={duplicateRoots.get(ws.id) ?? null}
              onSelect={handleSelectWorkspace}
              onClose={onCloseWorkspace}
              terminalsExpanded={Boolean(searchQuery) || (expanded[ws.id] ?? ws.id === activeWorkspaceId)}
              terminalCount={ws.panes.filter(p => p.type === 'terminal' && p.rowIndex >= 0 && p.columnIndex >= 0).length}
              onToggleTerminals={searchQuery ? undefined : () => setExpanded(ws.id, !(expanded[ws.id] ?? ws.id === activeWorkspaceId))}
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
            {(searchQuery || (expanded[ws.id] ?? ws.id === activeWorkspaceId)) && <div className="sidebar-terminal-children">
              {ws.panes.filter(p => p.type === 'terminal' && p.rowIndex >= 0 && p.columnIndex >= 0).map((pane, index) =>
                <PaneSessionRow key={pane.id} pane={pane} paneIndex={index} workspace={ws} agentProfiles={profiles}
                  isActive={ws.id === activeWorkspaceId && pane.id === activePaneId} onClick={() => {}} onActivatePane={id => { void activatePane(ws.id, id) }} />)}
            </div>}
            </section>
          ))
        )}
      </nav>

      <NavigationFooter className="sidebar-footer" collapsed={false} context={{ label: 'Tools', ariaLabel: 'Open tools', icon: Wrench, onClick: onOpenTools, testId: 'btn-open-tools' }} onToggle={onToggleCollapse} />
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
