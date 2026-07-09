import { Github, Zap, Server, Activity, Brain } from 'lucide-react'
import { useState, useEffect, useCallback, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import type { SemanticStatus } from '../../../shared/types/ipc'
import { useResolvedTerminalPrefs, useTerminalPrefsStore } from '../../store/terminal-prefs.store'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { useUpdaterStore } from '../../store/updater.store'

interface IntegrationsStatusChipsProps {
  workspace: Workspace
}

/**
 * Interactive Status Chips for integrations (GitHub, MCP, RTK, Caveman, Semantic).
 * Displayed in the top toolbar to give a glanceable health check of system services.
 */
export function IntegrationsStatusChips({ workspace }: IntegrationsStatusChipsProps): ReactElement {
  const terminalPrefs = useResolvedTerminalPrefs(workspace.id)
  const setOverride = useTerminalPrefsStore((s) => s.setOverride)
  const rtkActive = terminalPrefs.rtkHookEnabled
  const rtk = useUpdaterStore((s) => s.rtk)
  const cavemanActive = terminalPrefs.cavemanModeEnabled
  const semanticEnabled = terminalPrefs.semanticSearchEnabled

  const serversSelector = useCallback(selectMcpServers(workspace.id), [workspace.id])
  const servers = useMcpStore(serversSelector) || []
  const runningMcpServers = servers.filter((s) => s && s.health === 'healthy').length

  const [githubStatus, setGithubStatus] = useState<{ loggedIn: boolean; error?: string } | null>(null)
  const [builtInMcpRunning, setBuiltInMcpRunning] = useState(false)
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus | null>(null)

  useEffect(() => {
    let mounted = true
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

    // Initial check
    void checkStatus()

    // Periodic check
    const interval = setInterval(checkStatus, 15000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [workspace.rootPath, workspace.id])

  // Mirror the renderer-persisted preference into the main process so indexing
  // and the MCP tool honor it (the store is renderer-only; main needs telling).
  useEffect(() => {
    void window.oxe?.semantic
      ?.setEnabled({ workspaceId: workspace.id, enabled: semanticEnabled })
      .then((status) => setSemanticStatus(status))
      .catch(() => undefined)
  }, [workspace.id, semanticEnabled])

  const totalRunningMcp = runningMcpServers + (builtInMcpRunning ? 1 : 0)

  // Derive the Semantic chip's visual state + tooltip from enabled + worker health.
  let semanticClass = 'activity-idle'
  let semanticTitle = 'Cérebro Local (Busca Semântica): Desativado'
  if (semanticEnabled) {
    if (semanticStatus?.lastError) {
      semanticClass = 'activity-idle'
      semanticTitle = `Busca Semântica: erro — ${semanticStatus.lastError}`
    } else if (semanticStatus && (semanticStatus.indexing || !semanticStatus.workerReady)) {
      semanticClass = 'activity-awaiting'
      semanticTitle = semanticStatus.workerReady ? 'Busca Semântica: indexando…' : 'Busca Semântica: carregando modelo…'
    } else {
      semanticClass = 'activity-thinking'
      semanticTitle = `Busca Semântica: ativa (${semanticStatus?.count ?? 0} arquivos)`
    }
  }

  return (
    <div className="workspace-status-summary" role="status" aria-label="Integrations Status" style={{ marginRight: 8, gap: 6 }}>
      {/* GitHub Chip */}
      <span className={`workspace-status-chip ${githubStatus?.loggedIn ? 'activity-thinking' : 'activity-idle'}`} title={`GitHub: ${githubStatus?.loggedIn ? 'Connected' : 'Disconnected'}`}>
        <Github size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${githubStatus?.loggedIn ? 'activity-thinking' : 'activity-idle'}`} aria-hidden="true" />
        <span className="chip-label">GitHub</span>
      </span>

      {/* MCP Chip */}
      <span className={`workspace-status-chip ${totalRunningMcp > 0 ? 'activity-thinking' : 'activity-idle'}`} title={`MCP Servers: ${totalRunningMcp} running`}>
        <Server size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${totalRunningMcp > 0 ? 'activity-thinking' : 'activity-idle'}`} aria-hidden="true" />
        <span className="chip-label">{totalRunningMcp} MCP</span>
      </span>

      {/* RTK Chip */}
      <span
        className={`workspace-status-chip ${rtk.updateAvailable ? 'activity-awaiting' : rtkActive ? 'activity-thinking' : 'activity-idle'}`}
        title={
          rtk.updateAvailable
            ? `RTK: update ${rtk.latestVersion} available (installed ${rtk.version ?? 'legacy'}) — Settings → Updates`
            : `RTK: ${rtkActive ? 'Active' : 'Disabled'}${rtk.version ? ` · ${rtk.version}` : ''}`
        }
      >
        <Zap size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${rtk.updateAvailable ? 'activity-awaiting' : rtkActive ? 'activity-thinking' : 'activity-idle'}`} aria-hidden="true" />
        <span className="chip-label">RTK{rtk.updateAvailable ? ' ↑' : ''}</span>
      </span>

      {/* Caveman Chip — green when active, matching RTK/MCP (it's a plain on/off
          toggle with no runtime "awaiting" state, so amber was misleading). */}
      <span className={`workspace-status-chip ${cavemanActive ? 'activity-thinking' : 'activity-idle'}`} title={`Caveman Mode: ${cavemanActive ? 'Active' : 'Disabled'}`}>
        <Activity size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${cavemanActive ? 'activity-awaiting' : 'activity-idle'}`} aria-hidden="true" />
        <span className="chip-label">Caveman</span>
      </span>

      {/* Semantic Search Chip — clickable toggle with real status */}
      <button
        type="button"
        className={`workspace-status-chip ${semanticClass}`}
        title={`${semanticTitle} (clique para ${semanticEnabled ? 'desativar' : 'ativar'})`}
        onClick={() => setOverride(workspace.id, 'semanticSearchEnabled', !semanticEnabled)}
        style={{ cursor: 'pointer' }}
      >
        <Brain size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${semanticClass}`} aria-hidden="true" />
        <span className="chip-label">Semantic</span>
      </button>
    </div>
  )
}
