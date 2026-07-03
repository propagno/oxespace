import { Eraser, FolderTree, Mic, MicOff, Play, Bone, Brain, RotateCcw, Search, Terminal as TerminalIcon, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { WorkspacePane } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { useOxeVoice } from '../../hooks/useOxeVoice'
import { useAgentStore } from '../../store/agent.store'
import { findMemberForPane, useIntegrationStore } from '../../store/integration.store'

import { useTerminalStore } from '../../store/terminal.store'
import { useUIStore } from '../../store/ui.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useResolvedTerminalPrefs, useTerminalPrefsStore } from '../../store/terminal-prefs.store'
import { TerminalView } from '../Terminal/TerminalView'
import { CopilotCreditsStatus } from '../Terminal/CopilotCreditsStatus'
import { AgentCreditsStatus } from '../Terminal/AgentCreditsStatus'
import { ContextUsageStatus } from '../Terminal/ContextUsageStatus'
import { ErrorBoundary } from '../common/ErrorBoundary'

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
  const workspaceThemeId = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.themeId ?? 'dracula')
  const setTerminalOverride = useTerminalPrefsStore((s) => s.setOverride)
  const terminalPrefs = useResolvedTerminalPrefs(workspaceId)
  const state = getStatus(pane.id)
  const isRunning = state.status === 'running' || state.status === 'starting'
  const canUseVoice = state.status === 'running'
  // Copilot panes get the account-wide AI-Credits indicator in their status bar.
  const isCopilotPane = useMemo(() => {
    const profile = allProfiles.find((p) => p.agentProfileId === pane.agentProfileId)
    const providers = [profile?.provider, profile?.parentProvider]
    return providers.includes('copilot') || providers.includes('gh-copilot')
  }, [allProfiles, pane.agentProfileId])
  // Claude/Codex panes get the equivalent per-provider quota chip (weekly usage).
  const agentCreditsProvider = useMemo(() => {
    const profile = allProfiles.find((p) => p.agentProfileId === pane.agentProfileId)
    const providers = [profile?.provider, profile?.parentProvider]
    if (providers.includes('claude')) return 'claude' as const
    if (providers.includes('codex')) return 'codex' as const
    return null
  }, [allProfiles, pane.agentProfileId])
  // Live context-window % (/context meter) — providers that expose token data.
  const contextProvider = useMemo(() => {
    const profile = allProfiles.find((p) => p.agentProfileId === pane.agentProfileId)
    const providers = [profile?.provider, profile?.parentProvider]
    if (providers.includes('claude')) return 'claude' as const
    if (providers.includes('codex')) return 'codex' as const
    if (providers.includes('copilot') || providers.includes('gh-copilot')) return 'copilot' as const
    return null
  }, [allProfiles, pane.agentProfileId])
  const typedCommandRef = useRef('')
  const effectiveRootPath = pane.rootPath ?? workspaceRootPath
  const insertVoiceText = useCallback((text: string): void => {
    window.dispatchEvent(new CustomEvent('oxe:terminal-insert-text', {
      detail: { paneId: pane.id, text }
    }))
  }, [pane.id])
  const voice = useOxeVoice({ enabled: canUseVoice, onFinalText: insertVoiceText })
  const isVoiceActive = voice.status === 'listening' || voice.status === 'transcribing'

  // Mic chip gestures: a quick tap toggles hands-free mode; press-and-hold is
  // push-to-talk (record while held, transcribe on release).
  const holdTimerRef = useRef<number | null>(null)
  const holdingRef = useRef(false)
  const HOLD_THRESHOLD_MS = 220
  const onVoicePointerDown = useCallback((): void => {
    if (!canUseVoice || !voice.isSupported) return
    holdingRef.current = false
    holdTimerRef.current = window.setTimeout(() => {
      holdingRef.current = true
      voice.startHold()
    }, HOLD_THRESHOLD_MS)
  }, [canUseVoice, voice])
  const onVoicePointerEnd = useCallback((): void => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdingRef.current) {
      holdingRef.current = false
      voice.endHold()
    } else {
      voice.toggle()
    }
  }, [voice])
  const onVoicePointerCancel = useCallback((): void => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (holdingRef.current) {
      holdingRef.current = false
      voice.endHold()
    }
  }, [voice])
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

  // Pane startup deliberately does NOT auto-inject the OXESpace context
  // manifest anymore. Two reasons:
  //   1. It leaks into the agent's conversation as a visible "user" turn
  //      on CLIs like Claude Code — invasive UX.
  //   2. Different agents (Copilot CLI ≥ 1.0, Antigravity) handle initialPrompt
  //      inconsistently; some ignore it entirely.
  // Native MCP discovery via `.mcp.json` is the supported path: any MCP-aware
  // CLI reads the file, spawns the oxespace bridge, and surfaces tools through
  // standard tools/list. The buildPaneManifest service is kept in place for
  // on-demand callers (e.g. a future `/oxe-context` slash skill) but is no
  // longer fired by default. See plan: "MCP-only as native path".

  const start = useCallback(async (): Promise<void> => {
    setStatus(pane.id, 'starting')
    try {
      const { command: agentCommand, initialPrompt } = await resolveWithIntegrationContext()
      const profile = inferAgentProfile(agentCommand ?? '', allProfiles)
      if (profile && profile.agentProfileId !== pane.agentProfileId) {
        void setPaneAgent(pane.id, profile.agentProfileId, { preserveSession: true })
      }

      let p = initialPrompt
      if (terminalPrefs.cavemanModeEnabled) {
        const CAVEMAN_PROMPT = `Respond terse like smart caveman. All technical substance stay. Only fluff die. Drop articles, filler, pleasantries. Fragments OK. Technical terms exact. Code blocks unchanged. Errors quoted exact. Pattern: [thing] [action] [reason]. [next step]. Not: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..." Yes: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"`
        p = p ? `${CAVEMAN_PROMPT}\n\n${p}` : CAVEMAN_PROMPT
      }

      await window.oxe.terminal.start({ paneId: pane.id, workspaceId, agentCommand, initialPrompt: p, disableRtk: !terminalPrefs.rtkHookEnabled })
      setStatus(pane.id, 'running')
    } catch (error) {
      setStatus(pane.id, 'error', toMessage(error))
    }
  }, [allProfiles, pane.agentProfileId, pane.id, resolveWithIntegrationContext, setPaneAgent, setStatus, workspaceId])

  const inEscapeRef = useRef(false)
  const identifyAgentFromInput = useCallback((data: string): void => {
    for (let i = 0; i < data.length; i++) {
      const char = data[i]
      if (inEscapeRef.current) {
        if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '~') {
          inEscapeRef.current = false
        }
        continue
      }
      if (char === '\x1b') {
        inEscapeRef.current = true
        continue
      }
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
        const matchedProfile = inferAgentProfile(command, allProfiles)
        if (matchedProfile && matchedProfile.agentProfileId !== pane.agentProfileId) {
          void setPaneAgent(pane.id, matchedProfile.agentProfileId, { preserveSession: true })
        } else if (command) {
          setLastIntent(pane.id, command)
        }
        continue
      }
      if (char >= ' ') typedCommandRef.current += char
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

  useEffect(() => {
    const forThisPane = (e: Event): boolean => {
      const { paneId: targetId } = (e as CustomEvent<{ paneId: string }>).detail
      return targetId === pane.id && canUseVoice && voice.isSupported
    }
    const onToggle = (e: Event): void => { if (forThisPane(e)) voice.toggle() }
    const onHoldStart = (e: Event): void => { if (forThisPane(e)) voice.startHold() }
    const onHoldEnd = (e: Event): void => { if (forThisPane(e)) voice.endHold() }
    window.addEventListener('oxe:terminal-toggle-voice', onToggle)
    window.addEventListener('oxe:terminal-voice-hold-start', onHoldStart)
    window.addEventListener('oxe:terminal-voice-hold-end', onHoldEnd)
    return () => {
      window.removeEventListener('oxe:terminal-toggle-voice', onToggle)
      window.removeEventListener('oxe:terminal-voice-hold-start', onHoldStart)
      window.removeEventListener('oxe:terminal-voice-hold-end', onHoldEnd)
    }
  }, [canUseVoice, pane.id, voice])

  const statusDotClass = state.status === 'running' ? 'green'
    : state.status === 'starting' ? 'yellow'
    : state.status === 'error' ? 'red'
    : ''

  const setActivePane = useUIStore((s) => s.setActivePane)
  const updateWorktreeState = useWorkspaceStore((s) => s.updateWorktreeState)
  const workspace = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === workspaceId) ?? null)
  const shellProfiles = useWorkspaceStore((s) => s.shellProfiles)
  // Active-shell indicator for the topbar: the pane's own profile, else the
  // workspace default (same resolution terminal.service uses in main).
  const shellName = shellProfiles.find(
    (p) => p.id === (pane.shellProfileId ?? workspace?.defaultShellProfileId)
  )?.name ?? 'Shell'

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

      <div className="terminal-topbar" data-testid="terminal-topbar">
        <span className={`statusbar-dot ${statusDotClass}`} aria-hidden="true" />
        <span className="terminal-topbar-shell" title={`Shell ativo: ${shellName}`}>
          <TerminalIcon size={11} aria-hidden="true" />
          {shellName}
        </span>

        <div className="terminal-topbar-spacer" />

        <button
          type="button"
          className="terminal-topbar-btn"
          aria-label="Search in terminal"
          title="Buscar (Ctrl+F)"
          disabled={!isRunning}
          onClick={() => window.dispatchEvent(new CustomEvent('oxe:terminal-open-search', { detail: { paneId: pane.id } }))}
        >
          <Search size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="terminal-topbar-btn"
          aria-label="Clear terminal"
          title="Limpar terminal"
          disabled={!isRunning}
          onClick={() => window.dispatchEvent(new CustomEvent('oxe:terminal-clear', { detail: { paneId: pane.id } }))}
        >
          <Eraser size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="terminal-topbar-btn"
          aria-label="New session"
          title="Nova sessão (reinicia o shell)"
          disabled={state.status === 'starting'}
          onClick={() => void (isRunning ? restart() : start())}
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
      </div>

      {isRunning ? (
        <div className="terminal-content">
          <ErrorBoundary label="o terminal">
          <TerminalView
            paneId={pane.id}
            isRunning={isRunning}
            themeId={workspaceThemeId}
            prefs={terminalPrefs}
            onInput={(data) => {
              if (!isRunning) return
              identifyAgentFromInput(data)
              void window.oxe.terminal.write({ paneId: pane.id, data })
            }}
            onResize={(cols, rows) => {
              if (isRunning) void window.oxe.terminal.resize({ paneId: pane.id, cols, rows })
            }}
            onExit={(exitCode) => {
              // Only attach an error message for a NON-zero exit. A clean exit
              // (code 0) must leave `error` empty so deriveStatusTone resolves to
              // the gray 'exited' tone instead of the red 'error' tone (which
              // checks `entry.error` first). exitCode 0 is falsy → undefined.
              setStatus(pane.id, 'exited', exitCode ? `Exited with code ${exitCode}` : undefined)
            }}
          />
          </ErrorBoundary>
          {voice.status === 'listening' || voice.status === 'transcribing' || voice.status === 'downloading' || voice.error ? (
            <div className={`oxe-voice-hud ${voice.error ? 'error' : voice.status}`} role="status" aria-live="polite">
              {voice.status === 'listening' && !voice.error ? (
                <span className="oxe-voice-meter" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="oxe-voice-bar"
                      style={{ transform: `scaleY(${Math.max(0.18, Math.min(1, voice.level * (1.4 - Math.abs(i - 2) * 0.25)))})` }}
                    />
                  ))}
                </span>
              ) : (
                <span className={`oxe-voice-pulse${voice.status === 'transcribing' ? ' spin' : ''}`} aria-hidden="true" />
              )}
              <span>
                {voice.error
                  ? voice.error
                  : voice.status === 'downloading'
                    ? `Baixando modelo de voz… ${voice.modelProgress !== null ? Math.round(voice.modelProgress * 100) : 0}%`
                    : voice.status === 'transcribing'
                      ? 'Transcrevendo…'
                      : 'Ouvindo… solte para inserir'}
              </span>
            </div>
          ) : null}
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

        {contextProvider ? <ContextUsageStatus provider={contextProvider} rootPath={effectiveRootPath} /> : null}
        {isCopilotPane ? <CopilotCreditsStatus /> : null}
        {agentCreditsProvider ? <AgentCreditsStatus provider={agentCreditsProvider} /> : null}

        <button
          type="button"
          className={`statusbar-chip worktree-chip${isWorktreeOverride ? ' overridden' : ''}${branchErrorReason ? ' branch-error' : ''}`}
          aria-label={`Worktree: ${worktreeLabel}. ${isWorktreeOverride ? 'This pane is in a worktree. ' : ''}Click to manage.`}
          data-tooltip={branchErrorReason
            ? `Branch could not be read: ${branchErrorReason} (${effectiveRootPath})`
            : `Branch/worktree: ${worktreeLabel} (${effectiveRootPath})`}
          onClick={() => {
            setActivePane(pane.id)
            void updateWorktreeState({
              workspaceId,
              worktreePanelVisible: true,
              worktreePanelExpanded: workspace?.worktreePanelExpanded ?? false
            })
          }}
        >
          <FolderTree size={10} aria-hidden="true" />
          <span className="chip-label">{worktreeLabel}</span>
          {isWorktreeOverride ? <span className="worktree-chip-tag" aria-hidden="true">wt</span> : null}
        </button>



        <button
          type="button"
          className={`statusbar-chip rtk-chip ${!terminalPrefs.rtkHookEnabled ? 'disabled' : ''}`}
          aria-label={`RTK Terminal Hook: ${terminalPrefs.rtkHookEnabled ? 'Enabled' : 'Disabled'}. Click to toggle.`}
          data-tooltip={terminalPrefs.rtkHookEnabled
            ? 'RTK: Hook ativado (economiza tokens). Clique para desativar.'
            : 'RTK: Hook desativado. Clique para ativar.'}
          onClick={() => setTerminalOverride(workspaceId, 'rtkHookEnabled', !terminalPrefs.rtkHookEnabled)}
        >
          <Zap size={10} aria-hidden="true" style={{ opacity: terminalPrefs.rtkHookEnabled ? 1 : 0.4 }} />
          <span className="chip-label" style={{ opacity: terminalPrefs.rtkHookEnabled ? 1 : 0.4 }}>rtk</span>
        </button>

        <button
          type="button"
          className={`statusbar-chip caveman-chip ${!terminalPrefs.cavemanModeEnabled ? 'disabled' : ''}`}
          aria-label={`Caveman Mode: ${terminalPrefs.cavemanModeEnabled ? 'Enabled' : 'Disabled'}. Click to toggle.`}
          data-tooltip={terminalPrefs.cavemanModeEnabled
            ? 'Caveman Mode: Ativado (O LLM fala o mínimo possível). Clique para desativar.'
            : 'Caveman Mode: Desativado (Respostas normais do LLM). Clique para ativar.'}
          onClick={() => setTerminalOverride(workspaceId, 'cavemanModeEnabled', !terminalPrefs.cavemanModeEnabled)}
        >
          <Bone size={10} aria-hidden="true" style={{ opacity: terminalPrefs.cavemanModeEnabled ? 1 : 0.4 }} />
          <span className="chip-label" style={{ opacity: terminalPrefs.cavemanModeEnabled ? 1 : 0.4 }}>caveman</span>
        </button>

        <button
          type="button"
          className={`statusbar-chip semantic-chip ${!terminalPrefs.semanticSearchEnabled ? 'disabled' : ''}`}
          aria-label={`Semantic Search: ${terminalPrefs.semanticSearchEnabled ? 'Enabled' : 'Disabled'}. Click to toggle.`}
          data-tooltip={terminalPrefs.semanticSearchEnabled
            ? 'Busca Semântica: ativa (agente lê menos arquivos). Clique para desativar.'
            : 'Busca Semântica: desativada. Clique para ativar.'}
          onClick={() => {
            const next = !terminalPrefs.semanticSearchEnabled
            setTerminalOverride(workspaceId, 'semanticSearchEnabled', next)
            void window.oxe.semantic?.setEnabled({ workspaceId, enabled: next }).catch(() => undefined)
          }}
        >
          <Brain size={10} aria-hidden="true" style={{ opacity: terminalPrefs.semanticSearchEnabled ? 1 : 0.4 }} />
          <span className="chip-label" style={{ opacity: terminalPrefs.semanticSearchEnabled ? 1 : 0.4 }}>semantic</span>
        </button>

        <button
          type="button"
          className={`statusbar-chip voice-chip ${voice.error ? 'error' : voice.status}`}
          aria-label={voice.isSupported ? 'OXEVoice: tap to toggle, hold to push-to-talk' : 'OXEVoice is not available'}
          aria-pressed={isVoiceActive}
          data-tooltip={voice.isSupported
            ? 'OXEVoice — toque para alternar, segure para falar (push-to-talk). O texto vai pro terminal sem Enter.'
            : 'OXEVoice indisponível neste runtime'}
          disabled={!canUseVoice || !voice.isSupported}
          onPointerDown={onVoicePointerDown}
          onPointerUp={onVoicePointerEnd}
          onPointerLeave={onVoicePointerCancel}
        >
          {isVoiceActive
            ? <MicOff size={10} aria-hidden="true" />
            : <Mic size={10} aria-hidden="true" />}
          <span className="chip-label">
            {voice.status === 'downloading' ? 'baixando…'
              : voice.status === 'transcribing' ? 'transcrevendo…'
                : voice.status === 'listening' ? 'ouvindo' : 'voice'}
          </span>
        </button>

        {state.status === 'exited' ? (
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
