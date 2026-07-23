import { FolderGit2, GitBranch, PanelsTopLeft, Radio } from 'lucide-react'
import type { ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'

interface AppStatusBarProps {
  workspace: Workspace | null
  activePaneId: string | null
  appVersion: string
}

export function AppStatusBar({ activePaneId, appVersion, workspace }: AppStatusBarProps): ReactElement {
  const branch = useGitBranch(workspace?.id ?? '', workspace?.rootPath ?? null)
  const activePane = workspace?.panes.find((pane) => pane.id === activePaneId) ?? null

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
        <span className="app-statusbar-item connected">
          <Radio size={10} aria-hidden="true" />
          local
        </span>
        <span className="app-statusbar-item muted">v{appVersion}</span>
      </div>
    </footer>
  )
}
