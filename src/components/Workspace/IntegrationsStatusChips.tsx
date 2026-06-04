import { Github, Zap, Server, Activity } from 'lucide-react'
import { useState, useEffect, useCallback, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useResolvedTerminalPrefs } from '../../store/terminal-prefs.store'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'

interface IntegrationsStatusChipsProps {
  workspace: Workspace
}

/**
 * Interactive Status Chips for integrations (GitHub, MCP, RTK, Caveman).
 * Displayed in the top toolbar to give a glanceable health check of system services.
 */
export function IntegrationsStatusChips({ workspace }: IntegrationsStatusChipsProps): ReactElement {
  const terminalPrefs = useResolvedTerminalPrefs(workspace.id)
  const rtkActive = terminalPrefs.rtkHookEnabled
  const cavemanActive = terminalPrefs.cavemanModeEnabled

  const serversSelector = useCallback(selectMcpServers(workspace.id), [workspace.id])
  const servers = useMcpStore(serversSelector) || []
  const runningMcpServers = servers.filter((s) => s && s.status === 'running').length

  const [githubStatus, setGithubStatus] = useState<{ loggedIn: boolean; error?: string } | null>(null)
  const [builtInMcpRunning, setBuiltInMcpRunning] = useState(false)

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

  const totalRunningMcp = runningMcpServers + (builtInMcpRunning ? 1 : 0)

  return (
    <div className="workspace-status-summary" role="status" aria-label="Integrations Status" style={{ marginRight: 8, gap: 6 }}>
      {/* GitHub Chip */}
      <span className={`workspace-status-chip ${githubStatus?.loggedIn ? 'activity-thinking' : 'activity-idle'}`} title={`GitHub: ${githubStatus?.loggedIn ? 'Connected' : 'Disconnected'}`}>
        <Github size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${githubStatus?.loggedIn ? 'activity-thinking' : 'activity-idle'}`} aria-hidden="true" />
        GitHub
      </span>

      {/* MCP Chip */}
      <span className={`workspace-status-chip ${totalRunningMcp > 0 ? 'activity-thinking' : 'activity-idle'}`} title={`MCP Servers: ${totalRunningMcp} running`}>
        <Server size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${totalRunningMcp > 0 ? 'activity-thinking' : 'activity-idle'}`} aria-hidden="true" />
        {totalRunningMcp} MCP
      </span>

      {/* RTK Chip */}
      <span className={`workspace-status-chip ${rtkActive ? 'activity-thinking' : 'activity-idle'}`} title={`RTK: ${rtkActive ? 'Active' : 'Disabled'}`}>
        <Zap size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${rtkActive ? 'activity-thinking' : 'activity-idle'}`} aria-hidden="true" />
        RTK
      </span>
      
      {/* Caveman Chip */}
      <span className={`workspace-status-chip ${cavemanActive ? 'activity-awaiting' : 'activity-idle'}`} title={`Caveman Mode: ${cavemanActive ? 'Active' : 'Disabled'}`}>
        <Activity size={11} aria-hidden="true" style={{ marginRight: 2 }} />
        <span className={`workspace-status-dot ${cavemanActive ? 'activity-awaiting' : 'activity-idle'}`} aria-hidden="true" />
        Caveman
      </span>
    </div>
  )
}
