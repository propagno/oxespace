import { FolderTree, Play, Slash } from 'lucide-react'
import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useAgentStore } from '../../store/agent.store'
import { findMemberForPane, useIntegrationStore } from '../../store/integration.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { TerminalView } from '../Terminal/TerminalView'

interface TerminalPaneProps {
  pane: WorkspacePane
  workspaceId: string
  workspaceRootPath: string
  autoStart: boolean
}

export function TerminalPane({ autoStart, pane, workspaceId, workspaceRootPath }: TerminalPaneProps): ReactElement {
  const { getStatus, setStatus, consumePendingCommand } = useTerminalStore()
  const setLastIntent = useTerminalStore((s) => s.setLastIntent)
  const setPaneAgent = useWorkspaceStore((s) => s.setPaneAgent)
  const allProfiles = useAgentStore((s) => s.allProfiles)
  const state = getStatus(pane.id)
  const isRunning = state.status === 'running' || state.status === 'starting'
  const typedCommandRef = useRef('')
  const effectiveRootPath = pane.rootPath ?? workspaceRootPath
  // Shared cache via useGitBranch — replaces the previous local state +
  // per-pane setInterval(10s). Now N panes in the same workspace share one
  // IPC poll per rootPath, and the sidebar chip + this status bar always
  // read from the same source-of-truth.
  const branchStatus = useGitBranch(workspaceId, effectiveRootPath)

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

  /**
   * Async resolver that adds the integration context (if any) on top of the
   * agent's systemPrompt. Runs at `start`/`restart` time only — once the pane
   * is up, slash commands handle further injection. The integration check is
   * a synchronous store read; the IPC only fires when there's a member to
   * resolve, so panes outside any integration pay zero cost.
   */
  const resolveWithIntegrationContext = useCallback(async (): Promise<{ command: string | undefined; initialPrompt: string | undefined }> => {
    const base = resolveAgentInfo()
    const groups = useIntegrationStore.getState().groups
    const member = findMemberForPane(groups, workspaceId, pane.id)
    if (!member) return base
    try {
      const context = await useIntegrationStore.getState().buildContext(member.groupId, member.memberId)
      const prefix = `${context.text}\n\n---\n\n`
      return {
        ...base,
        initialPrompt: prefix + (base.initialPrompt ?? '')
      }
    } catch {
      // Build context failed (group deleted between mounts, IPC error, etc.)
      // — fall through to the base prompt rather than blocking the start.
      return base
    }
  }, [resolveAgentInfo, workspaceId, pane.id])

  const start = useCallback(async (): Promise<void> => {
    setStatus(pane.id, 'starting')
    try {
      const { command: agentCommand, initialPrompt } = await resolveWithIntegrationContext()
      const profile = inferAgentProfile(agentCommand ?? '', allProfiles)
      if (profile && profile.agentProfileId !== pane.agentProfileId) {
        void setPaneAgent(pane.id, profile.agentProfileId, { preserveSession: true })
      }
      await window.oxe.terminal.start({ paneId: pane.id, workspaceId, agentCommand, initialPrompt })
      setStatus(pane.id, 'running')
    } catch (error) {
      setStatus(pane.id, 'error', toMessage(error))
    }
  }, [allProfiles, pane.agentProfileId, pane.id, resolveWithIntegrationContext, setPaneAgent, setStatus, workspaceId])

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
        // Record what the user just sent so the pane header + sidebar row can
        // surface "the intent" instead of "Terminal N". When the typed command
        // matches a provider CLI (e.g. `claude`, `copilot`) treat it as setup
        // and re-bind the pane agent instead of treating the string itself as
        // an intent — typing "claude" to spawn the CLI isn't a task.
        const matchedProfile = inferAgentProfile(command, allProfiles)
        if (matchedProfile && matchedProfile.agentProfileId !== pane.agentProfileId) {
          void setPaneAgent(pane.id, matchedProfile.agentProfileId, { preserveSession: true })
        } else if (command) {
          setLastIntent(pane.id, command)
        }
        continue
      }
      if (char >= ' ' && char !== '\x1b') typedCommandRef.current += char
    }
  }, [allProfiles, pane.agentProfileId, pane.id, setPaneAgent, setLastIntent])

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
      const { command: agentCommand, initialPrompt } = await resolveWithIntegrationContext()
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
  }, [allProfiles, pane.agentProfileId, pane.id, resolveWithIntegrationContext, setPaneAgent, setStatus, workspaceId])

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
  const openWorktreeMenu = useUIStore((s) => s.openWorktreeMenu)
  // Compose the chip label from the branch hook's payload. Beyond "branch
  // name / detached SHA", the label now also surfaces the *specific* reason
  // when git couldn't read the ref — previously it just said "no branch"
  // even when git itself was missing or the path wasn't a repo, which sent
  // the user looking in the wrong place. Each short label maps to a real
  // failure mode of `git.service.getBranch`.
  const fallbackWorktreeLabel = isWorktreePath(effectiveRootPath)
    ? deriveWorktreeLabel(effectiveRootPath)
    : 'no branch'
  const branchErrorReason = branchStatus?.error ?? null
  const worktreeLabel = !branchStatus
    ? 'branch…'
    : branchStatus.branch
      ? branchStatus.branch
      : branchStatus.shortSha
        ? `detached ${branchStatus.shortSha}`
        : summarizeBranchError(branchErrorReason, fallbackWorktreeLabel)
  const isWorktreeOverride = pane.rootPath !== null

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

        <button
          type="button"
          className={`statusbar-chip worktree-chip${isWorktreeOverride ? ' overridden' : ''}${branchErrorReason ? ' branch-error' : ''}`}
          aria-label={`Worktree: ${worktreeLabel}. Click to manage.`}
          title={branchErrorReason
            ? `Branch could not be read: ${branchErrorReason} (${effectiveRootPath})`
            : `Branch/worktree: ${worktreeLabel} (${effectiveRootPath})`}
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

/**
 * Maps `git.service.getBranch` failure reasons to short labels that fit in
 * the statusbar chip (≤ ~14 chars). Each branch is keyed off the actual
 * error string returned by the service so the visible label tells the user
 * what to fix, not just "no branch".
 *
 * Keep these strings synchronized with the messages produced by
 * `electron/main/services/git.service.ts`.
 */
function summarizeBranchError(error: string | null, fallback: string): string {
  if (!error) return fallback
  const lower = error.toLowerCase()
  if (lower.includes('git executable not found')) return 'git not found'
  if (lower.includes('not inside a git work tree')) return 'not a git repo'
  if (lower.includes('git ipc not available')) return 'git ipc off'
  if (lower.includes('timed out')) return 'git timed out'
  if (lower.includes('permission denied')) return 'git denied'
  return 'branch error'
}

function isWorktreePath(path: string): boolean {
  return /[\\/]worktrees[\\/]/i.test(path)
}

function deriveWorktreeLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const idx = parts.findIndex((part) => part.toLowerCase() === 'worktrees')
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : parts.at(-1) ?? 'worktree'
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terminal error'
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
