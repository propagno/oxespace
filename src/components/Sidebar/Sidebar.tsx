import { ChevronDown, FolderOpen, PanelsTopLeft, Plus, Search, Waypoints } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { IntegrationGroup } from '../../../shared/types/integration'
import type { Workspace } from '../../../shared/types/workspace'
import { useIntegrationStore } from '../../store/integration.store'
import { rootPathKey } from '../../../shared/utils/path'
import { useWorkspaceStore } from '../../store/workspace.store'
import { deriveStatusTone } from '../../utils/paneDisplay'
import { SidebarFooterBar, SidebarHeaderActions, type RailAction } from '../Navigation/NavigationChrome'
import { CodeRail } from './CodeRail'
import { SidebarCollapseButton } from './SidebarCollapseButton'
import { Button, EmptyState, SegmentedControl, SidebarFilter, SidebarHeader, SidebarSection, Splitter, type MenuEntry } from '../../ui'
import { useTranslation } from 'react-i18next'
import { useNavigationSearch } from '../Navigation/useNavigationSearch'
import { SidebarIntegrationRow } from './SidebarIntegrationRow'
import { WorkspaceGroup } from './WorkspaceGroup'
import { PaneSessionRow } from './PaneSessionRow'
import { RemoteHostsSection } from './RemoteHostsSection'
import { useAgentStore } from '../../store/agent.store'
import { useUIStore } from '../../store/ui.store'
import { useTerminalStore } from '../../store/terminal.store'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_RESIZE_STEP, SIDEBAR_WIDTH, useNavigationPrefs, type SidebarStateFilter } from '../../store/navigation-prefs.store'
import './SidebarNavigation.css'
import { cachedBranchLabel } from '../../hooks/useGitBranch'
import { shortcutLabel } from '../../keyboard/keybindings'
import { useListKeyboard } from '../../hooks/useListKeyboard'

interface SidebarProps {
  onDelegations?: () => void

  workspaces: Workspace[]
  activeWorkspaceId: string | null
  appVersion: string
  onNewWorkspace: () => void
  onSelectWorkspace: (id: string) => void
  onCloseWorkspace: (id: string) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  /** Opens the Tools hub modal (workspace panels, MCP, skills, …). */
  /** The Panels menu of the active workspace, shared with its bar. */
  panelMenu?: MenuEntry[]
  /** Background jobs dock (honest label — not "Tasks" until kanban returns). */
  onOpenJobs?: () => void
  /** Scripts discovery panel. */
  onOpenScripts?: () => void
  /** Unified CommandMenu (Ctrl+J). */
  onOpenSearch?: () => void
  integrationGroups?: IntegrationGroup[]
}


/** The terminals a workspace lists in the sidebar (placed in its grid). */
const sidebarTerminals = (ws: Workspace): Workspace['panes'] => ws.panes.filter(p => p.type === 'terminal' && p.rowIndex >= 0 && p.columnIndex >= 0)
/** A terminal's state for the sidebar's state selector (OXE-133): stopped on the person, working, or neither. */
function terminalState(entry: Parameters<typeof deriveStatusTone>[0] | undefined): Exclude<SidebarStateFilter, 'all'> | null {
  if (!entry) return null
  const tone = deriveStatusTone(entry)
  return tone === 'needs-decision' ? 'needs-you' : tone === 'thinking' ? 'working' : null
}
const STATE_FILTERS: SidebarStateFilter[] = ['all', 'needs-you', 'working']
const STATE_KEYS = { all: 'all', 'needs-you': 'needsYou', working: 'working' } as const

export function Sidebar({
  onDelegations,
  activeWorkspaceId,
  appVersion,
  isCollapsed,
  onCloseWorkspace,
  onNewWorkspace,
  onOpenSearch,
  panelMenu,
  onSelectWorkspace,
  onToggleCollapse,
  integrationGroups = [],
  workspaces,
}: SidebarProps): ReactElement {
  const { t } = useTranslation('code')
  const { t: tc } = useTranslation('common')
  const [searchQuery, setSearchQuery] = useState('')
  const width = useNavigationPrefs(s => s.width)
  const expanded = useNavigationPrefs(s => s.expanded)
  const setWidth = useNavigationPrefs(s => s.setWidth)
  const setExpanded = useNavigationPrefs(s => s.setExpanded)
  const profiles = useAgentStore(s => s.allProfiles)
  const activePaneId = useUIStore(s => s.activePaneId)
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
  // Arrows and j/k move through workspaces and their terminals; one tab stop for the whole list.
  const { ref: attachList, onKeyDown: onListKeyDown } = useListKeyboard<HTMLElement>()

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
      ws.panes.some((p) => {
        // A pane whose agent moved into a worktree is found by that worktree's branch too.
        const moved = useTerminalStore.getState().panes[p.id]?.location
        const movedText = moved?.sameRepository && moved.checkoutRoot ? `${moved.checkoutRoot} ${cachedBranchLabel(moved.checkoutRoot)}` : ''
        return `${p.displayName ?? ''} ${p.agentName ?? p.type} ${profiles.find(profile => profile.agentProfileId === p.agentProfileId)?.name ?? ''} ${p.rootPath ?? ''} ${cachedBranchLabel(p.rootPath ?? ws.rootPath)} ${movedText}`.toLowerCase().includes(q)
      })
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

  // Clicking a workspace row in the sidebar activates it.
  const handleSelectWorkspace = (workspaceId: string): void => {
    onSelectWorkspace(workspaceId)
  }

  const railPrimary: RailAction[] = [
    { id: 'new-workspace', label: t('sidebar.newWorkspace'), icon: Plus, testId: 'btn-new-workspace', onClick: onNewWorkspace },
    ...(onDelegations ? [{ id: 'delegated-work', label: t('background.delegated'), icon: Waypoints, onClick: onDelegations }] : []),
    { id: 'search', label: t('sidebar.search', { shortcut: shortcutLabel('palette.search') }), ariaLabel: t('sidebar.searchLabel'), icon: Search, onClick: onOpenSearch },
    ...(workspaces.length > 0 && !searchQuery ? [{
      id: 'toggle-all',
      label: t('sidebar.toggleAll'),
      icon: ChevronDown,
      onClick: () => {
        const shouldExpand = workspaces.some(w => !(expanded[w.id] ?? w.id === activeWorkspaceId))
        workspaces.forEach(w => setExpanded(w.id, shouldExpand))
      }
    }] : [])
  ]
  const railContext: RailAction = { id: 'panels', label: t('panels.menu'), ariaLabel: t('sidebar.openPanels'), icon: PanelsTopLeft, testId: 'btn-open-tools', disabled: !panelMenu, menu: panelMenu }

  const terminalPanes = useTerminalStore(s => s.panes)
  const needsYou = useMemo(() => {
    const ids = new Set<string>()
    for (const ws of workspaces) {
      if (ws.panes.some(p => p.type === 'terminal' && p.id in terminalPanes && deriveStatusTone(terminalPanes[p.id]) === 'needs-decision')) ids.add(ws.id)
    }
    return ids
  }, [workspaces, terminalPanes])

  // OXE-133: the state selector narrows the terminal rows, and the workspaces that hold them, after the text filter.
  const stateFilter = useNavigationPrefs(state => state.stateFilter.code)
  const setStateFilter = useNavigationPrefs(state => state.setStateFilter)
  const stateCounts = useMemo(() => {
    const counts: Record<SidebarStateFilter, number> = { all: 0, 'needs-you': 0, working: 0 }
    for (const ws of filtered) for (const p of sidebarTerminals(ws)) {
      counts.all += 1
      const state = terminalState(terminalPanes[p.id])
      if (state) counts[state] += 1
    }
    return counts
  }, [filtered, terminalPanes])
  const shown = useMemo(() => stateFilter === 'all' ? filtered
    : filtered.filter(ws => sidebarTerminals(ws).some(p => terminalState(terminalPanes[p.id]) === stateFilter)), [filtered, stateFilter, terminalPanes])

  if (isCollapsed) {
    return (
      <aside className="sidebar sidebar-redesign sidebar-collapsed" data-version={appVersion}>
        <CodeRail
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          needsYou={needsYou}
          onSelect={handleSelectWorkspace}
          onNewWorkspace={onNewWorkspace}
        />
      </aside>
    )
  }

  return (
    <aside className="sidebar sidebar-redesign" style={{ width, minWidth: width, flexBasis: width }}>
      <Splitter edge orientation="vertical" label={t('sidebar.width')} value={width} min={SIDEBAR_MIN_WIDTH} max={SIDEBAR_MAX_WIDTH} defaultValue={SIDEBAR_WIDTH} step={SIDEBAR_RESIZE_STEP} onChange={setWidth} />
      {/* The version is in the status bar and in About. As a title on this whole panel it opened a tooltip over the menu
          bar whenever the pointer rested on any empty part of the sidebar. */}
      <div className="nav-panel" data-version={appVersion}>
      <SidebarHeader title={t('sidebar.workspaces')} actions={<SidebarHeaderActions actions={railPrimary} />} collapse={<SidebarCollapseButton mode="code" />} />
      <SidebarFilter ref={searchInputRef} icon={<Search size={14} />} hint={searchQuery ? undefined : '/'} aria-label={t('sidebar.filter')} placeholder={t('sidebar.filterPlaceholder')}
        value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onClear={() => setSearchQuery('')} clearLabel={tc('nav.clearSearch')} autoComplete="off" spellCheck={false}
        // Escape clears the text first (the filter does), then the state.
        onKeyDown={event => { if (event.key === 'Escape' && !searchQuery && stateFilter !== 'all') { event.preventDefault(); event.stopPropagation(); setStateFilter('code', 'all') } }} />
      <SegmentedControl className="sidebar-state-filter" label={t('sidebar.stateFilter.label')} value={stateFilter} onChange={value => setStateFilter('code', value)}
        options={STATE_FILTERS.map(value => ({ value, label: <><span className="sidebar-state-label">{t(`sidebar.stateFilter.${STATE_KEYS[value]}`)}</span>{' '}<span className="sidebar-state-count">{stateCounts[value]}</span></> }))} />

      <nav ref={attachList} onKeyDown={onListKeyDown} className="ws-group-list" aria-label={t('sidebar.workspaces')}>

        {integrationGroups.length > 0 ? (
          <section className="sidebar-integration-list" aria-label={t('sidebar.integrationGroups')}>
            <SidebarSection label={t('sidebar.integrations')} />
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

        {shown.length === 0 ? (
          searchQuery && filtered.length === 0
            ? <EmptyState compact title={t('sidebar.noMatch')} />
            : stateFilter !== 'all'
            ? <EmptyState compact title={t(stateFilter === 'needs-you' ? 'sidebar.stateFilter.emptyNeedsYou' : 'sidebar.stateFilter.emptyWorking')}
                actions={<Button size="sm" variant="secondary" onClick={() => setStateFilter('code', 'all')}>{t('sidebar.stateFilter.showAll')}</Button>} />
            : <EmptyState compact icon={<FolderOpen size={16} />} title={t('sidebar.none')} actions={<Button size="sm" variant="secondary" icon={<Plus size={12} aria-hidden="true" />} onClick={onNewWorkspace}>{t('sidebar.newWorkspace')}</Button>} />
        ) : (
          shown.map((ws) => {
            const terminals = sidebarTerminals(ws).filter(p => stateFilter === 'all' || terminalState(terminalPanes[p.id]) === stateFilter)
            const open = Boolean(searchQuery) || stateFilter !== 'all' || (expanded[ws.id] ?? ws.id === activeWorkspaceId)
            const isActive = ws.id === activeWorkspaceId
            // One selection at a time (brand 14/11): the workspace row is the selection only while none of its terminals
            // is. The 1.4 structure stays: each workspace's terminal rows come right after its row.
            const terminalSelected = isActive && open && terminals.some(p => p.id === activePaneId)
            return (
              <Fragment key={ws.id}>
                <WorkspaceGroup
                  workspace={ws}
                  isActive={isActive}
                  selected={isActive && !terminalSelected}
                  duplicate={duplicateRoots.get(ws.id) ?? null}
                  onSelect={handleSelectWorkspace}
                  onClose={onCloseWorkspace}
                  terminalsExpanded={open}
                  terminalCount={terminals.length}
                  onToggleTerminals={searchQuery || stateFilter !== 'all' ? undefined : () => setExpanded(ws.id, !(expanded[ws.id] ?? ws.id === activeWorkspaceId))}
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
                {open && terminals.length > 0 ? <div>
                  {terminals.map((pane, index) =>
                    <PaneSessionRow key={pane.id} pane={pane} paneIndex={index} workspace={ws} agentProfiles={profiles}
                      isActive={isActive && pane.id === activePaneId} onClick={() => {}} onActivatePane={id => { void activatePane(ws.id, id) }} />)}
                </div> : null}
              </Fragment>
            )
          })
        )}
        <RemoteHostsSection activeWorkspaceId={activeWorkspaceId} onActivatePane={activatePane} />
      </nav>
      <SidebarFooterBar className="nav-rail-footer" context={panelMenu ? railContext : undefined} />
      </div>
    </aside>
  )
}
