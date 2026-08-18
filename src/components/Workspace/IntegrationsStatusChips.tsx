import { Github, Zap, Server, Activity, Brain, ChevronDown } from 'lucide-react'
import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import type { SemanticStatus } from '../../../shared/types/ipc'
import { useResolvedTerminalPrefs, useTerminalPrefsStore } from '../../store/terminal-prefs.store'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { useUpdaterStore } from '../../store/updater.store'

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
  const runningMcpServers = servers.filter((s) => s && s.health === 'healthy').length

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
          setGithubStatus({ loggedIn: false, error: err instanceof Error ? err.message : String(err) })
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

  // Derive the Semantic chip's visual state + tooltip from enabled + worker health.
  const modelHint = semanticStatus?.modelId ?? 'multilingual-e5-base'
  let semanticClass = 'activity-idle'
  let semanticTitle = `Semantic search: off · model ${modelHint}`
  if (semanticEnabled) {
    if (semanticStatus?.lastError) {
      semanticClass = 'activity-idle'
      semanticTitle = `Semantic: error — ${semanticStatus.lastError}`
    } else if (semanticStatus && (semanticStatus.indexing || !semanticStatus.workerReady)) {
      semanticClass = 'activity-awaiting'
      semanticTitle = semanticStatus.workerReady
        ? `Semantic: indexing… (${semanticStatus.count} files) · ${modelHint}`
        : `Semantic: loading model… · ${modelHint}`
    } else {
      semanticClass = 'activity-thinking'
      const n = semanticStatus?.count ?? 0
      semanticTitle = n === 0
        ? `Semantic: ready · empty index · ${modelHint}`
        : `Semantic: ready · ${n} files · ${semanticStatus?.mode ?? semanticMode} mode · ${semanticStatus?.coverage?.byCategory.test ?? 0} tests · ${semanticStatus?.coverage?.byCategory.config ?? 0} config · ${modelHint}`
    }
  }

  const semanticHealthy = semanticEnabled && !semanticStatus?.lastError
  const activeCount = Number(githubStatus?.loggedIn === true) + Number(totalRunningMcp > 0) + Number(rtkActive) + Number(cavemanActive) + Number(semanticHealthy)
  const attentionCount = Number(rtk.updateAvailable) + Number(Boolean(semanticStatus?.lastError))
  const overallTone = attentionCount > 0 ? 'attention' : activeCount > 0 ? 'healthy' : 'idle'

  return (
    <div className="workspace-integrations" ref={menuRef}>
      <button
        type="button"
        className={`workspace-integrations-trigger tone-${overallTone}`}
        aria-label="Open integration status"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        data-testid="workspace-integrations-trigger"
      >
        <Server size={12} aria-hidden="true" />
        <span className={`workspace-integrations-health tone-${overallTone}`} aria-hidden="true" />
        <span className="workspace-integrations-label">Systems</span>
        <span className="workspace-integrations-count">{attentionCount > 0 ? `${attentionCount} alert${attentionCount === 1 ? '' : 's'}` : `${activeCount}/5`}</span>
        <ChevronDown size={11} className="workspace-integrations-chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="workspace-integrations-menu" role="menu" aria-label="Integration status" data-testid="workspace-integrations-menu">
          <div className="workspace-integrations-menu-header">
            <strong>Systems</strong>
            <span>{activeCount} active</span>
          </div>

          <IntegrationRow icon={<Github size={13} />} label="GitHub" detail={githubStatus?.loggedIn ? 'Connected' : githubStatus ? 'Disconnected' : 'Checking…'} active={githubStatus?.loggedIn === true} />
          <IntegrationRow icon={<Server size={13} />} label="MCP" detail={`${totalRunningMcp} running`} active={totalRunningMcp > 0} />
          <IntegrationRow
            icon={<Zap size={13} />}
            label="RTK"
            detail={rtk.updateAvailable ? `Update ${rtk.latestVersion} available` : rtkActive ? `Active${rtk.version ? ` · ${rtk.version}` : ''}` : 'Disabled'}
            active={rtkActive}
            attention={rtk.updateAvailable}
          />
          <IntegrationRow icon={<Activity size={13} />} label="Caveman" detail={cavemanActive ? 'Active' : 'Disabled'} active={cavemanActive} />

          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={semanticEnabled}
            className="workspace-integrations-row is-action"
            title={`${semanticTitle} (click to ${semanticEnabled ? 'disable' : 'enable'})`}
            onClick={() => setOverride(workspace.id, 'semanticSearchEnabled', !semanticEnabled)}
            data-testid="chip-semantic"
          >
            <span className="workspace-integrations-row-icon"><Brain size={13} aria-hidden="true" /></span>
            <span className="workspace-integrations-row-copy">
              <strong>Semantic</strong>
              <span>{semanticEnabled && semanticStatus?.indexing ? 'Indexing…' : semanticEnabled ? (semanticStatus?.lastError ? 'Needs attention' : `${semanticStatus?.count ?? 0} files`) : 'Disabled'}</span>
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
