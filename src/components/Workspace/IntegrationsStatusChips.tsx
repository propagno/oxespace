import { Server, Activity, ChevronDown } from 'lucide-react'
import { Github } from '../Brand/GithubIcon'
import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useResolvedTerminalPrefs } from '../../store/terminal-prefs.store'
import { selectMcpServers, useMcpStore } from '../../store/mcp.store'
import { humanizeError } from '../../utils/humanizeError'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface IntegrationsStatusChipsProps {
  workspace: Workspace
  isActive?: boolean
}

/**
 * Interactive Status Chips for integrations (GitHub, MCP, Caveman).
 * Displayed in the top toolbar to give a glanceable health check of system services.
 */
export function IntegrationsStatusChips({ workspace, isActive = true }: IntegrationsStatusChipsProps): ReactElement {
  const terminalPrefs = useResolvedTerminalPrefs(workspace.id)
  const cavemanActive = terminalPrefs.cavemanModeEnabled

  const serversSelector = useCallback(selectMcpServers(workspace.id), [workspace.id])
  const servers = useMcpStore(serversSelector) || []
  // Agents run the servers themselves, so what counts is how many they are given (the built-in one is counted apart).
  const runningMcpServers = servers.filter((s) => s && s.enabled && s.trusted && !(s.workspaceId === null && s.name === 'oxespace')).length

  const [githubStatus, setGithubStatus] = useState<{ loggedIn: boolean; error?: string } | null>(null)
  const [builtInMcpRunning, setBuiltInMcpRunning] = useState(false)
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
    }

    // Keep process-spawning GitHub checks and MCP IPC away from the
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

  const totalRunningMcp = runningMcpServers + (builtInMcpRunning ? 1 : 0)

  const activeCount = Number(githubStatus?.loggedIn === true) + Number(totalRunningMcp > 0) + Number(cavemanActive)
  const overallTone = activeCount > 0 ? 'healthy' : 'idle'
  const countText = `${activeCount}/3`

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
          <IntegrationRow icon={<Activity size={14} />} label="Caveman" detail={cavemanActive ? tc('workspace.systems.on') : tc('workspace.systems.off')} active={cavemanActive} />
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
