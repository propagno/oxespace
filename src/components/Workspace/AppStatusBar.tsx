import { FolderGit2, PanelsTopLeft, Radio, Moon } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { cx } from '../../ui'
import styles from './AppStatusBar.module.css'

interface AppStatusBarProps {
  workspace: Workspace | null
  activePaneId: string | null
}

export function AppStatusBar({ activePaneId, workspace }: AppStatusBarProps): ReactElement {
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
    <footer className={cx('app-statusbar', styles.bar)} aria-label="Workspace status bar">
      <div className={styles.group}>
        <span className={cx(styles.item, styles.strong)} title={workspace?.rootPath ?? 'No project selected'}>
          <FolderGit2 size={12} aria-hidden="true" />
          <span className={styles.path}>{workspace?.rootPath ?? 'No project selected'}</span>
        </span>
      </div>
      <div className={styles.group}>
        {workspace ? (
          <span className={styles.item} title="Open workspace panes">
            <PanelsTopLeft size={12} aria-hidden="true" />
            {workspace.panes.length} {workspace.panes.length === 1 ? 'pane' : 'panes'}
          </span>
        ) : null}
        {activePane ? <span className={styles.item}>{activePane.displayName ?? activePane.agentName ?? activePane.type}</span> : null}
        {backgroundPaneIds.length > 0 ? (
          <button
            type="button"
            className={cx(styles.item, styles.action)}
            onClick={stopBackgroundSessions}
            title={`${backgroundPaneIds.length} terminal${backgroundPaneIds.length === 1 ? '' : 's'} still running in workspaces that are not open. Click to stop them.`}
            data-testid="background-sessions"
          >
            <Moon size={12} aria-hidden="true" />
            {backgroundPaneIds.length} background
          </button>
        ) : null}
      </div>
    </footer>
  )
}
