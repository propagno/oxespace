import { defaultSplitShellProfileId } from './shell-profile.defaults'
import { recordRuntime } from './runtime-diagnostics'
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import { spawn } from 'node-pty'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, delimiter, extname, join } from 'node:path'
import type { AppDatabase } from '../db/index'
import { terminatePty } from '../utils/process-tree'
import { getRtkService, type RtkService } from './rtk.service'
import { PtyInputQueue } from './pty-input-queue'
import { PtyOutputBatcher } from './pty-output-batcher'
import { PtyRingBuffer } from './pty-ring-buffer'
import { resumeCommand, type PaneResumeRecord, type PaneSessionSource } from './agent-state/pane-sessions'
import { mainMessage } from '../../../shared/messages'
import { claudeSessionToAssign, failedToLoadStatus, planPaneResume, RESUME_LOAD_MS, startedFreshStatus } from './agent-state/pane-resume'
import { nativeSessionExists, type NativeSessionRoots } from './agent-state/native-session-files'
import { PtyModeTracker } from './pty-mode-tracker'
import { DA1_CARRY_MS, DA1_REPLY, Da1Filter, stripDa1 } from './pty-da1'
import type { TerminalActivityEvent, TerminalAttachInput, TerminalAttachResult, TerminalDataEvent, TerminalExitEvent, TerminalResizeInput, TerminalStartInput, TerminalStatusResult, TerminalStopInput, TerminalWriteInput, PaneAgentResume, PaneAgentSession } from '../../../shared/types/ipc'
import { assertProviderAllowed, inheritedEnvironment } from './policy'
import { recordIncident } from './diagnostics/incident-sink'

const resolvedExecutableCache = new Map<string, string>()
/** What the system ConPTY wrote first: clear, reset attributes, home. The bundled one writes none of it (B13). */
export const CONPTY_START_SCREEN = '\x1b[2J\x1b[m\x1b[H'

interface PtyModule {
  spawn(file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions): IPty
}

interface TerminalManagerOptions {
  pty?: PtyModule
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  userDataPath?: string
  emitData?: (event: TerminalDataEvent) => void
  emitExit?: (event: TerminalExitEvent) => void
  emitActivity?: (event: TerminalActivityEvent) => void
  ringCapacityBytes?: number
  prepareLaunch?: (input: { paneId: string; workspaceId: string; cwd: string; signal: AbortSignal }) => Promise<Record<string, string>>
  onLaunchExit?: (paneId: string) => void
  executionEnvironment?: (input: { paneId: string; workspaceId: string; cwd: string }) => Record<string, string>
  /** MCP launch arguments for an agent CLI, and the variables those arguments refer to. */
  agentMcpArgs?: (executable: string, args: string[], workspaceId: string) => { args: string[]; env?: Record<string, string> } | Promise<{ args: string[]; env?: Record<string, string> }>
  isManagedPane?: (paneId: string) => boolean
  /** Main-process-registered container shells (`oxequery-shell:*`); the renderer never supplies the command. */
  oxeQueryShell?: (paneId: string) => { file: string; args: string[] } | undefined
  /** Sees every terminal's lifecycle and output, e.g. to read what an agent shows on screen. */
  observer?: TerminalObserver
  /** The agent session recorded for a pane, answered on its first start in this app run only (see PaneAgentSessions). */
  resumeSession?: (paneId: string, wanted: boolean, again?: boolean) => PaneResumeRecord | null
  /** Forgets the pane's recorded session (a restart with `resume: false`). */
  clearSession?: (paneId: string) => void
  /** The pane's current agent session and where it came from (Terminal details, S2). */
  currentSession?: (paneId: string) => { agent: 'claude' | 'codex'; sessionId: string; source: PaneSessionSource } | null
  /** Records the session id main gave a Claude Code it started (`--session-id`), as the hooks would. */
  assignSession?: (paneId: string, agent: 'claude', sessionId: string) => void
  /** Where the providers keep their sessions; the user's own folders by default. For tests. */
  nativeSessionRoots?: NativeSessionRoots
}

export interface TerminalObserver {
  start(paneId: string, workspaceId: string, cols: number, rows: number, command: string | null): void
  output(paneId: string, data: string): void
  resize(paneId: string, cols: number, rows: number): void
  exit(paneId: string): void
}

export interface ManagedTerminalStart extends TerminalStartInput {
  launch?: { executable: string; args: string[] }
  requireCwd?: string
  /** B17 · A restart asks for the pane's recorded session again, past the once-per-run answer. */
  resumeAgain?: boolean
}

interface TerminalSession {
  sessionId: string
  launchDirectory: string
  executable: string
  startedAt: number
  paneId: string
  workspaceId: string
  pty: IPty
  agentCommand?: string
  disableRtk?: boolean
  /** Whether the start that made this process wanted the agent's session back (a restart asks the same). */
  resumeAgent?: boolean
  /** B17 · The native session this process was started to resume, if any. */
  resumed?: { agent: 'claude' | 'codex'; sessionId: string }
  inputQueue: PtyInputQueue
  outputBatcher: PtyOutputBatcher
  /** Recent output, so a re-mounted view is restored without a respawn. */
  ring: PtyRingBuffer
  /** DEC private modes, so a re-mounted view lands in the right screen. */
  modes: PtyModeTracker
  /** True while a terminal view is rendering this session. */
  attached: boolean
  /**
   * True only between a view's attach() and its detach(). `attached` starts true so the first prompt is not held
   * back, but a pane started with no view never attaches; then main answers DA1 itself (see pty-da1.ts).
   */
  viewAttached: boolean
  da1: Da1Filter
  da1Timer: ReturnType<typeof setTimeout> | null
  lastActivityAt: number
  /** Last size the view reported; used for the alt-screen redraw nudge. */
  cols: number
  rows: number
  activityNotifiedAt: number
}

/**
 * A session whose process died while no view was attached. Without this the
 * pane would come back as a fresh shell and the user would never see why their
 * agent stopped.
 */
interface ExitedSession {
  exitCode: number | null
  exitedAt: number
  ring: PtyRingBuffer
  modes: PtyModeTracker
}

const ACTIVITY_THROTTLE_MS = 1000
const EXITED_SESSION_LIMIT = 32
const EXITED_SESSION_TTL_MS = 30 * 60 * 1000

/**
 * Safety valve now that leaving a workspace no longer stops its shells. Each
 * live PTY is a real OS process (~30-60 MB for PowerShell), so an unbounded
 * count would eventually matter on a long session.
 */
const MAX_LIVE_PTYS = 24
/** A session must be quiet this long before it is considered reclaimable. */
const RECLAIM_IDLE_MS = 30_000
/** How long a terminal waits for RTK to be ready before it starts without it. */
const RTK_START_BUDGET_MS = 3_000

interface TerminalLaunchContextRow {
  pane_root_path: string | null
  workspace_root_path: string
  shell_profile_id: string
  shell_profile_name: string | null
  shell_executable: string | null
  shell_args_json: string | null
}

export class TerminalManager {
  private readonly starting = new Map<string, Promise<void>>()
  private readonly launchControllers = new Map<string, AbortController>()
  private readonly prepareLaunch?: TerminalManagerOptions['prepareLaunch']
  private readonly onLaunchExit?: TerminalManagerOptions['onLaunchExit']
  private readonly executionEnvironment?: TerminalManagerOptions['executionEnvironment']
  private readonly agentMcpArgs?: TerminalManagerOptions['agentMcpArgs']
  private readonly isManagedPane?: TerminalManagerOptions['isManagedPane']
  private readonly oxeQueryShell?: TerminalManagerOptions['oxeQueryShell']
  private readonly observer?: TerminalObserver
  private readonly resumeSession?: TerminalManagerOptions['resumeSession']
  private readonly assignSession?: TerminalManagerOptions['assignSession']
  private readonly clearSession?: TerminalManagerOptions['clearSession']
  private readonly currentSession?: TerminalManagerOptions['currentSession']
  private readonly nativeSessionRoots?: NativeSessionRoots
  /** B17 · What each pane's first start in this run did with its agent's session, for terminal.status. */
  private readonly agentResumes = new Map<string, PaneAgentResume>()
  /** B17 · Panes whose resumed process exited within RESUME_LOAD_MS: their next start is fresh (failedToLoad). */
  private readonly failedResumes = new Map<string, { agent: 'claude' | 'codex'; sessionId: string }>()
  /** How each pane last started, so a restart can bring back a pane whose process exited by itself. */
  private readonly lastStarts = new Map<string, Pick<TerminalSession, 'workspaceId' | 'agentCommand' | 'disableRtk' | 'cols' | 'rows' | 'resumeAgent'>>()
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly pty: PtyModule
  private readonly launchContextStatement: ReturnType<AppDatabase['prepare']>
  private readonly workspaceExistsStatement: ReturnType<AppDatabase['prepare']>
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly emitData: (event: TerminalDataEvent) => void
  private readonly emitExit: (event: TerminalExitEvent) => void
  private readonly emitActivity: (event: TerminalActivityEvent) => void
  private readonly rtkService: RtkService
  private readonly ringCapacityBytes?: number
  private readonly exitedSessions = new Map<string, ExitedSession>()
  private readonly outputListeners = new Set<(paneId: string) => void>()

  constructor(private readonly db: AppDatabase, options: TerminalManagerOptions = {}) {
    this.prepareLaunch = options.prepareLaunch
    this.onLaunchExit = options.onLaunchExit
    this.executionEnvironment = options.executionEnvironment
    this.agentMcpArgs = options.agentMcpArgs
    this.isManagedPane = options.isManagedPane
    this.oxeQueryShell = options.oxeQueryShell
    this.observer = options.observer
    this.resumeSession = options.resumeSession
    this.assignSession = options.assignSession
    this.clearSession = options.clearSession
    this.currentSession = options.currentSession
    this.nativeSessionRoots = options.nativeSessionRoots
    this.pty = options.pty ?? { spawn }
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    // Terminal startup needs one pane, one root and one shell profile. Mapping
    // the complete workspace for every concurrently starting pane produced an
    // avoidable N×N path on large layouts.
    this.launchContextStatement = db.prepare(`
      SELECT
        p.root_path AS pane_root_path,
        w.root_path AS workspace_root_path,
        COALESCE(p.shell_profile_id, w.default_shell_profile_id) AS shell_profile_id,
        s.name AS shell_profile_name,
        s.executable AS shell_executable,
        s.args_json AS shell_args_json
      FROM panes p
      JOIN workspaces w ON w.id = p.workspace_id
      LEFT JOIN shell_profiles s
        ON s.id = COALESCE(p.shell_profile_id, w.default_shell_profile_id)
      WHERE p.id = @paneId AND w.id = @workspaceId
      LIMIT 1
    `)
    this.workspaceExistsStatement = db.prepare('SELECT 1 AS found FROM workspaces WHERE id = ? LIMIT 1')
    this.emitData = options.emitData ?? (() => undefined)
    this.emitExit = options.emitExit ?? (() => undefined)
    this.emitActivity = options.emitActivity ?? (() => undefined)
    this.ringCapacityBytes = options.ringCapacityBytes

    // In production, app.getPath is available via electron.
    // In tests, we pass userDataPath explicitly to avoid depending on electron.app.
    const userDataPath = options.userDataPath ?? require('electron').app?.getPath('userData') ?? ''
    this.rtkService = getRtkService(userDataPath)
  }

  async start(input: ManagedTerminalStart): Promise<void> {
    const pending = this.starting.get(input.paneId)
    if (pending) return pending
    const controller = new AbortController()
    this.launchControllers.set(input.paneId, controller)
    const task = this.startOnce(input, controller.signal).finally(() => {
      this.starting.delete(input.paneId)
      this.launchControllers.delete(input.paneId)
    })
    this.starting.set(input.paneId, task)
    return task
  }

  private async startOnce(input: ManagedTerminalStart, signal: AbortSignal): Promise<void> {
    if (this.sessions.has(input.paneId)) return
    if (!input.launch && this.isManagedPane?.(input.paneId)) throw new Error('Delegated terminal is managed by its task. Use Retry in Workspace settings > Agent delegation.')

    const threadShell = /^thread-shell:([a-f0-9-]{36}):([1-8])$/i.exec(input.paneId)
    let launch = this.launchContextStatement.get({
      paneId: input.paneId,
      workspaceId: input.workspaceId
    }) as TerminalLaunchContextRow | undefined
    if (threadShell) {
      if (input.agentCommand || input.launch || input.initialPrompt || input.agentArgs?.length) throw Error('Project terminals start an interactive shell. Run agent commands inside the terminal.')
      const row = this.db.prepare('SELECT data_json FROM conversation_threads WHERE id = ? AND workspace_id = ?').get(threadShell[1], input.workspaceId) as { data_json: string } | undefined
      if (!row) throw Error('Thread terminal owner is unavailable')
      const thread = JSON.parse(row.data_json) as { rootPath: string; projectId: string }
      const context = this.db.prepare('SELECT 1 FROM thread_project_contexts c JOIN thread_projects p ON p.id = c.project_id WHERE p.hidden = 0 AND c.project_id = ? AND c.root_path = ?').get(thread.projectId, thread.rootPath)
      if (!context || !existsSync(thread.rootPath)) throw Error('Project directory is unavailable. Relink the project first.')
      const shell = this.db.prepare('SELECT id, name, executable, args_json FROM shell_profiles WHERE id = ?').get(defaultSplitShellProfileId(this.platform)) as { id: string; name: string; executable: string; args_json: string } | undefined
      if (!shell) throw Error('Configure a shell profile in Settings first.')
      launch = { pane_root_path: thread.rootPath, workspace_root_path: thread.rootPath, shell_profile_id: shell.id, shell_profile_name: shell.name, shell_executable: shell.executable, shell_args_json: shell.args_json }
    }
    const oxeShell = this.oxeQueryShell?.(input.paneId)
    if (oxeShell) {
      if (input.agentCommand || input.launch || input.initialPrompt || input.agentArgs?.length) throw Error('Container shells start the registered command only.')
      const home = homedir()
      launch = { pane_root_path: home, workspace_root_path: home, shell_profile_id: 'oxequery-shell', shell_profile_name: 'Container shell', shell_executable: oxeShell.file, shell_args_json: JSON.stringify(oxeShell.args) } as TerminalLaunchContextRow
    }
    if (!launch) {
      const workspaceExists = this.workspaceExistsStatement.get(input.workspaceId)
      if (!workspaceExists) throw new Error(`Workspace ${input.workspaceId} not found`)
      throw new Error(`Pane ${input.paneId} not found`)
    }
    if (!launch.shell_executable || !launch.shell_profile_name || launch.shell_args_json === null) {
      throw new Error(`Shell profile ${launch.shell_profile_id} not found`)
    }
    const shellArgs = JSON.parse(launch.shell_args_json) as string[]

    // Pane-level rootPath overrides the workspace root — used by git worktree panes.
    const cwd = launch.pane_root_path && existsSync(launch.pane_root_path)
      ? launch.pane_root_path
      : launch.workspace_root_path
    if (input.requireCwd && (cwd !== input.requireCwd || !existsSync(input.requireCwd))) throw new Error('Delegated worktree is missing; refusing workspace-root fallback')

    // B17 · On the pane's first start in this app run, go back to its agent's native session (herdr's native
    // session restore), with arguments main builds from the recorded id. A shell pane whose agent was typed by hand
    // starts the provider itself rather than typing into the shell.
    const consulted = !threadShell && !oxeShell && !input.launch ? this.resumeSession?.(input.paneId, input.resumeAgent === true, input.resumeAgain === true) ?? null : null
    // A resume whose process exited at once could not load its session: this start is fresh, never another try.
    const failed = this.failedResumes.get(input.paneId)
    this.failedResumes.delete(input.paneId)
    if (failed) this.clearSession?.(input.paneId)
    const plan = await planPaneResume(failed ? null : consulted, input, cwd, {
      allowed: agent => { try { assertProviderAllowed(agent, launch.workspace_root_path); return true } catch { return false } },
      exists: (agent, sessionId, dir) => nativeSessionExists(agent, sessionId, dir, this.nativeSessionRoots)
    })
    const status = failed ? failedToLoadStatus(failed) : plan.status
    if (status) this.agentResumes.set(input.paneId, status)
    const resumed = plan.status?.outcome === 'resumed' ? { agent: plan.status.agent, sessionId: plan.status.sessionId } : undefined
    const agentCommand = plan.agentCommand

    // Claude Code and Codex start only where the policy lets them; a plain shell is never blocked.
    const agentName = (input.launch?.executable ?? agentCommand?.trim().split(/\s+/)[0] ?? '').replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
    if (agentName === 'claude' || agentName === 'codex') assertProviderAllowed(agentName, launch.workspace_root_path)
    const agentParts = agentCommand ? agentCommand.trim().split(/\s+/) : null
    const executable = input.launch ? resolveExecutable(input.launch.executable, this.env, this.platform) : agentParts
      ? resolveExecutable(agentParts[0], this.env, this.platform)
      : resolveExecutable(launch.shell_executable, this.env, this.platform)
    let args = input.launch ? input.launch.args : agentParts
      ? [...agentParts.slice(1), ...(input.agentArgs ?? []), ...plan.extraArgs]
      : [...shellArgs, ...(input.agentArgs ?? [])]
    // A fresh Claude conversation gets a session id main knows, so the pane can resume it without the hooks.
    const assigned = this.assignSession && !threadShell && !oxeShell && !input.launch && !plan.extraArgs.length ? claudeSessionToAssign(agentParts?.[0] ?? launch.shell_executable, args) : null
    if (assigned) { args = ['--session-id', assigned, ...args]; this.assignSession?.(input.paneId, 'claude', assigned) }
    let mcpEnv: Record<string, string> = {}
    if (!input.launch && this.agentMcpArgs) ({ args, env: mcpEnv = {} } = await this.agentMcpArgs(executable, args, input.workspaceId))

    // Provider CLIs get the environment without secret-looking variables the provider does not need (S7). Plain
    // shells and other agents keep the full environment: that is the person's own shell.
    const baseEnv = agentName === 'claude' || agentName === 'codex' ? inheritedEnvironment(agentName, launch.workspace_root_path, this.env) : this.env
    let finalEnv: Record<string, string> = {
      ...baseEnv,
      // Force CLIs to use dark-mode syntax highlighting since OXESpace uses a dark terminal theme
      COLORFGBG: '15;0',
      COLORTERM: 'truecolor',
      GLAMOUR_STYLE: 'dark',
      BAT_THEME: 'TwoDark'
    }
    if (this.executionEnvironment && !threadShell && !oxeShell) finalEnv = { ...finalEnv, ...this.executionEnvironment({ paneId: input.paneId, workspaceId: input.workspaceId, cwd }) }
    finalEnv = { ...finalEnv, ...mcpEnv }
    // Optional launch integrations only return environment; provider failures
    // never prevent the shell/agent from starting or touch its output stream.
    if (this.prepareLaunch && !threadShell && !oxeShell) {
      const integration = new AbortController()
      const cancel = (): void => integration.abort()
      signal.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(cancel, 3000)
      const integrationSignal = integration.signal
      let onAbort: (() => void) | undefined
      try {
        const env = await Promise.race([
          this.prepareLaunch({ paneId: input.paneId, workspaceId: input.workspaceId, cwd, signal: integrationSignal }),
          new Promise<never>((_, reject) => {
            onAbort = () => reject(new Error('Optional launch integration cancelled'))
            integrationSignal.addEventListener('abort', onAbort, { once: true })
          })
        ])
        finalEnv = { ...finalEnv, ...env }
      }
      catch { /* Optional integration unavailable. */ }
      finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', cancel)
        if (onAbort) integrationSignal.removeEventListener('abort', onAbort)
      }
    }
    
    if (!input.disableRtk) {
      // The first launch downloads RTK. A slow or stalled connection must not hold the
      // shell back: after the budget the terminal starts without it (the download goes on
      // in the background and the next terminal picks it up).
      let budget: ReturnType<typeof setTimeout> | undefined
      try {
        const rtkBin = await Promise.race([
          this.rtkService.ensureRtk(),
          new Promise<null>((resolveBudget) => { budget = setTimeout(() => resolveBudget(null), RTK_START_BUDGET_MS) })
        ])
        if (rtkBin) finalEnv = { ...finalEnv, PATH: `${rtkBin}${delimiter}${finalEnv.PATH ?? ''}` }
      } catch (err) {
        // Fall back gracefully if download fails
      } finally {
        if (budget) clearTimeout(budget)
      }
    } else {
      finalEnv = { ...finalEnv, RTK_DISABLED: '1' }
    }

    // An app started with ELECTRON_RUN_AS_NODE must not hand it to its shells: any Electron CLI run there (code) breaks.
    for (const key of Object.keys(finalEnv)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete finalEnv[key]

    // Spawn at the view's real geometry. Starting at 80x24 and resizing after
    // the fact makes the app reflow once, which reads as a flash on open.
    const cols = clampDimension(input.cols, 80)
    const rows = clampDimension(input.rows, 24)

    let ptyProcess: IPty
    if (signal.aborted) { this.notifyLaunchExit(input.paneId); return }
    try {
      ptyProcess = this.pty.spawn(executable, args, {
        name: 'xterm-256color',
        cwd,
        cols,
        rows,
        env: finalEnv,
        // Windows: the ConPTY that node-pty ships. Its kill never forks a helper; the system ConPTY's kill does
        // child_process.fork(), which needs RunAsNode and would start a second OXESpace once that fuse is off.
        ...(this.platform === 'win32' ? { useConptyDll: true } : {})
      })
    } catch (error) {
      recordRuntime('process-error', { pane: input.paneId, executable, state: 'launch-failed' })
      this.notifyLaunchExit(input.paneId)
      if (agentCommand || input.launch) {
        recordIncident('incident.agent.startFailed', agentName || 'agent')
        throw new Error(`Unable to start agent "${input.launch?.executable ?? agentCommand}". ${toMessage(error)}`, { cause: error })
      }
      throw new Error(`Unable to start ${launch.shell_profile_name}. Check Settings > Shell profiles executable "${launch.shell_executable}". ${toMessage(error)}`, { cause: error })
    }

    // A pane that is starting fresh must not inherit a dead session's output.
    recordRuntime('process-start', { pane: input.paneId, pid: ptyProcess.pid, parentPid: process.pid, executable, kind: input.paneId.startsWith('thread-shell:') ? 'thread' : 'code' })
    this.exitedSessions.delete(input.paneId)
    this.reclaimIdleSession()

    this.lastStarts.set(input.paneId, { workspaceId: input.workspaceId, agentCommand: input.agentCommand, disableRtk: input.disableRtk, cols, rows, resumeAgent: input.resumeAgent })
    this.sessions.set(input.paneId, {
      sessionId: randomUUID(),
      launchDirectory: cwd,
      executable,
      startedAt: Date.now(),
      paneId: input.paneId,
      workspaceId: input.workspaceId,
      pty: ptyProcess,
      agentCommand: input.agentCommand,
      disableRtk: input.disableRtk,
      resumeAgent: input.resumeAgent,
      resumed,
      inputQueue: new PtyInputQueue(ptyProcess),
      outputBatcher: new PtyOutputBatcher(input.paneId, (event) => this.onBatch(event)),
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
    if (this.platform === 'win32') this.sessions.get(input.paneId)?.outputBatcher.push(CONPTY_START_SCREEN)
    this.observer?.start(input.paneId, input.workspaceId, cols, rows, input.launch ? [input.launch.executable, ...input.launch.args].join(' ') : agentCommand ?? executable)
    ptyProcess.onData((data) => {
      const session = this.sessions.get(input.paneId)
      if (session) this.receive(session, data)
      this.observer?.output(input.paneId, data)
    })
    ptyProcess.onExit(({ exitCode }) => {
      recordRuntime('process-exit', { pane: input.paneId, pid: ptyProcess.pid, exitCode })
      const session = this.sessions.get(input.paneId)
      if (session?.pty !== ptyProcess) return // A late exit cannot remove a restarted process.
      if (session) this.releaseDa1(session)
      session?.outputBatcher.flush()
      if (session) this.rememberExit(session, exitCode)
      // A resume that ends at once could not load its session; forget it so it cannot loop resume → exit → resume.
      if (session?.resumed && Date.now() - session.startedAt < RESUME_LOAD_MS) {
        this.failedResumes.set(input.paneId, session.resumed)
        this.clearSession?.(input.paneId)
      }
      this.sessions.delete(input.paneId)
      this.notifyLaunchExit(input.paneId)
      this.observer?.exit(input.paneId)
      this.emitExit({ paneId: input.paneId, exitCode })
    })

    const typed = input.initialPrompt
    if (typed) {
      let sent = false
      ptyProcess.onData(() => {
        if (sent) return
        sent = true
        setTimeout(() => {
          if (this.sessions.has(input.paneId)) {
            this.sessions.get(input.paneId)?.inputQueue.enqueue(typed + '\r')
          }
        }, 800)
      })
    }

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
    const unchanged = session.cols === input.cols && session.rows === input.rows
    session.cols = input.cols
    session.rows = input.rows
    this.observer?.resize(input.paneId, input.cols, input.rows)
    // A restored full-screen TUI needs a fresh frame after the renderer has
    // installed its alternate buffer. A same-size resize is that handshake.
    if (unchanged && session.attached && session.modes.altScreen) this.nudgeRedraw(session)
    else session.pty.resize(input.cols, input.rows)
  }

  /**
   * PTY output on its way to the batcher. A DA1 query that no view will answer is answered here and removed from the
   * stream. Main runs this and attach()/detach() on one thread, so the choice is made once per query and holds:
   * - no view at that moment: the query never reaches the ring or the IPC stream, so a view attaching while main's
   *   reply is still queued (or any later replay) cannot answer it a second time;
   * - a view attached: the query goes to it live and its xterm answers; main sends nothing. detach() flushes the
   *   batcher first, so the view still gets it; a view torn down before parsing it leaves ConPTY to time out, never
   *   two replies.
   */
  private receive(session: TerminalSession, chunk: string): void {
    const { data, answered } = session.da1.filter(chunk, !session.viewAttached)
    for (let i = 0; i < answered; i++) void session.inputQueue.enqueue(DA1_REPLY)
    if (data) session.outputBatcher.push(data)
    if (session.da1Timer) { clearTimeout(session.da1Timer); session.da1Timer = null }
    if (session.da1.holding) {
      session.da1Timer = setTimeout(() => {
        session.da1Timer = null
        if (this.sessions.get(session.paneId) === session) session.outputBatcher.push(session.da1.release())
      }, DA1_CARRY_MS)
    }
  }

  private releaseDa1(session: TerminalSession): void {
    if (session.da1Timer) { clearTimeout(session.da1Timer); session.da1Timer = null }
    const held = session.da1.release()
    if (held) session.outputBatcher.push(held)
  }

  /**
   * Route batched output. Everything is retained; only an attached view gets
   * the bytes over IPC. Previously every chunk was broadcast to every window
   * and dropped in the preload when nobody was listening.
   */
  private onBatch(event: TerminalDataEvent): void {
    const session = this.sessions.get(event.paneId)
    if (!session) return

    // A replayed DA1 would be answered again by the re-mounted view and typed into the shell as `?1;2c`. Whoever was
    // going to answer it has (main or the live view), so the ring keeps none. receive() never splits a query.
    session.ring.push(stripDa1(event.data))
    session.modes.consume(event.data)
    session.lastActivityAt = Date.now()
    for (const listener of this.outputListeners) { try { listener(event.paneId) } catch { /* a reader never breaks the pane */ } }

    if (session.attached) {
      this.emitData(event)
      return
    }

    // Detached: no payload crosses the boundary, but the UI still needs to know
    // a background agent is working (sidebar dots, notifications).
    if (session.lastActivityAt - session.activityNotifiedAt < ACTIVITY_THROTTLE_MS) return
    session.activityNotifiedAt = session.lastActivityAt
    this.emitActivity({ paneId: event.paneId, at: session.lastActivityAt, bytes: event.data.length })
  }

  /**
   * Bind a terminal view to a session and hand back what it needs to render.
   *
   * Ordering matters: the caller subscribes to `onData` BEFORE calling this,
   * queueing what arrives. This body runs in one synchronous tick — flush,
   * read the ring, mark attached — so no chunk can slip between the snapshot
   * and the live stream, and none is delivered twice.
   */
  attach(input: TerminalAttachInput): TerminalAttachResult {
    const session = this.sessions.get(input.paneId)
    if (!session) {
      const exited = this.takeExited(input.paneId)
      if (!exited) {
        return { running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }
      }
      return {
        running: false,
        seq: exited.ring.seq,
        prologue: exited.modes.prologue(),
        replay: exited.ring.snapshot(),
        truncated: false,
        altScreen: false,
        exit: { exitCode: exited.exitCode, at: exited.exitedAt }
      }
    }

    session.outputBatcher.flush()
    const slice = session.ring.since(input.sinceSeq ?? 0)
    session.attached = true
    session.viewAttached = true

    // On the alternate screen the retained bytes cannot be trusted: if the
    // `\x1b[?1049h` fell off the ring head, replaying paints TUI content onto
    // the normal buffer. Ask the app for a correct frame instead.
    const altScreen = session.modes.altScreen
    return {
      running: true,
      seq: session.ring.seq,
      prologue: session.modes.prologue(),
      replay: altScreen ? '' : slice.data,
      truncated: slice.truncated,
      altScreen
    }
  }

  /**
   * Main-process readers that are not views (the remote gateway) hear that a pane printed something, then read it
   * with `readSince`. Nothing is attached, so the pane and its views are unaffected.
   */
  onOutput(listener: (paneId: string) => void): () => void {
    this.outputListeners.add(listener)
    return () => { this.outputListeners.delete(listener) }
  }

  /** Output after `seq` in the ring, without attaching. `session` changes when the pane's process is replaced. */
  readSince(paneId: string, seq: number): { session: string; seq: number; data: string; truncated: boolean } | null {
    const session = this.sessions.get(paneId)
    if (!session) return null
    session.outputBatcher.flush()
    return { session: session.sessionId, seq: session.ring.seq, ...session.ring.since(seq) }
  }

  /** Unbind the view. The process keeps running and its output keeps accruing. */
  detach(input: TerminalStopInput): void {
    const session = this.sessions.get(input.paneId)
    if (!session) return
    session.outputBatcher.flush()
    session.attached = false
    session.viewAttached = false
  }

  /**
   * The retained output for a reader that is not a view (an agent through MCP).
   * Nothing is attached or consumed, so the pane and its views are unaffected.
   */
  peek(paneId: string): { running: boolean; data: string; altScreen: boolean } | null {
    const session = this.sessions.get(paneId)
    if (!session) return null
    return { running: true, data: session.ring.snapshot(), altScreen: session.modes.altScreen }
  }

  status(paneId: string): TerminalStatusResult {
    const session = this.sessions.get(paneId)
    const resumed = this.agentResumes.get(paneId)
    const agentResume = resumed ? { agentResume: resumed } : {}
    const agentSession = this.agentSessionOf(paneId, session?.executable, resumed)
    if (!session) return { running: false, seq: 0, altScreen: false, ...agentResume, ...agentSession }
    return { running: true, seq: session.ring.seq, altScreen: session.modes.altScreen, sessionId: session.sessionId, launchDirectory: session.launchDirectory, executable: session.executable, pid: session.pty.pid, startedAt: session.startedAt, ...agentResume, ...agentSession }
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
   * Make a full-screen app repaint by bouncing the terminal size. Every TUI
   * redraws its whole viewport on SIGWINCH/ConPTY resize, which yields a
   * correct frame rather than one reconstructed from bytes.
   */
  private nudgeRedraw(session: TerminalSession): void {
    const { cols, rows } = session
    if (rows <= 1) return
    try {
      session.pty.resize(cols, rows - 1)
      setTimeout(() => {
        if (this.sessions.get(session.paneId) !== session) return
        try {
          session.pty.resize(cols, rows)
        } catch { /* process exited between ticks */ }
      }, 0)
    } catch { /* process exited; attach still returns cleanly */ }
  }

  private rememberExit(session: TerminalSession, exitCode: number | null): void {
    this.exitedSessions.set(session.paneId, {
      exitCode,
      exitedAt: Date.now(),
      ring: session.ring,
      modes: session.modes
    })
    // Bound both ways: oldest-first eviction plus a TTL, so a long session
    // cannot accumulate dead panes indefinitely.
    const cutoff = Date.now() - EXITED_SESSION_TTL_MS
    for (const [paneId, entry] of this.exitedSessions) {
      if (entry.exitedAt < cutoff) this.exitedSessions.delete(paneId)
    }
    while (this.exitedSessions.size > EXITED_SESSION_LIMIT) {
      const oldest = this.exitedSessions.keys().next().value
      if (oldest === undefined) break
      this.exitedSessions.delete(oldest)
    }
  }

  private takeExited(paneId: string): ExitedSession | undefined {
    const entry = this.exitedSessions.get(paneId)
    if (!entry) return undefined
    if (Date.now() - entry.exitedAt > EXITED_SESSION_TTL_MS) {
      this.exitedSessions.delete(paneId)
      return undefined
    }
    return entry
  }

  stop(input: TerminalStopInput): void {
    this.launchControllers.get(input.paneId)?.abort()
    const session = this.sessions.get(input.paneId)
    if (!session) return
    recordRuntime('process-stop', { pane: input.paneId, pid: session.pty.pid })
    // Flush before disposing: the batcher discards `pending`, so an exiting
    // process used to lose its last words (often the error that killed it).
    this.releaseDa1(session)
    session.outputBatcher.flush()
    session.inputQueue.dispose()
    session.outputBatcher.dispose()
    // The whole tree, not just the shell: an MCP server or `npm run dev` it started must not outlive the pane (BE-M-08).
    void terminatePty(session.pty)
    this.sessions.delete(input.paneId)
    this.notifyLaunchExit(input.paneId)
    this.observer?.exit(input.paneId)
    // An explicit stop is not a crash to be explained on return.
    this.exitedSessions.delete(input.paneId)
  }
  private notifyLaunchExit(paneId: string): void {
    try { this.onLaunchExit?.(paneId) } catch { /* Optional integrations cannot affect PTY cleanup. */ }
  }

  async restart(input: TerminalStopInput): Promise<void> {
    // A pane whose process exited by itself restarts as it last started; a pane that was stopped stays stopped.
    const session = this.sessions.get(input.paneId) ?? (this.takeExited(input.paneId) ? this.lastStarts.get(input.paneId) : undefined)
    if (!session) return
    const { workspaceId, agentCommand, disableRtk, cols, rows, resumeAgent } = session
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
    await this.start({ paneId: input.paneId, workspaceId, agentCommand, disableRtk, cols, rows, resumeAgent: fresh ? undefined : resumeAgent, resumeAgain: !fresh })
    if (fresh) this.agentResumes.set(input.paneId, fresh)
  }

  stopWorkspace(workspaceId: string): void {
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) {
        this.stop({ paneId: session.paneId })
      }
    }
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

  hasSession(paneId: string): boolean {
    return this.sessions.has(paneId)
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
      if (session.attached) continue
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
    let agents = 0
    for (const session of this.sessions.values()) if (session.agentCommand) agents++
    return { running: this.sessions.size, agents }
  }

  /** Sessions running with no view attached — surfaced in the status bar. */
  countDetached(): number {
    let total = 0
    for (const session of this.sessions.values()) {
      if (!session.attached) total++
    }
    return total
  }
}

export function resolveExecutable(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== 'win32' || extname(executable)) return executable

  const pathValue = env.PATH ?? env.Path ?? env.path
  if (!pathValue) return executable
  const pathExtValue = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  const cacheKey = `${executable}\0${pathValue}\0${pathExtValue}`
  const cached = resolvedExecutableCache.get(cacheKey)
  if (cached) {
    if (existsSync(cached)) return cached
    resolvedExecutableCache.delete(cacheKey)
  }

  const pathExtensions = pathExtValue
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)

  const executableNames = pathExtensions.map((extension) => `${executable}${extension.toLowerCase()}`)
  executableNames.push(executable)

  if (executable.includes('\\') || executable.includes('/')) {
    const resolved = executableNames.find((candidate) => existsSync(candidate))
    if (resolved) resolvedExecutableCache.set(cacheKey, resolved)
    return resolved ?? executable
  }

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName)
      if (existsSync(candidate)) {
        resolvedExecutableCache.set(cacheKey, candidate)
        return candidate
      }
    }
  }

  return executable
}

/** Test-only: avoid positive executable resolutions leaking between cases. */
export function __resetExecutableCacheForTests(): void {
  resolvedExecutableCache.clear()
}

/** node-pty rejects non-positive or non-integer geometry. */
function clampDimension(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback
  return Math.min(1000, Math.floor(value))
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terminal process failed'
}
