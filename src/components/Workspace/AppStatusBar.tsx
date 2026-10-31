import { FolderGit2, PanelsTopLeft, Radio, Moon, WifiOff } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useAgentStore } from '../../store/agent.store'
import { UsageStatus } from './UsageStatus'
import { useConnectivity } from '../../hooks/useConnectivity'
import { cx } from '../../ui'
import styles from './AppStatusBar.module.css'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

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

  const offline = useConnectivity() === 'offline'
  return (
    <footer className={cx('app-statusbar', styles.bar, docked && styles.docked)} aria-label={tc('workspace.status.bar')}>
      <div className={styles.group}>
        <span className={cx(styles.item, styles.strong)} title={path ?? tc('workspace.status.noProject')}>
          <FolderGit2 size={12} aria-hidden="true" />
          <span className={styles.path}>{path ?? tc('workspace.status.noProject')}</span>
        </span>
      </div>
      <div className={styles.group}>
        {offline ? <span className={cx(styles.item, styles.offline)} role="status" title={i18n.t('ui.offline.message')} data-testid="offline-indicator"><WifiOff size={12} aria-hidden="true" />{i18n.t('ui.offline.title')}</span> : null}
        {provider ? <UsageStatus provider={provider} /> : null}
        {workspace ? (
          <span className={styles.item} title={tc('workspace.status.panesTitle')}>
            <PanelsTopLeft size={12} aria-hidden="true" />
            {tc('workspace.status.panes', { count: workspace.panes.length })}
          </span>
        ) : null}
        {activePane ? <span className={styles.item}>{activePane.displayName ?? activePane.agentName ?? activePane.type}</span> : null}
        {backgroundPaneIds.length > 0 ? (
          <button
            type="button"
            className={cx(styles.item, styles.action)}
            onClick={stopBackgroundSessions}
            title={tc('workspace.status.backgroundTitle', { count: backgroundPaneIds.length })}
            data-testid="background-sessions"
          >
            <Moon size={12} aria-hidden="true" />
            {tc('workspace.status.background', { count: backgroundPaneIds.length })}
          </button>
        ) : null}
      </div>
    </footer>
  )
}
