import { Zap, Server, Activity, Brain, ChevronDown } from 'lucide-react'
import { Github } from '../Brand/GithubIcon'
import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import type { SemanticStatus } from '../../../shared/types/ipc'
import { summarizeSemanticStatus } from '../Semantic/semanticStatusSummary'
import { useResolvedTerminalPrefs, useTerminalPrefsStore } from '../../store/terminal-prefs.store'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { useUpdaterStore } from '../../store/updater.store'
import { humanizeError } from '../../utils/humanizeError'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface IntegrationsStatusChipsProps {
  workspace: Workspace
  isActive?: boolean
}

/**
 * Interactive Status Chips for integrations (GitHub, MCP, RTK, Caveman, Semantic).
 * Displayed in the top toolbar to give a glanceable health check of system services.
 */
export function IntegrationsStatusChips({ workspace, isActive = true }: IntegrationsStatusChipsProps): ReactElement {
  const terminalPrefs = useResolvedTerminalPrefs(workspace.id)
  const setOverride = useTerminalPrefsStore((s) => s.setOverride)
  const rtkActive = terminalPrefs.rtkHookEnabled
  const rtk = useUpdaterStore((s) => s.rtk)
  const cavemanActive = terminalPrefs.cavemanModeEnabled
  const semanticEnabled = terminalPrefs.semanticSearchEnabled
  const semanticMode = terminalPrefs.semanticSearchMode

  const serversSelector = useCallback(selectMcpServers(workspace.id), [workspace.id])
  const servers = useMcpStore(serversSelector) || []
  // Agents run the servers themselves, so what counts is how many they are given (the built-in one is counted apart).
  const runningMcpServers = servers.filter((s) => s && s.enabled && s.trusted && !(s.workspaceId === null && s.name === 'oxespace')).length

  const [githubStatus, setGithubStatus] = useState<{ loggedIn: boolean; error?: string } | null>(null)
  const [builtInMcpRunning, setBuiltInMcpRunning] = useState(false)
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus | null>(null)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!isActive) return
    let mounted = true
    let interval: ReturnType<typeof setInterval> | null = null
    const checkStatus = async () => {
      // Check GitHub
      try {
        const result = await window.oxe.github.getCliStatus({ workspaceId: workspace.id, rootPath: workspace.rootPath })
        if (mounted) {
          setGithubStatus({ loggedIn: result.authenticated })
        }
      } catch (err) {
        if (mounted) {
          setGithubStatus({ loggedIn: false, error: humanizeError(err) })
        }
      }

      // Check Built-in MCP
      try {
        const mcpStatus = await window.oxe.mcpInternal.getStatus()
        if (mounted) {
          setBuiltInMcpRunning(mcpStatus.running)
        }
      } catch (err) {
        if (mounted) {
          setBuiltInMcpRunning(false)
        }
      }

      // Check Semantic search service
      try {
        const sem = await window.oxe?.semantic?.getStatus(workspace.id)
        if (mounted) setSemanticStatus(sem ?? null)
      } catch {
        if (mounted) setSemanticStatus(null)
      }
    }

    // Keep process-spawning GitHub checks and semantic/MCP IPC away from the
    // workspace visibility swap. Cached status remains visible meanwhile.
    const initialTimer = setTimeout(() => {
      void checkStatus()
      interval = setInterval(checkStatus, 15000)
    }, 350)
    return () => {
      mounted = false
      clearTimeout(initialTimer)
      if (interval) clearInterval(interval)
    }
  }, [isActive, workspace.rootPath, workspace.id])

  // Mirror the renderer-persisted preference into the main process so indexing
  // and the MCP tool honor it (the store is renderer-only; main needs telling).
  useEffect(() => {
    if (!isActive) return
    const timer = setTimeout(() => {
      void window.oxe?.semantic
        ?.setEnabled({ workspaceId: workspace.id, enabled: semanticEnabled })
        .then((status) => setSemanticStatus(status))
        .catch(() => undefined)
    }, 350)
    return () => clearTimeout(timer)
  }, [isActive, workspace.id, semanticEnabled])

  useEffect(() => {
    if (!isActive) return
    const timer = setTimeout(() => {
      void window.oxe?.semantic?.setMode({ workspaceId: workspace.id, mode: semanticMode }).catch(() => undefined)
    }, 350)
    return () => clearTimeout(timer)
  }, [isActive, workspace.id, semanticMode])

  const totalRunningMcp = runningMcpServers + (builtInMcpRunning ? 1 : 0)

  // Derive the Semantic chip's visual state + tooltip. Exact-term search needs no
  // model; the optional vector index only adds a note while it loads.
  const semanticSummary = summarizeSemanticStatus(semanticStatus, semanticEnabled)
  const semanticClass = semanticSummary.tone === 'ready' ? 'activity-thinking' : semanticSummary.tone === 'busy' ? 'activity-awaiting' : 'activity-idle'
  const semanticTitle = semanticSummary.tone === 'off'
    ? tc('workspace.systems.semanticOff')
    : tc('workspace.systems.semanticTitle', { label: semanticSummary.label }) + (semanticSummary.tone === 'ready' ? ` · ${tc('workspace.systems.mode', { mode: semanticStatus?.mode ?? semanticMode })}` : '')

  const semanticHealthy = semanticEnabled && !semanticStatus?.lastError
  const activeCount = Number(githubStatus?.loggedIn === true) + Number(totalRunningMcp > 0) + Number(rtkActive) + Number(cavemanActive) + Number(semanticHealthy)
  const attentionCount = Number(rtk.updateAvailable) + Number(Boolean(semanticStatus?.lastError))
  const overallTone = attentionCount > 0 ? 'attention' : activeCount > 0 ? 'healthy' : 'idle'
  const countText = attentionCount > 0 ? tc('workspace.systems.alerts', { count: attentionCount }) : `${activeCount}/5`

  return (
    <div className="workspace-integrations" ref={menuRef}>
      <button
        type="button"
        className={`workspace-integrations-trigger tone-${overallTone}`}
        aria-label={tc('workspace.systems.triggerLabel', { count: countText })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="workspace-integrations-trigger"
      >
        <Server size={12} aria-hidden="true" />
        <span className={`workspace-integrations-health tone-${overallTone}`} aria-hidden="true" />
        <span className="workspace-integrations-label">{`${tc('workspace.systems.title')} `}</span>
        <span className="workspace-integrations-count">{countText}</span>
        <ChevronDown size={12} className="workspace-integrations-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="workspace-integrations-menu" role="menu" aria-label={tc('workspace.systems.label')} data-testid="workspace-integrations-menu">
          <div className="workspace-integrations-menu-header">
            <strong>{tc('workspace.systems.title')}</strong>
            <span>{tc('workspace.systems.active', { count: activeCount })}</span>
          </div>

          <IntegrationRow icon={<Github size={14} />} label="GitHub" detail={githubStatus?.loggedIn ? tc('github.settings.connected') : githubStatus ? tc('workspace.systems.disconnected') : tc('workspace.systems.checking')} active={githubStatus?.loggedIn === true} />
          <IntegrationRow icon={<Server size={14} />} label="MCP" detail={tc('workspace.systems.mcp', { count: totalRunningMcp })} active={totalRunningMcp > 0} />
          <IntegrationRow
            icon={<Zap size={14} />}
            label="RTK"
            detail={rtk.updateAvailable ? tc('workspace.systems.update', { version: rtk.latestVersion }) : rtkActive ? `${tc('workspace.systems.on')}${rtk.version ? ` · ${rtk.version}` : ''}` : tc('workspace.systems.off')}
            active={rtkActive}
            attention={rtk.updateAvailable}
          />
          <IntegrationRow icon={<Activity size={14} />} label="Caveman" detail={cavemanActive ? tc('workspace.systems.on') : tc('workspace.systems.off')} active={cavemanActive} />

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={semanticEnabled}
            className="workspace-integrations-row is-action"
            title={`${semanticTitle} (${semanticEnabled ? tc('workspace.systems.clickOff') : tc('workspace.systems.clickOn')})`}
            onClick={() => setOverride(workspace.id, 'semanticSearchEnabled', !semanticEnabled)}
            data-testid="chip-semantic"
          >
            <span className="workspace-integrations-row-icon"><Brain size={14} aria-hidden="true" /></span>
            <span className="workspace-integrations-row-copy">
              <strong>{tc('workspace.systems.semantic')}</strong>
              <span>{semanticEnabled && semanticStatus?.indexing ? tc('workspace.systems.indexing') : semanticEnabled ? (semanticStatus?.lastError ? tc('pane.status.error') : tc('github.status.files', { count: semanticStatus?.count ?? 0 })) : tc('workspace.systems.off')}</span>
            </span>
            <span className={`workspace-integrations-row-dot ${semanticClass}`} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function IntegrationRow({ active, attention = false, detail, icon, label }: {
  active: boolean
  attention?: boolean
  detail: string
  icon: ReactElement
  label: string
}): ReactElement {
  return (
    <div className="workspace-integrations-row" role="menuitem" aria-disabled="true">
      <span className="workspace-integrations-row-icon" aria-hidden="true">{icon}</span>
      <span className="workspace-integrations-row-copy">
        <strong>{label}</strong>
        <span>{detail}</span>
      </span>
      <span className={`workspace-integrations-row-dot ${attention ? 'activity-awaiting' : active ? 'activity-thinking' : 'activity-idle'}`} aria-hidden="true" />
    </div>
  )
}
