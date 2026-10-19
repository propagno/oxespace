import { FolderGit2, PanelsTopLeft, Radio, Moon } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useAgentStore } from '../../store/agent.store'
import { UsageStatus } from './UsageStatus'
import { cx } from '../../ui'
import styles from './AppStatusBar.module.css'

interface AppStatusBarProps {
  workspace: Workspace | null
  activePaneId: string | null
  /** Thread passes its conversation's provider and folder; Code reads them from the active pane. */
  usageProvider?: 'claude' | 'codex' | null
  rootPath?: string
  /** Laid out as a row of the surface instead of over its bottom edge. */
  docked?: boolean
}

export function AppStatusBar({ activePaneId, workspace, usageProvider, rootPath, docked }: AppStatusBarProps): ReactElement {
  const activePane = workspace?.panes.find((pane) => pane.id === activePaneId) ?? null
  const profiles = useAgentStore((state) => state.allProfiles)
  // The usage shown follows the agent in use: Claude or Codex (directly or as a parent profile).
  const paneProvider = useMemo(() => {
    const profile = activePane?.agentProfileId ? profiles.find((value) => value.agentProfileId === activePane.agentProfileId) : undefined
    const providers = [profile?.provider, profile?.parentProvider]
    return providers.includes('claude') ? 'claude' as const : providers.includes('codex') ? 'codex' as const : null
  }, [activePane?.agentProfileId, profiles])
  const provider = usageProvider === undefined ? paneProvider : usageProvider
  const path = rootPath ?? workspace?.rootPath

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
    <footer className={cx('app-statusbar', styles.bar, docked && styles.docked)} aria-label="Workspace status bar">
      <div className={styles.group}>
        <span className={cx(styles.item, styles.strong)} title={path ?? 'No project selected'}>
          <FolderGit2 size={12} aria-hidden="true" />
          <span className={styles.path}>{path ?? 'No project selected'}</span>
        </span>
      </div>
      <div className={styles.group}>
        {provider ? <UsageStatus provider={provider} /> : null}
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
