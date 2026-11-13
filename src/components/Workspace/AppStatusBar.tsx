import { FolderGit2, GitBranch, Moon, WifiOff } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useTerminalStore } from '../../store/terminal.store'
import { useAgentStore } from '../../store/agent.store'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useAttentionSummary } from '../../hooks/useAttentionSummary'
import { lazyFrom } from '../../lib/chunk'
import { USAGE_CHUNK } from './usageChunk'
import { USAGE_PROVIDERS, type UsageProvider } from './usageProviders'
// Usage reads the provider's quota after first paint; OxeChat's view chunk loads it too (usageChunk.ts).
const UsageStatus = lazyFrom(USAGE_CHUNK, module => module.UsageStatus)
import { useConnectivity } from '../../hooks/useConnectivity'
import { cx } from '../../ui'
import styles from './AppStatusBar.module.css'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface AppStatusBarProps {
  workspace: Workspace | null
  activePaneId: string | null
  /** Thread passes its conversation's provider and folder; Code reads them from the active pane. */
  usageProvider?: UsageProvider | null
  rootPath?: string
  /** Laid out as a row of the surface instead of over its bottom edge. */
  docked?: boolean
  /** Shown at the far right like Playground's status bar ("OXESpace 1.5.0"). */
  appVersion?: string
  /** Clean first-run mode ("Nothing set up yet" + version). */
  firstRun?: boolean
}

export function AppStatusBar({ activePaneId, workspace, usageProvider, rootPath, docked, appVersion, firstRun }: AppStatusBarProps): ReactElement {
  const activePane = workspace?.panes.find((pane) => pane.id === activePaneId) ?? null
  const profiles = useAgentStore((state) => state.allProfiles)
  // The usage shown follows the agent in use: Claude, Codex or Antigravity (directly or as a parent profile).
  const paneProvider = useMemo(() => {
    const profile = activePane?.agentProfileId ? profiles.find((value) => value.agentProfileId === activePane.agentProfileId) : undefined
    const providers = [profile?.provider, profile?.parentProvider]
    return USAGE_PROVIDERS.find(candidate => providers.includes(candidate)) ?? null
  }, [activePane?.agentProfileId, profiles])
  const provider = usageProvider === undefined ? paneProvider : usageProvider
  const path = rootPath ?? workspace?.rootPath ?? null
  const [settled, setSettled] = useState(false)
  useEffect(() => { if (firstRun) { setSettled(false); return } const id = window.setTimeout(() => setSettled(true), 250); return () => window.clearTimeout(id) }, [firstRun, path])
  const branchStatus = useGitBranch(workspace?.id ?? 'statusbar', path, Boolean(path && !firstRun && settled))
  const branchLabel = branchStatus?.branch ?? branchStatus?.shortSha ?? null
  const attention = useAttentionSummary()
  const workingCount = attention.code.working + attention.thread.working
  const versionLabel = `OXESpace ${appVersion && appVersion !== 'dev' ? appVersion : '1.5.0'}`

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
  if (firstRun) {
    return (
      <footer className={cx('app-statusbar', styles.bar, styles.docked)} aria-label={tc('workspace.status.bar')}>
        <div className={styles.group}>
          <span className={styles.item}>{i18n.t('statusBar.nothingSetUpYet')}</span>
        </div>
        <div className={styles.group}>
          <span className={styles.version}>{versionLabel}</span>
        </div>
      </footer>
    )
  }

  const folderFallback = path ? path.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? path : tc('workspace.status.noProject')

  return (
    <footer className={cx('app-statusbar', styles.bar, docked && styles.docked)} aria-label={tc('workspace.status.bar')}>
      <div className={styles.group}>
        {branchLabel ? (
          <span className={cx(styles.item, styles.strong)} title={path ?? tc('workspace.status.noProject')}>
            <GitBranch size={12} aria-hidden="true" />
            <strong className={styles.branchName}>{branchLabel}</strong>
          </span>
        ) : !workspace && !path ? (
          <span className={cx(styles.item, styles.strong)} title={tc('workspace.status.noProject')}>
            <FolderGit2 size={12} aria-hidden="true" />
            <span className={styles.path}>{folderFallback}</span>
          </span>
        ) : null}
        {/* The workspace's name is in OxeCode's workspace bar and the conversation's header: not repeated here (1.5.2). */}
        {!workspace && path ? (
          <span className={cx(styles.item, styles.hideNarrow)} title={path}>
            <span className={styles.path}>{folderFallback}</span>
          </span>
        ) : null}
        <span className={styles.item}>
          <span className={cx(styles.agentDot, workingCount > 0 && styles.agentDotLive)} aria-hidden="true" />
          <span>{i18n.t('statusBar.agentsWorking', { count: workingCount })}</span>
        </span>
      </div>
      <div className={styles.group}>
        {offline ? <span className={cx(styles.item, styles.offline)} role="status" title={i18n.t('ui.offline.message')} data-testid="offline-indicator"><WifiOff size={12} aria-hidden="true" />{i18n.t('ui.offline.title')}</span> : null}
        {settled ? <Suspense fallback={null}>
          {provider ? (
            <UsageStatus provider={provider} />
          ) : (
            <>
              {USAGE_PROVIDERS.map(each => <UsageStatus key={each} provider={each} />)}
            </>
          )}
        </Suspense> : null}
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
        <span className={styles.version}>{versionLabel}</span>
      </div>
    </footer>
  )
}
