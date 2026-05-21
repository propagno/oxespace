import { Activity, FolderTree, Play, Slash } from 'lucide-react'
import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useAgentStore } from '../../store/agent.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useUIStore } from '../../store/ui.store'
import { selectContextUsage, useUsageStore } from '../../store/usage.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { TerminalView } from '../Terminal/TerminalView'

interface TerminalPaneProps {
  pane: WorkspacePane
  workspaceId: string
  autoStart: boolean
}

export function TerminalPane({ autoStart, pane, workspaceId }: TerminalPaneProps): ReactElement {
  const { getStatus, setStatus, consumePendingCommand } = useTerminalStore()
  const setPaneAgent = useWorkspaceStore((s) => s.setPaneAgent)
  const allProfiles = useAgentStore((s) => s.allProfiles)
  const state = getStatus(pane.id)
  const isRunning = state.status === 'running' || state.status === 'starting'
  const typedCommandRef = useRef('')

  const resolveAgentInfo = useCallback((): { command: string | undefined; initialPrompt: string | undefined } => {
    const pending = consumePendingCommand(pane.id)
    if (pending) return { command: pending, initialPrompt: undefined }
    if (!pane.agentProfileId) return { command: undefined, initialPrompt: undefined }
    const profile = allProfiles.find((p) => p.agentProfileId === pane.agentProfileId)
    if (!profile) return { command: undefined, initialPrompt: undefined }
    if (profile.parentProvider) {
      const parent = allProfiles.find((p) => p.provider === profile.parentProvider)
      return { command: parent?.command, initialPrompt: profile.systemPrompt }
    }
    return { command: profile.command, initialPrompt: undefined }
  }, [consumePendingCommand, pane.id, pane.agentProfileId, allProfiles])

  const start = useCallback(async (): Promise<void> => {
    setStatus(pane.id, 'starting')
    try {
      const { command: agentCommand, initialPrompt } = resolveAgentInfo()
      const profile = inferAgentProfile(agentCommand ?? '', allProfiles)
      if (profile && profile.agentProfileId !== pane.agentProfileId) {
        void setPaneAgent(pane.id, profile.agentProfileId, { preserveSession: true })
      }
      await window.oxe.terminal.start({ paneId: pane.id, workspaceId, agentCommand, initialPrompt })
      setStatus(pane.id, 'running')
    } catch (error) {
      setStatus(pane.id, 'error', toMessage(error))
    }
  }, [allProfiles, pane.agentProfileId, pane.id, resolveAgentInfo, setPaneAgent, setStatus, workspaceId])

  const identifyAgentFromInput = useCallback((data: string): void => {
    for (const char of data) {
      if (char === '\u0003') {
        typedCommandRef.current = ''
        continue
      }
      if (char === '\b' || char === '\x7f') {
        typedCommandRef.current = typedCommandRef.current.slice(0, -1)
        continue
      }
      if (char === '\r' || char === '\n') {
        const command = typedCommandRef.current.trim()
        typedCommandRef.current = ''
        const profile = inferAgentProfile(command, allProfiles)
        if (profile && profile.agentProfileId !== pane.agentProfileId) {
          void setPaneAgent(pane.id, profile.agentProfileId, { preserveSession: true })
        }
        continue
      }
      if (char >= ' ' && char !== '\x1b') typedCommandRef.current += char
    }
  }, [allProfiles, pane.agentProfileId, pane.id, setPaneAgent])

  useEffect(() => {
    if (!autoStart || state.status !== 'idle') return
    // Restore-time race: workspaces hydrate before agent profiles. If this pane
    // has an agent binding persisted but profiles aren't loaded yet,
    // resolveAgentInfo() returns no command and terminal.service falls back to
    // shell_profile_id — which on the first pane is 'builtin-claude' and ends
    // up launching Claude instead of the persisted Copilot/Codex/etc. Wait for
    // profiles before auto-starting bound panes.
    if (pane.agentProfileId && allProfiles.length === 0) return
    void start()
  }, [autoStart, start, state.status, pane.agentProfileId, allProfiles.length])

  const stop = async (): Promise<void> => {
    await window.oxe.terminal.stop({ paneId: pane.id })
    setStatus(pane.id, 'idle')
  }

  const restart = useCallback(async (): Promise<void> => {
    setStatus(pane.id, 'starting')
    try {
      const { command: agentCommand, initialPrompt } = resolveAgentInfo()
      const profile = inferAgentProfile(agentCommand ?? '', allProfiles)
      if (profile && profile.agentProfileId !== pane.agentProfileId) {
        void setPaneAgent(pane.id, profile.agentProfileId, { preserveSession: true })
      }
      await window.oxe.terminal.stop({ paneId: pane.id })
      await window.oxe.terminal.start({ paneId: pane.id, workspaceId, agentCommand, initialPrompt })
      setStatus(pane.id, 'running')
    } catch (error) {
      setStatus(pane.id, 'error', toMessage(error))
    }
  }, [allProfiles, pane.agentProfileId, pane.id, resolveAgentInfo, setPaneAgent, setStatus, workspaceId])

  useEffect(() => {
    const handler = (e: Event): void => {
      const { paneId: targetId } = (e as CustomEvent<{ paneId: string }>).detail
      if (targetId !== pane.id) return

      const s = getStatus(pane.id).status
      if (s === 'running' || s === 'starting') return

      void start()
    }
    window.addEventListener('oxe:start-pane', handler)
    return () => window.removeEventListener('oxe:start-pane', handler)
  }, [pane.id, getStatus, start])

  const statusDotClass = state.status === 'running' ? 'green'
    : state.status === 'starting' ? 'yellow'
    : state.status === 'error' ? 'red'
    : ''

  const openSlashOverlay = useUIStore((s) => s.openSlashOverlay)
  const openContextUsage = useUIStore((s) => s.openContextUsage)
  const openWorktreeMenu = useUIStore((s) => s.openWorktreeMenu)
  const worktreeLabel = pane.rootPath ? deriveWorktreeLabel(pane.rootPath) : 'main'
  const isWorktreeOverride = pane.rootPath !== null

  const paneProfile = pane.agentProfileId ? allProfiles.find((p) => p.agentProfileId === pane.agentProfileId) : null
  const paneProvider = paneProfile?.parentProvider ?? paneProfile?.provider ?? null

  // Context usage is per (workspace, provider) — keyed so two panes with different agents
  // in the same workspace don't share token counts.
  const usageSelector = useCallback(selectContextUsage(workspaceId, paneProvider), [workspaceId, paneProvider])
  const usage = useUsageStore(usageSelector)
  const supportedProviders = useUsageStore((s) => s.supportedProviders)
  // Context usage is intentionally gated to Claude panes only — other providers'
  // session logs are read-only stubs and would surface misleading numbers.
  const providerSupportsUsage = paneProvider === 'claude' && supportedProviders.includes(paneProvider)
  const showsUsageChip = providerSupportsUsage && usage.available
  // Context % is based on the LAST turn (current window), not cumulative session totals.
  const currentContextTokens = usage.lastTurnInputTokens + usage.lastTurnCacheCreationTokens + usage.lastTurnCacheReadTokens + usage.lastTurnOutputTokens
  const usagePct = usage.contextLimit
    ? Math.min(100, Math.round((currentContextTokens / usage.contextLimit) * 100))
    : 0

  // Polling for usage happens at the workspace level (see WorkspaceSurface).

  return (
    <div className="terminal-pane" data-testid="terminal-pane">
      {state.error ? <div className="terminal-error-bar">{state.error}</div> : null}

      {isRunning ? (
        <div className="terminal-content">
          <TerminalView
            paneId={pane.id}
            isRunning={isRunning}
            onInput={(data) => {
              if (!isRunning) return
              identifyAgentFromInput(data)
              void window.oxe.terminal.write({ paneId: pane.id, data })
            }}
            onResize={(cols, rows) => {
              if (isRunning) void window.oxe.terminal.resize({ paneId: pane.id, cols, rows })
            }}
            onExit={(exitCode) => {
              setStatus(pane.id, 'exited', exitCode === null ? undefined : `Exited with code ${exitCode}`)
            }}
          />
        </div>
      ) : (
        <div className="terminal-idle">
          <button
            type="button"
            className="btn-start-terminal"
            aria-label="Start terminal"
            onClick={() => void start()}
            disabled={state.status === 'starting'}
          >
            <Play size={14} aria-hidden="true" />
            {state.status === 'starting' ? 'Starting…' : 'Start Terminal'}
          </button>
        </div>
      )}

      <div className="terminal-statusbar">
        <span className={`statusbar-dot ${statusDotClass}`} aria-hidden="true" />
        <span className="statusbar-text">{state.status}</span>

        <div className="terminal-statusbar-spacer" />

        {showsUsageChip ? (
          <button
            type="button"
            className={`statusbar-chip usage-chip${usagePct > 80 ? ' danger' : usagePct > 60 ? ' warning' : ''}`}
            aria-label={`Context: ${usagePct}% used. ${usage.requestCount} requests, ~$${usage.estimatedCostUsd.toFixed(2)}.`}
            title={`Current context: ${formatStatusbarTokens(currentContextTokens)} / ${formatStatusbarTokens(usage.contextLimit ?? 0)} · Session: ~$${usage.estimatedCostUsd.toFixed(2)} (API-equiv)`}
            onClick={() => openContextUsage(pane.id)}
          >
            <Activity size={10} aria-hidden="true" />
            <span>{usagePct}%</span>
            <span className="usage-chip-divider" aria-hidden="true">·</span>
            <span>${usage.estimatedCostUsd.toFixed(2)}</span>
          </button>
        ) : null}

        <button
          type="button"
          className={`statusbar-chip worktree-chip${isWorktreeOverride ? ' overridden' : ''}`}
          aria-label={`Worktree: ${worktreeLabel}. Clique para gerenciar.`}
          title={`Worktree: ${worktreeLabel}${pane.rootPath ? ` (${pane.rootPath})` : ''}`}
          onClick={() => openWorktreeMenu(pane.id)}
        >
          <FolderTree size={10} aria-hidden="true" />
          <span>{worktreeLabel}</span>
        </button>

        <button
          type="button"
          className="statusbar-chip slash-chip"
          aria-label="Abrir comandos (Ctrl+/)"
          title="Comandos (Ctrl+/)"
          onClick={() => openSlashOverlay(pane.id)}
        >
          <Slash size={10} aria-hidden="true" />
          <span>commands</span>
        </button>

        {isRunning ? (
          <button
            type="button"
            className="statusbar-action"
            aria-label="Stop terminal"
            onClick={() => void stop()}
          >
            stop
          </button>
        ) : state.status === 'exited' ? (
          <button
            type="button"
            className="statusbar-action"
            aria-label="Restart terminal"
            onClick={() => void restart()}
          >
            restart
          </button>
        ) : null}
      </div>
    </div>
  )
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terminal error'
}

function formatStatusbarTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toString()
}

function deriveWorktreeLabel(rootPath: string): string {
  // Show just the final directory segment (e.g. "oxespace-feat-x" → "feat-x" if prefix matches)
  const segments = rootPath.split(/[\\/]/).filter(Boolean)
  return segments[segments.length - 1] ?? rootPath
}

function inferAgentProfile(command: string, profiles: AgentProfile[]): AgentProfile | null {
  if (!command) return null
  const match = command.match(/^(?:&\s*)?(?:"([^"]+)"|'([^']+)'|([^\s]+))/)
  const first = match?.[1] ?? match?.[2] ?? match?.[3]
    ?? ''
  const normalized = first.replace(/\\/g, '/').split('/').pop()?.replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase()
  if (!normalized) return null

  return profiles.find((profile) => {
    const profileCommand = profile.command.trim().split(/\s+/)[0]
    const profileExecutable = profileCommand.replace(/\\/g, '/').split('/').pop()?.replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase()
    return profileExecutable === normalized || profile.provider === normalized || profile.parentProvider === normalized
  }) ?? null
}
