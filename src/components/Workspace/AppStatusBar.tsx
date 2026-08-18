import { FolderGit2, GitBranch, PanelsTopLeft, Radio, Moon } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useTerminalStore } from '../../store/terminal.store'

interface AppStatusBarProps {
  workspace: Workspace | null
  activePaneId: string | null
  appVersion: string
}

export function AppStatusBar({ activePaneId, appVersion, workspace }: AppStatusBarProps): ReactElement {
  const branch = useGitBranch(workspace?.id ?? '', workspace?.rootPath ?? null)
  const activePane = workspace?.panes.find((pane) => pane.id === activePaneId) ?? null

  // Shells outlive their view now, so a workspace left behind can still be
  // running an agent. Without somewhere to see and stop them they would burn
  // tokens and CPU unobserved — this is that escape hatch.
  const panes = useTerminalStore((state) => state.panes)
  const backgroundPaneIds = useMemo(
    () => Object.entries(panes).filter(([, entry]) => entry.detached).map(([paneId]) => paneId),
    [panes]
  )

  const stopBackgroundSessions = (): void => {
    for (const paneId of backgroundPaneIds) {
      void window.oxe.terminal.stop({ paneId }).catch(() => undefined)
      useTerminalStore.getState().removePane(paneId)
    }
  }

  return (
    <footer className="app-statusbar" aria-label="Workspace status bar">
      <div className="app-statusbar-group">
        <span className="app-statusbar-item strong" title={workspace?.rootPath ?? 'No project selected'}>
          <FolderGit2 size={11} aria-hidden="true" />
          {workspace?.name ?? 'OXESpace'}
        </span>
        {branch?.branch ? (
          <span className="app-statusbar-item" title={`Current branch: ${branch.branch}`}>
            <GitBranch size={11} aria-hidden="true" />
            {branch.branch}
          </span>
        ) : null}
      </div>
      <div className="app-statusbar-group">
        {workspace ? (
          <span className="app-statusbar-item" title="Open workspace panes">
            <PanelsTopLeft size={11} aria-hidden="true" />
            {workspace.panes.length}
          </span>
        ) : null}
        {activePane ? <span className="app-statusbar-item">{activePane.displayName ?? activePane.agentName ?? activePane.type}</span> : null}
        {backgroundPaneIds.length > 0 ? (
          <button
            type="button"
            className="app-statusbar-item app-statusbar-action"
            onClick={stopBackgroundSessions}
            title={`${backgroundPaneIds.length} terminal${backgroundPaneIds.length === 1 ? '' : 's'} still running in workspaces that are not open. Click to stop them.`}
            data-testid="background-sessions"
          >
            <Moon size={11} aria-hidden="true" />
            {backgroundPaneIds.length} background
          </button>
        ) : null}
        <span className="app-statusbar-item connected">
          <Radio size={10} aria-hidden="true" />
          local
        </span>
        <span className="app-statusbar-item muted">v{appVersion}</span>
      </div>
    </footer>
  )
}
