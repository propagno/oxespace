import { ChevronDown, FolderTree, Network, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { selectIntegrationsForWorkspace, useIntegrationStore } from '../../store/integration.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { selectWorktrees, useWorktreeStore } from '../../store/worktree.store'
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
  // Worktree badge — list of non-main worktrees for this repo. Fetched lazily
  // on mount via the store; subsequent toggles read from cache. Same store
  // also powers the WorktreePanelBody so there's no duplicated IPC.
  const worktreeSelector = useCallback(selectWorktrees(workspace.rootPath), [workspace.rootPath])
  const worktrees = useWorktreeStore(worktreeSelector)
  const refreshWorktrees = useWorktreeStore((s) => s.refresh)
  const updateWorktreeState = useWorkspaceStore((s) => s.updateWorktreeState)
  const nonMainWorktreeCount = worktrees.filter((wt) => !wt.isMain).length

  useEffect(() => {
    // Kick the store once when the row appears so the count chip lands
    // without requiring the user to open the worktree panel first. The store
    // dedupes by rootPath, so this is safe to repeat across renders.
    void refreshWorktrees(workspace.id, workspace.rootPath)
  }, [workspace.id, workspace.rootPath, refreshWorktrees])

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

  function handleWorktreeBadgeClick(e: React.MouseEvent): void {
    e.stopPropagation()
    onSelect(workspace.id)
    void updateWorktreeState({
      workspaceId: workspace.id,
      worktreePanelVisible: true,
      worktreePanelExpanded: workspace.worktreePanelExpanded ?? false
    })
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
          <span
            className="ws-group-name"
            title={`${workspace.name}\n~/${rootLabel}`}
          >
            {workspace.name}
          </span>
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
        {nonMainWorktreeCount > 0 ? (
          <button
            type="button"
            className="ws-group-worktree-count"
            title={`${nonMainWorktreeCount} active worktree${nonMainWorktreeCount === 1 ? '' : 's'} — click to open worktree panel`}
            aria-label={`Open worktree panel — ${nonMainWorktreeCount} active worktree${nonMainWorktreeCount === 1 ? '' : 's'}`}
            onClick={handleWorktreeBadgeClick}
            data-testid="ws-group-worktree-badge"
          >
            <FolderTree size={11} aria-hidden="true" />
            {nonMainWorktreeCount > 1 ? <span>{nonMainWorktreeCount}</span> : null}
          </button>
        ) : null}
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
