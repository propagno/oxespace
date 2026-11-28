import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import { homedir } from 'node:os'
import type { AppDatabase } from '../../db/index'
import { mainMessage } from '../../../../shared/messages'
import { MainMessageError } from '../../ipc/main-message-error'
import type { PaneAgentResume, TerminalStartInput } from '../../../../shared/types/ipc'
import { defaultSplitShellProfileId, POSIX_SHELL_PROFILE_ID, WINDOWS_SHELL_PROFILE_ID } from '../shell-profile.defaults'
import { recordRuntime } from '../runtime-diagnostics'
import type { PtyInputQueue } from '../pty-input-queue'
import type { ClaudePermissionMode, PaneResumeRecord, PaneSessionSource, ResumableAgent } from '../agent-state/pane-sessions'
import { resumeBypassAllowed } from '../agent-state/resume-bypass-setting'
import { agentProgram, terminalAgentsFullAccess, withFullAccess } from '../agent-state/agent-full-access'
import { bypassWithheld, claudeSessionToAssign, failedToLoadStatus, permissionModeArgs, planPaneResume } from '../agent-state/pane-resume'
import { extractSessionFromCommandLine } from '../agent-state/pane-session-resolver'
import { nativeSessionExists, type NativeSessionRoots } from '../agent-state/native-session-files'
import { assertProviderAllowed, inheritedEnvironment } from '../policy'
import { recordIncident } from '../diagnostics/incident-sink'
import { windowsConptyForkOptions } from '../../workers/conptyProtections'
import { resolveExecutable } from './executable'

export interface PtyModule {
  spawn(file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions): IPty
}

/** The integrations a start asks, as the app hands them to TerminalManager. */
export interface SessionStartOptions {
  prepareLaunch?: (input: { paneId: string; workspaceId: string; cwd: string; signal: AbortSignal }) => Promise<Record<string, string>>
  executionEnvironment?: (input: { paneId: string; workspaceId: string; cwd: string }) => Record<string, string>
  grantProxy?: (origin: { paneId: string }) => { env: Record<string, string>; revoke: () => void }
  /** MCP launch arguments for an agent CLI, and the variables those arguments refer to. */
  agentMcpArgs?: (executable: string, args: string[], workspaceId: string) => { args: string[]; env?: Record<string, string> } | Promise<{ args: string[]; env?: Record<string, string> }>
  isManagedPane?: (paneId: string) => boolean
  /** Main-process-registered container shells (`oxequery-shell:*`); the renderer never supplies the command. */
  oxeQueryShell?: (paneId: string) => { file: string; args: string[] } | undefined
  /** OXE-447 · Main-process-registered remote SSH panes (`SshHostedPty`); skips local shell spawn. */
  remoteSshPane?: (paneId: string, geometry: { cols: number; rows: number }) => Promise<{ pty: IPty; cwd: string; label: string; command?: string } | undefined> | undefined
  /** The agent session recorded for a pane, answered on its first start in this app run only (see PaneAgentSessions). */
  resumeSession?: (paneId: string, wanted: boolean, again?: boolean) => PaneResumeRecord | null
  /** Forgets the pane's recorded session (a restart with `resume: false`). */
  clearSession?: (paneId: string) => void
  /** The pane's current agent session and where it came from (Terminal details, S2). */
  currentSession?: (paneId: string) => { agent: ResumableAgent; sessionId: string; source: PaneSessionSource; permissionMode?: ClaudePermissionMode } | null
  /** Records the session id main gave a provider it started (`--session-id` or explicit `--resume`/`--conversation`), as the hooks would. */
  assignSession?: (paneId: string, agent: ResumableAgent, sessionId: string) => void
  /** OXE-467 · Records a session learned from any live source (`launch`, `hook`, or `discovered`). */
  recordSession?: (paneId: string, agent: ResumableAgent, sessionId: string, source: Exclude<PaneSessionSource, 'recorded'>) => void
  /** OXE-467 · Session IDs currently owned by other panes, so auto-discovery keeps each pane isolated. */
  claimedSessions?: (excludePaneId?: string) => ReadonlySet<string>
  /** OXE-467 · Active agent detected by AgentStateService for a live pane. */
  paneAgent?: (paneId: string) => string | null
  /** OXE-367: whether a pane's working folder is there; a pane whose folder is gone is refused before any spawn. */
  rootExists?: (path: string) => boolean
  /** Where the providers keep their sessions; the user's own folders by default. For tests. */
  nativeSessionRoots?: NativeSessionRoots
}

export interface ManagedTerminalStart extends TerminalStartInput {
  launch?: { executable: string; args: string[] }
  requireCwd?: string
  /** B17 · A restart asks for the pane's recorded session again, past the once-per-run answer. */
  resumeAgain?: boolean
}

/** A process that just started, for the manager to keep as the pane's session. */
export interface StartedProcess {
  input: ManagedTerminalStart
  ptyProcess: IPty
  cwd: string
  executable: string
  cols: number
  rows: number
  resumed?: { agent: ResumableAgent; sessionId: string }
  /** OXE-467 · Explicit session ID parsed from launch args (`--resume`, `--conversation`, `codex resume`, `--session-id`). */
  explicitSession?: { agent: ResumableAgent; sessionId: string }
  revokeProxy?: () => void
  /** What the observer is told runs in the pane. */
  command: string
  /** OXE-447 · True when backed by a remote SSH shell (`SshHostedPty`). */
  remote?: boolean
}

export interface SessionStartHost extends SessionStartOptions {
  db: AppDatabase
  pty: PtyModule
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  exists: (path: string) => boolean
  sessions: ReadonlyMap<string, { inputQueue: PtyInputQueue }>
  agentResumes: Map<string, PaneAgentResume>
  takeFailedResume: (paneId: string) => { agent: ResumableAgent; sessionId: string } | undefined
  notifyLaunchExit: (paneId: string) => void
  /** Called in the same tick as the spawn, before anything else listens to the process. */
  started: (process: StartedProcess) => void
}

interface TerminalLaunchContextRow {
  pane_root_path: string | null
  workspace_root_path: string
  shell_profile_id: string
  shell_profile_name: string | null
  shell_executable: string | null
  shell_args_json: string | null
}

/** A pane's start: its shell or agent, what it resumes, its arguments and environment, and the spawn. */
export class SessionStarter {
  private readonly launchContextStatement: ReturnType<AppDatabase['prepare']>
  private readonly workspaceExistsStatement: ReturnType<AppDatabase['prepare']>

  constructor(private readonly host: SessionStartHost) {
    // Terminal startup needs one pane, one root and one shell profile. Mapping
    // the complete workspace for every concurrently starting pane produced an
    // avoidable N×N path on large layouts.
    this.launchContextStatement = host.db.prepare(`
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
    this.workspaceExistsStatement = host.db.prepare('SELECT 1 AS found FROM workspaces WHERE id = ? LIMIT 1')
  }

  async start(input: ManagedTerminalStart, signal: AbortSignal): Promise<void> {
    if (this.host.sessions.has(input.paneId)) return
    if (!input.launch && this.host.isManagedPane?.(input.paneId)) throw new Error('Delegated terminal is managed by its task. Use Retry in Workspace settings > Agent delegation.')

    if (this.host.remoteSshPane) {
      const cols = clampDimension(input.cols, 80)
      const rows = clampDimension(input.rows, 24)
      const remote = await this.host.remoteSshPane(input.paneId, { cols, rows })
      if (remote) {
        if (signal.aborted) {
          remote.pty.kill()
          this.host.notifyLaunchExit(input.paneId)
          return
        }
        recordRuntime('process-start', { pane: input.paneId, pid: remote.pty.pid, parentPid: process.pid, executable: remote.label, kind: 'code' })
        this.host.started({
          input,
          ptyProcess: remote.pty,
          cwd: remote.cwd,
          executable: remote.label,
          cols,
          rows,
          command: input.agentCommand ?? remote.command ?? remote.label,
          remote: true
        })
        return
      }
    }

    const threadShell = /^thread-shell:([a-f0-9-]{36}):([1-8])$/i.exec(input.paneId)
    let launch = this.launchContextStatement.get({
      paneId: input.paneId,
      workspaceId: input.workspaceId
    }) as TerminalLaunchContextRow | undefined
    if (threadShell) {
      if (input.agentCommand || input.launch || input.initialPrompt || input.agentArgs?.length) throw Error('Project terminals start an interactive shell. Run agent commands inside the terminal.')
      const row = this.host.db.prepare('SELECT data_json FROM conversation_threads WHERE id = ? AND workspace_id = ?').get(threadShell[1], input.workspaceId) as { data_json: string } | undefined
      if (!row) throw Error('Thread terminal owner is unavailable')
      const thread = JSON.parse(row.data_json) as { rootPath: string; projectId: string }
      const context = this.host.db.prepare('SELECT 1 FROM thread_project_contexts c JOIN thread_projects p ON p.id = c.project_id WHERE p.hidden = 0 AND c.project_id = ? AND c.root_path = ?').get(thread.projectId, thread.rootPath)
      if (!context || !this.host.exists(thread.rootPath)) throw Error('Project directory is unavailable. Relink the project first.')
      const shell = this.host.db.prepare('SELECT id, name, executable, args_json FROM shell_profiles WHERE id = ?').get(defaultSplitShellProfileId(this.host.platform)) as { id: string; name: string; executable: string; args_json: string } | undefined
      if (!shell) throw Error('Configure a shell profile in Settings first.')
      launch = { pane_root_path: thread.rootPath, workspace_root_path: thread.rootPath, shell_profile_id: shell.id, shell_profile_name: shell.name, shell_executable: shell.executable, shell_args_json: shell.args_json }
    }
    const oxeShell = this.host.oxeQueryShell?.(input.paneId)
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
    const cwd = launch.pane_root_path && this.host.exists(launch.pane_root_path)
      ? launch.pane_root_path
      : launch.workspace_root_path
    if (input.requireCwd && (cwd !== input.requireCwd || !this.host.exists(input.requireCwd))) throw new Error('Delegated worktree is missing; refusing workspace-root fallback')
    // OXE-367: a workspace whose folder was moved or deleted starts no PTY in nothing; the window offers Relink instead.
    if (this.host.rootExists && !this.host.rootExists(cwd)) throw new MainMessageError(mainMessage('workspace.root.notFound', { path: cwd }), `The folder ${cwd} does not exist`)

    // B17 · On the pane's first start in this app run, go back to its agent's native session (herdr's native
    // session restore), with arguments main builds from the recorded id. A shell pane whose agent was typed by hand
    // starts the provider itself rather than typing into the shell.
    const consulted = !threadShell && !oxeShell && !input.launch ? this.host.resumeSession?.(input.paneId, input.resumeAgent === true, input.resumeAgain === true) ?? null : null
    // A resume whose process exited at once could not load its session: this start is fresh, never another try.
    // Settings > Terminal: agents started here skip their permission prompts. The person's own setting, so a session
    // that skipped them comes back that way too (T54 asks for the person's setting, and this is one).
    const skipPrompts = terminalAgentsFullAccess(this.host.db)
    const allowBypass = skipPrompts || resumeBypassAllowed(this.host.db)
    const failed = this.host.takeFailedResume(input.paneId)
    if (failed) this.host.clearSession?.(input.paneId)
    const plan = await planPaneResume(failed ? null : consulted, input, cwd, {
      allowed: agent => { try { assertProviderAllowed(agent, launch.workspace_root_path); return true } catch { return false } },
      exists: (agent, sessionId, dir) => nativeSessionExists(agent, sessionId, dir, this.host.nativeSessionRoots),
      allowBypass
    })
    const status = failed ? failedToLoadStatus(failed) : plan.status
    if (status) this.host.agentResumes.set(input.paneId, status)
    const resumed = plan.status?.outcome === 'resumed' ? { agent: plan.status.agent, sessionId: plan.status.sessionId } : undefined
    const agentCommand = plan.agentCommand

    // Claude Code and Codex start only where the policy lets them; a plain shell is never blocked.
    const agentName = (input.launch?.executable ?? agentCommand?.trim().split(/\s+/)[0] ?? '').replace(/\\/g, '/').split('/').pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
    if (agentName === 'claude' || agentName === 'codex') assertProviderAllowed(agentName, launch.workspace_root_path)
    const agentParts = agentCommand ? agentCommand.trim().split(/\s+/) : null
    const executable = input.launch ? resolveExecutable(input.launch.executable, this.host.env, this.host.platform, this.host.exists) : agentParts
      ? resolveExecutable(agentParts[0], this.host.env, this.host.platform, this.host.exists)
      : resolveExecutable(launch.shell_executable, this.host.env, this.host.platform, this.host.exists)
    // T54 · Restore session (the pane's own `--resume <id>`): the session main recorded for this pane starts again in the
    // mode it started in. Only that exact session, only Claude, never a launch an agent or Team asked for.
    const recorded = !input.launch && !threadShell && !oxeShell && agentName === 'claude' && input.agentArgs?.length === 2 && input.agentArgs[0] === '--resume'
      ? this.host.currentSession?.(input.paneId) ?? null : null
    const restoreMode = recorded?.agent === 'claude' && recorded.sessionId === input.agentArgs?.[1] && agentParts
      ? permissionModeArgs(recorded.permissionMode, agentParts.slice(1), allowBypass) : []
    // The same one line as a B17 resume when the setting held the session's skipped permissions back (SECURITY L on #552).
    if (recorded?.agent === 'claude' && recorded.sessionId === input.agentArgs?.[1] && agentParts && bypassWithheld(recorded.permissionMode, agentParts.slice(1), allowBypass)) {
      this.host.agentResumes.set(input.paneId, { outcome: 'resumed', agent: 'claude', sessionId: recorded.sessionId, note: mainMessage('agents.resume.bypassWithheld', {}) })
    }
    let args = input.launch ? input.launch.args : agentParts
      ? [...agentParts.slice(1), ...restoreMode, ...(input.agentArgs ?? []), ...plan.extraArgs]
      : [...shellArgs, ...(input.agentArgs ?? [])]
    // The agents the person starts in a pane start without permission prompts while their setting says so (Settings >
    // Terminal): by the pane's command or as the pane's own program. Never a launch an agent or Team asked for, never
    // a conversation's or a container's shell, and a resumed session that recorded a mode of its own keeps it.
    if (!input.launch && !threadShell && !oxeShell) args = withFullAccess(agentProgram(agentParts?.[0] ?? launch.shell_executable), args, skipPrompts)
    // A fresh Claude conversation gets a session id main knows, so the pane can resume it without the hooks.
    const assigned = this.host.assignSession && !threadShell && !oxeShell && !input.launch && !plan.extraArgs.length ? claudeSessionToAssign(agentParts?.[0] ?? launch.shell_executable, args) : null
    if (assigned) { args = ['--session-id', assigned, ...args]; this.host.assignSession?.(input.paneId, 'claude', assigned) }
    // OXE-467 · Capture explicit native session IDs passed via CLI flags (`--resume`, `--conversation`, `--session-id`, `codex resume <id>`).
    const explicitSession = !assigned && !threadShell && !oxeShell && !input.launch && !plan.extraArgs.length
      ? extractSessionFromCommandLine(agentParts?.[0] ?? launch.shell_executable, args) ?? undefined
      : undefined
    if (explicitSession) {
      if (this.host.recordSession) this.host.recordSession(input.paneId, explicitSession.agent, explicitSession.sessionId, 'launch')
      else this.host.assignSession?.(input.paneId, explicitSession.agent, explicitSession.sessionId)
    }
    let mcpEnv: Record<string, string> = {}
    if (!input.launch && this.host.agentMcpArgs) ({ args, env: mcpEnv = {} } = await this.host.agentMcpArgs(executable, args, input.workspaceId))

    // Provider CLIs get the environment without secret-looking variables the provider does not need (S7). Plain
    // shells and other agents keep the full environment: that is the person's own shell.
    const baseEnv = agentName === 'claude' || agentName === 'codex' ? inheritedEnvironment(agentName, launch.workspace_root_path, this.host.env) : this.host.env
    let finalEnv: Record<string, string> = {
      ...baseEnv,
      // Force CLIs to use dark-mode syntax highlighting since OXESpace uses a dark terminal theme
      COLORFGBG: '15;0',
      COLORTERM: 'truecolor',
      GLAMOUR_STYLE: 'dark',
      BAT_THEME: 'TwoDark'
    }
    if (this.host.executionEnvironment && !threadShell && !oxeShell) finalEnv = { ...finalEnv, ...this.host.executionEnvironment({ paneId: input.paneId, workspaceId: input.workspaceId, cwd }) }
    finalEnv = { ...finalEnv, ...mcpEnv }
    const proxyGrant = !threadShell && !oxeShell && Boolean(agentCommand || input.launch || (launch.shell_profile_id !== WINDOWS_SHELL_PROFILE_ID && launch.shell_profile_id !== POSIX_SHELL_PROFILE_ID)) ? this.host.grantProxy?.({ paneId: input.paneId }) : undefined
    if (proxyGrant) finalEnv = { ...finalEnv, ...proxyGrant.env }
    // Optional launch integrations only return environment; provider failures
    // never prevent the shell/agent from starting or touch its output stream.
    if (this.host.prepareLaunch && !threadShell && !oxeShell) {
      const integration = new AbortController()
      const cancel = (): void => integration.abort()
      signal.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(cancel, 3000)
      const integrationSignal = integration.signal
      let onAbort: (() => void) | undefined
      try {
        const env = await Promise.race([
          this.host.prepareLaunch({ paneId: input.paneId, workspaceId: input.workspaceId, cwd, signal: integrationSignal }),
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

    // An app started with ELECTRON_RUN_AS_NODE must not hand it to its shells: any Electron CLI run there (code) breaks.
    for (const key of Object.keys(finalEnv)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete finalEnv[key]

    // Spawn at the view's real geometry. Starting at 80x24 and resizing after
    // the fact makes the app reflow once, which reads as a flash on open.
    const cols = clampDimension(input.cols, 80)
    const rows = clampDimension(input.rows, 24)

    let ptyProcess: IPty
    if (signal.aborted) { proxyGrant?.revoke(); this.host.notifyLaunchExit(input.paneId); return }
    try {
      ptyProcess = this.host.pty.spawn(executable, args, {
        name: 'xterm-256color',
        cwd,
        cols,
        rows,
        env: finalEnv,
        // Windows: bundled ConPTY (`useConptyDll`) avoids system ConPTY's fork()-based kill, and
        // `conptyInheritCursor` avoids extra blank startup lines (OXE-484).
        ...windowsConptyForkOptions(this.host.platform)
      })
    } catch (error) {
      recordRuntime('process-error', { pane: input.paneId, executable, state: 'launch-failed' })
      proxyGrant?.revoke()
      this.host.notifyLaunchExit(input.paneId)
      if (agentCommand || input.launch) {
        recordIncident('incident.agent.startFailed', agentName || 'agent')
        throw new Error(`Unable to start agent "${input.launch?.executable ?? agentCommand}". ${toMessage(error)}`, { cause: error })
      }
      throw new Error(`Unable to start ${launch.shell_profile_name}. Check Settings > Shell profiles executable "${launch.shell_executable}". ${toMessage(error)}`, { cause: error })
    }

    recordRuntime('process-start', { pane: input.paneId, pid: ptyProcess.pid, parentPid: process.pid, executable, kind: input.paneId.startsWith('thread-shell:') ? 'thread' : 'code' })
    this.host.started({
      input,
      ptyProcess,
      cwd,
      executable,
      cols,
      rows,
      resumed,
      explicitSession,
      revokeProxy: proxyGrant?.revoke,
      command: input.launch ? [input.launch.executable, ...input.launch.args].join(' ') : agentCommand ?? executable
    })

    const typed = input.initialPrompt
    if (typed) {
      let sent = false
      ptyProcess.onData(() => {
        if (sent) return
        sent = true
        setTimeout(() => {
          if (this.host.sessions.has(input.paneId)) {
            this.host.sessions.get(input.paneId)?.inputQueue.enqueue(typed + '\r')
          }
        }, 800)
      })
    }
  }
}

/** node-pty rejects non-positive or non-integer geometry. */
function clampDimension(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback
  return Math.min(1000, Math.floor(value))
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terminal process failed'
}
