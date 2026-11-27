import { recordRuntime } from './runtime-diagnostics'
import { managedAgentProcessRegistry } from './diagnostics/agent-process-registry'
import { externalProviderForName } from './diagnostics/agent-processes'
import { spawn } from 'node-pty'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { AppDatabase } from '../db/index'
import { terminatePty } from '../utils/process-tree'
import { PtyInputQueue } from './pty-input-queue'
import { PtyOutputBatcher } from './pty-output-batcher'
import { PtyRingBuffer } from './pty-ring-buffer'
import { resumeCommand } from './agent-state/pane-sessions'
import { mainMessage } from '../../../shared/messages'
import { resumeBypassAllowed, setResumeBypassAllowed } from './agent-state/resume-bypass-setting'
import { setTerminalAgentsFullAccess, terminalAgentsFullAccess } from './agent-state/agent-full-access'
import { setTerminalQuitBehavior, terminalQuitBehavior } from './terminal/quit-behavior-setting'
import type { DaemonPtyModule } from './terminal/daemon-pty'
import type { PtyDaemonSessionInfo } from './terminal/pty-daemon-protocol'
import { startedFreshStatus } from './agent-state/pane-resume'
import { PtyModeTracker } from './pty-mode-tracker'
import { resolveExecutable as resolveWithProbe } from './terminal/executable'
import { SessionStarter, type ManagedTerminalStart, type PtyModule, type SessionStartOptions, type StartedProcess } from './terminal/session-start'
import { CONPTY_START_SCREEN, SessionOutput, type TerminalSession } from './terminal/session-output'
import { SessionExits } from './terminal/session-exit'
import { PtyExitDrain, QUIT_TREE_GRACE_MS, type QuitDrainOptions, type QuitDrainResult } from './terminal/quit-drain'
import { ShellCwdScanner } from './terminal/shell-cwd'
import { ShellCommandOscScanner } from './terminal/shell-command-osc'
import { PaneBranchTracker, samePaneBranch } from './terminal/pane-branch'
import { SizeLeases } from './terminal/size-lease'
import { desktopStartSize, keepDesktopSize } from './terminal/restart-size'
import { Da1Filter } from './pty-da1'
import { LEVER_I_FLUSH_BYTES, LEVER_I_FLUSH_MS, TERMINAL_LEVERS_ENV, terminalLevers, type TerminalLever } from '../../../shared/terminal-levers'
import type { TerminalActivityEvent, TerminalSizeLeaseEvent, TerminalAttachInput, TerminalAttachResult, TerminalDataEvent, TerminalDetachInput, TerminalDetachResult, TerminalExitEvent, TerminalQuitBehavior, TerminalResizeInput, TerminalStatusResult, TerminalStopInput, TerminalWriteInput, PaneAgentResume, PaneAgentSession, TerminalBranchChangedEvent, TerminalPaneBranch } from '../../../shared/types/ipc'

export { __resetExecutableCacheForTests } from './terminal/executable'
export { CONPTY_START_SCREEN }
export type { ManagedTerminalStart }

/**
 * OXE-443 · Delay (ms) before restoring `(cols, rows)` in `nudgeRedraw` so ConPTY and
 * interactive TUIs (Antigravity, Claude Code, Codex) actually observe the size delta
 * instead of coalescing an immediate 0ms bounce.
 */
export const NUDGE_REDRAW_DELAY_MS = 65

interface TerminalManagerOptions extends SessionStartOptions {
  pty?: PtyModule
  /** OXE-447 · Optional detached PTY daemon client module for restart survival and explicit shutdown. */
  daemon?: DaemonPtyModule
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  userDataPath?: string
  emitData?: (event: TerminalDataEvent) => void
  emitExit?: (event: TerminalExitEvent) => void
  /** A18 (T73) · A pane's branch changed (the pane header's "switched from"). */
  emitBranchChanged?: (event: TerminalBranchChangedEvent) => void
  emitSizeLease?: (event: TerminalSizeLeaseEvent) => void // 1.5.0 · a phone took a pane's size, or the desktop's is back (lease: null)
  emitActivity?: (event: TerminalActivityEvent) => void
  ringCapacityBytes?: number
  onLaunchExit?: (paneId: string) => void
  /** Sees every terminal's lifecycle and output, e.g. to read what an agent shows on screen. */
  observer?: TerminalObserver
}

export interface TerminalObserver {
  start(paneId: string, workspaceId: string, cols: number, rows: number, command: string | null, options?: { remote?: boolean }): void
  output(paneId: string, data: string): void
  resize(paneId: string, cols: number, rows: number): void
  exit(paneId: string): void
}

/**
 * Safety valve now that leaving a workspace no longer stops its shells. Each
 * live PTY is a real OS process (~30-60 MB for PowerShell), so an unbounded
 * count would eventually matter on a long session.
 */
const MAX_LIVE_PTYS = 24
/** A session must be quiet this long before it is considered reclaimable. */
const RECLAIM_IDLE_MS = 30_000

export class TerminalManager {
  private readonly starting = new Map<string, Promise<void>>()
  private readonly launchControllers = new Map<string, AbortController>()
  private readonly starter: SessionStarter
  private readonly output: SessionOutput
  private readonly exits = new SessionExits()
  /** OXE-392: processes whose exit has not reached JS yet; on quit they are waited for before teardown. */
  private readonly exitDrain = new PtyExitDrain<StartedProcess['ptyProcess']>()
  private quitting = false
  private readonly onLaunchExit?: TerminalManagerOptions['onLaunchExit']
  private readonly isManagedPane?: TerminalManagerOptions['isManagedPane']
  private readonly daemon?: DaemonPtyModule
  private readonly observer?: TerminalObserver
  private readonly resumeSession?: TerminalManagerOptions['resumeSession']
  private readonly clearSession?: TerminalManagerOptions['clearSession']
  private readonly currentSession?: TerminalManagerOptions['currentSession']
  /** B17 · What each pane's first start in this run did with its agent's session, for terminal.status. */
  private readonly agentResumes = new Map<string, PaneAgentResume>()
  private readonly emitSizeLease: (event: TerminalSizeLeaseEvent) => void
  /** 1.5.0 · The size a phone holds for a pane while it has the terminal open. */
  readonly sizes = new SizeLeases({
    size: id => {
      const s = this.sessions.get(id)
      return s ? { cols: s.cols, rows: s.rows } : null
    },
    apply: (id, cols, rows) => {
      const s = this.sessions.get(id)
      if (s) this.applySize(s, cols, rows)
    },
    emit: event => this.emitSizeLease(event)
  })
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly platform: NodeJS.Platform
  /** OXE-411 · Measured levers, H and Q on by default unless OXESPACE_TERM_LEVERS overrides (shared/terminal-levers.ts). */
  private readonly levers: ReadonlySet<TerminalLever>
  private readonly emitExit: (event: TerminalExitEvent) => void
  private readonly ringCapacityBytes?: number
  /** A18 (T79) / OXE-272 · Each pane's passive shell cwd + OSC 633/133 command state. */
  private readonly shellCwds = new Map<string, { scanner: ShellCwdScanner; command: ShellCommandOscScanner; cwd: string | null }>()
  /** A18 (T73) · Each pane's branch and the branch it started on. */
  private readonly branches = new PaneBranchTracker()
  private readonly emitBranchChanged: (event: TerminalBranchChangedEvent) => void
  private readonly emitActivity: (event: TerminalActivityEvent) => void

  constructor(private readonly db: AppDatabase, options: TerminalManagerOptions = {}) {
    this.onLaunchExit = options.onLaunchExit
    this.isManagedPane = options.isManagedPane
    this.daemon = options.daemon
    this.observer = options.observer
    this.resumeSession = options.resumeSession
    this.clearSession = options.clearSession
    this.currentSession = options.currentSession
    this.platform = options.platform ?? process.platform
    this.levers = terminalLevers((options.env ?? process.env)[TERMINAL_LEVERS_ENV])
    this.starter = new SessionStarter({
      db,
      pty: options.pty ?? { spawn },
      env: options.env ?? process.env,
      platform: this.platform,
      exists: path => existsSync(path),
      sessions: this.sessions,
      agentResumes: this.agentResumes,
      takeFailedResume: paneId => this.exits.takeFailedResume(paneId),
      notifyLaunchExit: paneId => this.notifyLaunchExit(paneId),
      started: started => this.onStarted(started),
      prepareLaunch: options.prepareLaunch,
      executionEnvironment: options.executionEnvironment,
      grantProxy: options.grantProxy,
      agentMcpArgs: options.agentMcpArgs,
      isManagedPane: options.isManagedPane,
      oxeQueryShell: options.oxeQueryShell,
      remoteSshPane: options.remoteSshPane,
      resumeSession: options.resumeSession,
      assignSession: options.assignSession,
      clearSession: options.clearSession,
      currentSession: options.currentSession,
      nativeSessionRoots: options.nativeSessionRoots,
      rootExists: options.rootExists
    })
    this.emitActivity = options.emitActivity ?? (() => undefined)
    this.output = new SessionOutput({
      sessions: this.sessions,
      takeExited: paneId => this.exits.take(paneId),
      scanShellCwd: (paneId, chunk) => this.scanShellCwd(paneId, chunk),
      emitData: options.emitData ?? (() => undefined),
      emitActivity: this.emitActivity
    })
    this.emitExit = options.emitExit ?? (() => undefined)
    this.emitBranchChanged = options.emitBranchChanged ?? (() => undefined)
    this.emitSizeLease = options.emitSizeLease ?? (() => undefined)
    this.ringCapacityBytes = options.ringCapacityBytes
  }

  async start(input: ManagedTerminalStart): Promise<void> {
    // OXE-392: nothing starts once the app is quitting; the drain could not wait for it.
    if (this.quitting) return
    const pending = this.starting.get(input.paneId)
    if (pending) return pending
    const controller = new AbortController()
    this.launchControllers.set(input.paneId, controller)
    const task = this.starter.start(input, controller.signal).finally(() => {
      this.starting.delete(input.paneId)
      this.launchControllers.delete(input.paneId)
    })
    this.starting.set(input.paneId, task)
    return task
  }

  /** The spawned process becomes the pane's session: its state, its output and its exit. */
  private onStarted({ input, ptyProcess, cwd, executable, cols, rows, resumed, revokeProxy, command, remote }: StartedProcess): void {
    // A pane that is starting fresh must not inherit a dead session's output.
    this.exits.forget(input.paneId)
    this.reclaimIdleSession()

    this.exits.recordStart(input.paneId, { workspaceId: input.workspaceId, agentCommand: input.agentCommand, cols, rows, resumeAgent: input.resumeAgent })
    this.sessions.set(input.paneId, {
      sessionId: randomUUID(),
      launchDirectory: cwd,
      executable,
      startedAt: Date.now(),
      paneId: input.paneId,
      workspaceId: input.workspaceId,
      pty: ptyProcess,
      agentCommand: input.agentCommand,
      resumeAgent: input.resumeAgent,
      resumed,
      revokeProxy,
      inputQueue: new PtyInputQueue(ptyProcess),
      outputBatcher: this.levers.has('I')
        ? new PtyOutputBatcher(input.paneId, (event) => this.output.onBatch(event), LEVER_I_FLUSH_MS, LEVER_I_FLUSH_BYTES)
        : new PtyOutputBatcher(input.paneId, (event) => this.output.onBatch(event)),
      ring: new PtyRingBuffer(this.ringCapacityBytes),
      modes: new PtyModeTracker(),
      // A view always attaches right after starting; assuming attached here
      // avoids dropping the first prompt into the ring only.
      attached: true,
      viewAttached: false,
      da1: new Da1Filter(),
      da1Timer: null,
      lastActivityAt: Date.now(),
      cols,
      rows,
      activityNotifiedAt: 0
    })

    // The bundled ConPTY (useConptyDll) never clears the screen on start, unlike the system one (ESC[2J ESC[m ESC[H),
    // yet positions absolutely from row 1. The view may already hold a line ("Idle"), so the first screen landed one row
    // off. Start every Windows session from the same clean, homed screen the system ConPTY gave.
    if (this.platform === 'win32' && !remote) this.sessions.get(input.paneId)?.outputBatcher.push(CONPTY_START_SCREEN)
    this.exitDrain.track(ptyProcess)
    const detectedProvider = externalProviderForName(input.agentCommand?.trim().split(/\s+/)[0] ?? executable)
    if (!remote && ptyProcess.pid > 1 && (input.agentCommand || input.launch || detectedProvider)) {
      const provider = detectedProvider ?? basename(executable).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
      const kind = this.isManagedPane?.(input.paneId) ? 'delegation' : 'terminal'
      managedAgentProcessRegistry.register({
        rootPid: ptyProcess.pid,
        provider,
        kind,
        contextId: `pane:${input.paneId}`,
        label: `${provider} terminal`,
        state: 'active',
        stop: () => this.end({ paneId: input.paneId })
      })
    }
    if (!remote) this.trackBranch(input.paneId, cwd)
    this.observer?.start(input.paneId, input.workspaceId, cols, rows, command, remote ? { remote: true } : undefined)
    ptyProcess.onData((data) => {
      const session = this.sessions.get(input.paneId)
      if (session) this.output.receive(session, data)
      // OXE-411 lever M: the headless screen mirror runs for agent panes and remote SSH panes (OXE-447).
      if (!this.levers.has('M') || input.agentCommand || remote) this.observer?.output(input.paneId, data)
    })
    ptyProcess.onExit(({ exitCode }) => {
      managedAgentProcessRegistry.unregister(ptyProcess.pid)
      this.exitDrain.settle(ptyProcess)
      recordRuntime('process-exit', { pane: input.paneId, pid: ptyProcess.pid, exitCode })
      const session = this.sessions.get(input.paneId)
      if (session?.pty !== ptyProcess) return // A late exit cannot remove a restarted process.
      if (session) this.output.releaseDa1(session)
      session?.outputBatcher.flush()
      if (session) this.exits.remember(session, exitCode)
      // A resume that ends at once could not load its session; forget it so it cannot loop resume → exit → resume.
      if (session && this.exits.recordFailedResume(session)) this.clearSession?.(input.paneId)
      this.sessions.delete(input.paneId)
      // A held pane's next start is at the desktop's size.
      keepDesktopSize(this.sizes, input.paneId, session)
      this.sizes.forget(input.paneId)
      session?.revokeProxy?.()
      this.notifyLaunchExit(input.paneId)
      this.forgetBranch(input.paneId)
      this.observer?.exit(input.paneId)
      this.emitExit({ paneId: input.paneId, exitCode })
    })
  }

  async write(input: TerminalWriteInput): Promise<void> {
    const session = this.sessions.get(input.paneId)
    if (!session || !input.data) return

    await session.inputQueue.enqueue(input.data)
  }

  /**
   * Submits a prompt to an interactive agent: pasted as one block when the app
   * asked for bracketed paste (so a multi-line prompt is not sent line by line),
   * then Enter a moment later, as herdr does. False when the pane is not running.
   */
  async submit(paneId: string, text: string): Promise<boolean> {
    const session = this.sessions.get(paneId)
    if (!session) return false
    const body = text.replace(/\r\n?/g, '\n')
    await session.inputQueue.enqueue(session.modes.bracketedPaste ? `\x1b[200~${body}\x1b[201~` : body)
    await new Promise(resolve => setTimeout(resolve, 80))
    if (this.sessions.get(paneId) !== session) return false
    await session.inputQueue.enqueue('\r')
    return true
  }

  /** Sends Escape, which interrupts the running turn in Claude Code and Codex. */
  async interrupt(paneId: string): Promise<boolean> {
    const session = this.sessions.get(paneId)
    if (!session) return false
    await session.inputQueue.enqueue('\x1b')
    return true
  }

  resize(input: TerminalResizeInput): void {
    const session = this.sessions.get(input.paneId)
    if (!session) return
    // While a phone holds the size, the desktop's own fit is remembered for when the phone lets go, not applied.
    if (!this.sizes.rememberDesktop(input.paneId, input.cols, input.rows)) this.applySize(session, input.cols, input.rows)
  }

  private clearNudgeTimer(session: TerminalSession): void {
    if (!session.nudgeTimer) return
    clearTimeout(session.nudgeTimer)
    session.nudgeTimer = null
  }

  private applySize(session: TerminalSession, cols: number, rows: number): void {
    this.clearNudgeTimer(session)
    const unchanged = session.cols === cols && session.rows === rows
    const needsPendingNudge = session.pendingRedrawNudge === true
    session.pendingRedrawNudge = false
    session.cols = cols
    session.rows = rows
    this.observer?.resize(session.paneId, cols, rows)
    // A restored full-screen TUI or truncated inline TUI needs a fresh frame after the renderer has installed its
    // buffer; a same-size resize is that handshake. Contiguous Lever H delta reattaches clear pendingRedrawNudge.
    if (unchanged && session.attached && needsPendingNudge) {
      this.nudgeRedraw(session, session.modes.altScreen ? 'rows' : 'cols')
    } else {
      session.pty.resize(cols, rows)
    }
  }

  /** Binds a view and hands back what to render. Subscribe to `onData` before calling it. */
  attach(input: TerminalAttachInput): TerminalAttachResult {
    return this.output.attach(input)
  }

  /** Readers that are not views hear that a pane printed, then read it with `readSince`. */
  onOutput(listener: (paneId: string) => void): () => void {
    return this.output.onOutput(listener)
  }

  /** Output after `seq` in the ring, without attaching. `session` changes when the pane's process is replaced. */
  readSince(paneId: string, seq: number): { session: string; seq: number; data: string; truncated: boolean; cols: number; rows: number } | null {
    return this.output.readSince(paneId, seq)
  }

  /** Unbind the view. The process keeps running and its output keeps accruing. */
  detach(input: TerminalDetachInput): TerminalDetachResult | undefined {
    return this.output.detach(input)
  }

  /** The retained output for a reader that is not a view. Nothing is attached or consumed. */
  peek(paneId: string): { running: boolean; data: string; altScreen: boolean } | null {
    return this.output.peek(paneId)
  }

  /** T54 · Settings › Terminal: whether a session that skipped permissions resumes that way (off by default). */
  resumeBypass(): boolean { return resumeBypassAllowed(this.db) }

  setResumeBypass(enabled: boolean): boolean { return setResumeBypassAllowed(this.db, enabled) }

  /** Settings > Terminal: whether agents started in a pane skip their permission prompts (on by default). */
  agentsFullAccess(): boolean { return terminalAgentsFullAccess(this.db) }

  setAgentsFullAccess(enabled: boolean): boolean { return setTerminalAgentsFullAccess(this.db, enabled) }

  /** A18 (T73) · The pane's branch, read again (terminal focus); null for a pane with no terminal. */
  async branch(paneId: string): Promise<TerminalPaneBranch | null> {
    if (!this.branches.isTracked(paneId)) return this.branches.get(paneId)
    return this.refreshBranch(paneId)
  }

  /** A18 (T79) · The cwd the pane's shell last reported (OSC), or null. */
  shellCwd(paneId: string): string | null {
    return this.shellCwds.get(paneId)?.cwd ?? null
  }

  private trackBranch(paneId: string, cwd: string): void {
    this.shellCwds.set(paneId, { scanner: new ShellCwdScanner(this.platform), command: new ShellCommandOscScanner(), cwd: null })
    void this.branches.track(paneId, cwd).then(view => {
      if (this.branches.isTracked(paneId)) this.emitBranchChanged({ paneId, ...view })
    }).catch(() => undefined)
  }

  private scanShellCwd(paneId: string, chunk: string): void {
    // A18 (T79) · One indexOf per chunk while nothing is pending; a new cwd moves the pane's branch.
    const shell = this.shellCwds.get(paneId)
    if (!shell) return
    const cwd = shell.scanner.push(chunk)
    if (cwd && cwd !== shell.cwd) {
      shell.cwd = cwd
      void this.refreshBranch(paneId, cwd)
    }
    const command = shell.command.push(chunk)
    if (command) this.emitActivity({ paneId, at: Date.now(), bytes: 0, command })
  }

  private async refreshBranch(paneId: string, cwd?: string): Promise<TerminalPaneBranch | null> {
    const before = this.branches.get(paneId)
    try {
      const after = await this.branches.refresh(paneId, cwd)
      if (after && !samePaneBranch(before, after)) this.emitBranchChanged({ paneId, ...after })
      return after
    } catch {
      return before
    }
  }

  private forgetBranch(paneId: string): void {
    this.shellCwds.delete(paneId)
    this.branches.forget(paneId)
  }

  status(paneId: string): TerminalStatusResult {
    if (this.branches.isTracked(paneId)) void this.refreshBranch(paneId)
    const session = this.sessions.get(paneId)
    const resumed = this.agentResumes.get(paneId)
    const agentResume = resumed ? { agentResume: resumed } : {}
    const agentSession = this.agentSessionOf(paneId, session?.executable, resumed)
    if (!session) return { running: false, seq: 0, altScreen: false, ...agentResume, ...agentSession }
    const command = this.shellCwds.get(paneId)?.command.current()
    return { running: true, seq: session.ring.seq, altScreen: session.modes.altScreen, sessionId: session.sessionId, launchDirectory: session.launchDirectory, executable: session.executable, pid: session.pty.pid, startedAt: session.startedAt, ...(command ? { command } : {}), ...agentResume, ...agentSession }
  }

  /**
   * Terminal details' "Agent session" (S2): the native session the pane is in, how OXESpace learned it, and the command
   * that reopens it; `notFound` with a reason when the pane runs Claude Code or Codex and none was reported yet.
   */
  private agentSessionOf(paneId: string, executable: string | undefined, resumed: PaneAgentResume | undefined): { agentSession?: PaneAgentSession } {
    const current = this.currentSession?.(paneId) ?? null
    if (current) {
      // The session this run resumed was started by main, like one it named with --session-id.
      const source = resumed?.outcome === 'resumed' && resumed.sessionId === current.sessionId ? 'launch' : current.source
      return { agentSession: { agent: current.agent, sessionId: current.sessionId, source, resumeCommand: resumeCommand(current.agent, current.sessionId) } }
    }
    const provider = executable ? basename(executable).replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase() : ''
    return provider === 'claude' || provider === 'codex' ? { agentSession: { source: 'notFound', message: mainMessage('agents.session.notFound', {}) } } : {}
  }

  /**
   * Make a full-screen or truncated inline TUI repaint by bouncing the terminal
   * size. Every TUI redraws its viewport on SIGWINCH/ConPTY resize, yielding a
   * clean frame rather than one reconstructed from truncated bytes. Normal-buffer
   * inline TUIs prefer bouncing `cols` so ConPTY does not push row 0 into
   * scrollback while repainting.
   */
  private nudgeRedraw(session: TerminalSession, axis: 'rows' | 'cols' = 'rows'): void {
    this.clearNudgeTimer(session)
    const { cols, rows } = session
    const bounceCols = axis === 'cols' ? cols > 2 : rows <= 1 && cols > 2
    const targetCols = bounceCols ? cols - 1 : cols
    const targetRows = bounceCols ? rows : rows - 1
    if (targetCols < 1 || targetRows < 1) return
    try {
      session.pty.resize(targetCols, targetRows)
      session.nudgeTimer = setTimeout(() => {
        session.nudgeTimer = null
        if (this.sessions.get(session.paneId) !== session || !session.attached) return
        try {
          session.pty.resize(cols, rows)
        } catch { /* process exited between ticks */ }
      }, NUDGE_REDRAW_DELAY_MS)
    } catch { /* process exited; attach still returns cleanly */ }
  }

  stop(input: TerminalStopInput): void {
    // Synchronous callers (quit, restart, pane close) never wait on the kill, and a failed kill is not an unhandled rejection.
    this.end(input).catch(() => { /* the tree kill reports its own failure; a stop does not wait on it */ })
  }

  /** Stops the pane at once; settles when its process tree has really ended, rejects if it could not be ended. */
  private end(input: TerminalStopInput): Promise<void> {
    this.launchControllers.get(input.paneId)?.abort()
    const session = this.sessions.get(input.paneId)
    if (!session) return Promise.resolve()
    recordRuntime('process-stop', { pane: input.paneId, pid: session.pty.pid })
    managedAgentProcessRegistry.unregister(session.pty.pid)
    // Flush before disposing: the batcher discards `pending`, so an exiting
    // process used to lose its last words (often the error that killed it).
    this.clearNudgeTimer(session)
    this.output.releaseDa1(session)
    session.outputBatcher.flush()
    session.inputQueue.dispose()
    session.outputBatcher.dispose()
    // The whole tree, not just the shell: an MCP server or `npm run dev` it started must not outlive the pane (BE-M-08).
    const ended = terminatePty(session.pty, this.quitting ? { graceMs: QUIT_TREE_GRACE_MS } : {})
    this.sessions.delete(input.paneId)
    this.sizes.forget(input.paneId)
    session.revokeProxy?.()
    this.notifyLaunchExit(input.paneId)
    this.observer?.exit(input.paneId)
    this.forgetBranch(input.paneId)
    // An explicit stop is not a crash to be explained on return.
    this.exits.forget(input.paneId)
    return ended
  }

  private notifyLaunchExit(paneId: string): void {
    try { this.onLaunchExit?.(paneId) } catch { /* Optional integrations cannot affect PTY cleanup. */ }
  }

  async restart(input: TerminalStopInput): Promise<void> {
    // A pane whose process exited by itself restarts as it last started; a pane that was stopped stays stopped.
    const session = this.sessions.get(input.paneId) ?? this.exits.restartable(input.paneId)
    if (!session) return
    const { workspaceId, agentCommand, resumeAgent } = session
    // T18-b · A phone's held size is never the desktop's: the new process starts at the desktop's own fit.
    const { cols, rows } = desktopStartSize(this.sizes, input.paneId, session)
    // B17 · `resume: false` starts fresh and forgets the session, so a later crash does not bring it back. A fresh
    // Claude then gets a new session id of main's, recorded as the pane's session.
    let fresh: PaneAgentResume | undefined
    if (input.resume === false) {
      fresh = startedFreshStatus(this.resumeSession?.(input.paneId, false, true) ?? null)
      this.clearSession?.(input.paneId)
    }
    this.stop(input)
    // A fresh process gets a fresh ring: replaying the old shell's output over
    // the new one would show history that no longer belongs to it.
    await this.start({ paneId: input.paneId, workspaceId, agentCommand, cols, rows, resumeAgent: fresh ? undefined : resumeAgent, resumeAgain: !fresh })
    if (fresh) this.agentResumes.set(input.paneId, fresh)
  }

  /** A4 (OXE-367): stops every pane of the workspace; settles once all of their processes have ended, rejects if any could not be. */
  async stopWorkspace(workspaceId: string): Promise<void> {
    const panes = [...this.sessions.values()].filter(session => session.workspaceId === workspaceId).map(session => session.paneId)
    const results = await Promise.allSettled(panes.map(paneId => this.end({ paneId })))
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason))
  }

  /**
   * Stops every session whose launch directory is `dir` or inside it and
   * returns the pane ids. Used before deleting a worktree: a shell holding the
   * directory as its cwd would make the delete fail on Windows.
   */
  stopWithin(dir: string): string[] {
    const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const root = norm(dir)
    const stopped: string[] = []
    for (const session of [...this.sessions.values()]) {
      const cwd = norm(session.launchDirectory)
      if (cwd === root || cwd.startsWith(root + '/')) {
        this.stop({ paneId: session.paneId })
        stopped.push(session.paneId)
      }
    }
    return stopped
  }

  stopAll(): void {
    for (const controller of this.launchControllers.values()) controller.abort()
    for (const paneId of [...this.sessions.keys()]) {
      this.stop({ paneId })
    }
  }

  /** OXE-447 · Quit behavior (`detach` keeps daemon PTYs alive; `kill` terminates all terminals). */
  quitBehavior(): TerminalQuitBehavior {
    return terminalQuitBehavior(this.db)
  }

  setQuitBehavior(mode: TerminalQuitBehavior): TerminalQuitBehavior {
    return setTerminalQuitBehavior(this.db, mode)
  }

  /** Lists live sessions currently owned by the detached PTY daemon (empty when not in daemon mode). */
  async listDaemonSessions(): Promise<PtyDaemonSessionInfo[]> {
    if (!this.daemon) return []
    return this.daemon.listSessions().catch(() => [])
  }

  /** Detaches from the PTY daemon cleanly on quit without killing daemon-owned sessions. */
  async detachForQuit(): Promise<void> {
    this.quitting = true
    for (const controller of this.launchControllers.values()) controller.abort()
    for (const session of this.sessions.values()) {
      this.clearNudgeTimer(session)
      this.output.releaseDa1(session)
      session.outputBatcher.flush()
      session.inputQueue.dispose()
      session.outputBatcher.dispose()
    }
    this.sessions.clear()
    if (this.daemon) {
      await this.daemon.detachClient().catch(() => undefined)
    }
  }

  /**
   * OXE-392, on quit: no new start, every launch aborted and every terminal stopped, then each exit awaited while JS
   * still runs (see quit-drain.ts). A terminal that exits on its signal at once is drained in milliseconds.
   */
  async stopAllAndDrain(options: Partial<QuitDrainOptions<StartedProcess['ptyProcess']>> = {}): Promise<QuitDrainResult> {
    this.quitting = true
    this.stopAll()
    const drained = await this.exitDrain.drain({ ...options, forceKill: options.forceKill ?? (pty => this.forceKill(pty)) })
    if (this.daemon) {
      await this.daemon.shutdown().catch(() => undefined)
    }
    return drained
  }

  private forceKill(pty: StartedProcess['ptyProcess']): void {
    const pid = pty.pid
    if (this.platform !== 'win32' && Number.isInteger(pid) && pid > 1) process.kill(pid, 'SIGKILL')
    else pty.kill()
  }

  hasSession(paneId: string): boolean {
    return this.sessions.has(paneId)
  }

  isStarting(paneId: string): boolean {
    return this.starting.has(paneId)
  }

  /**
   * Free a slot when too many shells are alive. Only reclaims a session that
   * is detached AND has been silent for a while: a working agent is never
   * killed to make room. When nothing qualifies the start proceeds anyway —
   * blocking the user on a resource heuristic would be worse than the memory.
   */
  private reclaimIdleSession(): void {
    if (this.sessions.size < MAX_LIVE_PTYS) return

    const now = Date.now()
    let oldest: TerminalSession | null = null
    for (const session of this.sessions.values()) {
      // A parked view (its workspace is hidden, OXE-411) is still the person's terminal: never reclaimed.
      if (session.attached || session.parked) continue
      if (now - session.lastActivityAt < RECLAIM_IDLE_MS) continue
      if (!oldest || session.lastActivityAt < oldest.lastActivityAt) oldest = session
    }

    if (!oldest) {
      console.warn(`[OXESpace] ${this.sessions.size} live terminals and none reclaimable; starting anyway`)
      return
    }

    const paneId = oldest.paneId
    this.stop({ paneId })
    // Synthetic exit so the pane can explain itself rather than looking crashed.
    this.emitExit({ paneId, exitCode: null })
  }

  /** Live sessions and how many run an agent, for the diagnostics panel (B8.3). */
  counts(): { running: number; agents: number } {
    let agents = 0; for (const session of this.sessions.values()) if (session.agentCommand) agents++
    return { running: this.sessions.size, agents }
  }
  /** Sessions running with no view attached — surfaced in the status bar. */
  countDetached(): number {
    let total = 0; for (const session of this.sessions.values()) if (!session.attached && !session.parked) total++; return total
  }
  /** Live foreground process or launched executable of a pane, for approval requester labels (OXE-293). */
  foregroundProcess(paneId: string): string | undefined {
    const s = this.sessions.get(paneId); if (!s) return undefined
    let live = ''; try { live = s.pty.process } catch { /* exited or unavailable */ }
    return live?.trim() || s.agentCommand?.trim() || s.executable?.trim() || undefined
  }
}

/** Windows PATH and PATHEXT resolution, with this file's existence probe (see terminal/executable.ts). */
export function resolveExecutable(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveWithProbe(executable, env, platform, existsSync)
}
