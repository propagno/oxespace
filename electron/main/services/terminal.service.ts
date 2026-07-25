import type { IPty, IPtyForkOptions } from 'node-pty'
import { spawn } from 'node-pty'
import { existsSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'
import type { AppDatabase } from '../db/index'
import { killProcess } from '../utils/process-cleanup'
import { getRtkService, type RtkService } from './rtk.service'
import { PtyInputQueue } from './pty-input-queue'
import { PtyOutputBatcher } from './pty-output-batcher'
import { PtyRingBuffer } from './pty-ring-buffer'
import { PtyModeTracker } from './pty-mode-tracker'
import type { TerminalActivityEvent, TerminalAttachInput, TerminalAttachResult, TerminalDataEvent, TerminalExitEvent, TerminalResizeInput, TerminalStartInput, TerminalStatusResult, TerminalStopInput, TerminalWriteInput } from '../../../shared/types/ipc'

const resolvedExecutableCache = new Map<string, string>()

interface PtyModule {
  spawn(file: string, args: string[], options: IPtyForkOptions): IPty
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
}

interface TerminalSession {
  paneId: string
  workspaceId: string
  pty: IPty
  agentCommand?: string
  disableRtk?: boolean
  inputQueue: PtyInputQueue
  outputBatcher: PtyOutputBatcher
  /** Recent output, so a re-mounted view is restored without a respawn. */
  ring: PtyRingBuffer
  /** DEC private modes, so a re-mounted view lands in the right screen. */
  modes: PtyModeTracker
  /** True while a terminal view is rendering this session. */
  attached: boolean
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

interface TerminalLaunchContextRow {
  pane_root_path: string | null
  workspace_root_path: string
  shell_profile_id: string
  shell_profile_name: string | null
  shell_executable: string | null
  shell_args_json: string | null
}

export class TerminalManager {
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

  constructor(db: AppDatabase, options: TerminalManagerOptions = {}) {
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

  async start(input: TerminalStartInput): Promise<void> {
    if (this.sessions.has(input.paneId)) return

    const launch = this.launchContextStatement.get({
      paneId: input.paneId,
      workspaceId: input.workspaceId
    }) as TerminalLaunchContextRow | undefined
    if (!launch) {
      const workspaceExists = this.workspaceExistsStatement.get(input.workspaceId)
      if (!workspaceExists) throw new Error(`Workspace ${input.workspaceId} not found`)
      throw new Error(`Pane ${input.paneId} not found`)
    }
    if (!launch.shell_executable || !launch.shell_profile_name || launch.shell_args_json === null) {
      throw new Error(`Shell profile ${launch.shell_profile_id} not found`)
    }
    const shellArgs = JSON.parse(launch.shell_args_json) as string[]

    const agentParts = input.agentCommand ? input.agentCommand.trim().split(/\s+/) : null
    const executable = agentParts
      ? resolveExecutable(agentParts[0], this.env, this.platform)
      : resolveExecutable(launch.shell_executable, this.env, this.platform)
    const args = agentParts
      ? agentParts.slice(1)
      : [...shellArgs, ...(input.agentArgs ?? [])]

    // Pane-level rootPath overrides the workspace root — used by git worktree panes.
    const cwd = launch.pane_root_path && existsSync(launch.pane_root_path)
      ? launch.pane_root_path
      : launch.workspace_root_path

    let finalEnv: Record<string, string> = {
      ...this.env,
      // Force CLIs to use dark-mode syntax highlighting since OXESpace uses a dark terminal theme
      COLORFGBG: '15;0',
      COLORTERM: 'truecolor',
      GLAMOUR_STYLE: 'dark',
      BAT_THEME: 'TwoDark'
    }
    
    if (!input.disableRtk) {
      try {
        const rtkBin = await this.rtkService.ensureRtk()
        finalEnv = { ...finalEnv, PATH: `${rtkBin}${delimiter}${finalEnv.PATH ?? ''}` }
      } catch (err) {
        // Fall back gracefully if download fails
      }
    } else {
      finalEnv = { ...finalEnv, RTK_DISABLED: '1' }
    }

    // Spawn at the view's real geometry. Starting at 80x24 and resizing after
    // the fact makes the app reflow once, which reads as a flash on open.
    const cols = clampDimension(input.cols, 80)
    const rows = clampDimension(input.rows, 24)

    let ptyProcess: IPty
    try {
      ptyProcess = this.pty.spawn(executable, args, {
        name: 'xterm-256color',
        cwd,
        cols,
        rows,
        env: finalEnv
      })
    } catch (error) {
      if (input.agentCommand) {
        throw new Error(`Unable to start agent "${input.agentCommand}". ${toMessage(error)}`)
      }
      throw new Error(`Unable to start ${launch.shell_profile_name}. Check Settings > Shell profiles executable "${launch.shell_executable}". ${toMessage(error)}`)
    }

    // A pane that is starting fresh must not inherit a dead session's output.
    this.exitedSessions.delete(input.paneId)
    this.reclaimIdleSession()

    this.sessions.set(input.paneId, {
      paneId: input.paneId,
      workspaceId: input.workspaceId,
      pty: ptyProcess,
      agentCommand: input.agentCommand,
      disableRtk: input.disableRtk,
      inputQueue: new PtyInputQueue(ptyProcess),
      outputBatcher: new PtyOutputBatcher(input.paneId, (event) => this.onBatch(event)),
      ring: new PtyRingBuffer(this.ringCapacityBytes),
      modes: new PtyModeTracker(),
      // A view always attaches right after starting; assuming attached here
      // avoids dropping the first prompt into the ring only.
      attached: true,
      lastActivityAt: Date.now(),
      cols,
      rows,
      activityNotifiedAt: 0
    })

    ptyProcess.onData((data) => this.sessions.get(input.paneId)?.outputBatcher.push(data))
    ptyProcess.onExit(({ exitCode }) => {
      const session = this.sessions.get(input.paneId)
      session?.outputBatcher.flush()
      if (session) this.rememberExit(session, exitCode)
      this.sessions.delete(input.paneId)
      this.emitExit({ paneId: input.paneId, exitCode })
    })

    if (input.initialPrompt) {
      let sent = false
      ptyProcess.onData(() => {
        if (sent) return
        sent = true
        setTimeout(() => {
          if (this.sessions.has(input.paneId)) {
            this.sessions.get(input.paneId)?.inputQueue.enqueue(input.initialPrompt! + '\r')
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

  resize(input: TerminalResizeInput): void {
    const session = this.sessions.get(input.paneId)
    if (!session) return
    session.cols = input.cols
    session.rows = input.rows
    session.pty.resize(input.cols, input.rows)
  }

  /**
   * Route batched output. Everything is retained; only an attached view gets
   * the bytes over IPC. Previously every chunk was broadcast to every window
   * and dropped in the preload when nobody was listening.
   */
  private onBatch(event: TerminalDataEvent): void {
    const session = this.sessions.get(event.paneId)
    if (!session) return

    session.ring.push(event.data)
    session.modes.consume(event.data)
    session.lastActivityAt = Date.now()

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

    // On the alternate screen the retained bytes cannot be trusted: if the
    // `\x1b[?1049h` fell off the ring head, replaying paints TUI content onto
    // the normal buffer. Ask the app for a correct frame instead.
    const altScreen = session.modes.altScreen
    if (altScreen) this.nudgeRedraw(session)

    return {
      running: true,
      seq: session.ring.seq,
      prologue: session.modes.prologue(),
      replay: altScreen ? '' : slice.data,
      truncated: slice.truncated,
      altScreen
    }
  }

  /** Unbind the view. The process keeps running and its output keeps accruing. */
  detach(input: TerminalStopInput): void {
    const session = this.sessions.get(input.paneId)
    if (!session) return
    session.outputBatcher.flush()
    session.attached = false
  }

  status(paneId: string): TerminalStatusResult {
    const session = this.sessions.get(paneId)
    if (!session) return { running: false, seq: 0, altScreen: false }
    return { running: true, seq: session.ring.seq, altScreen: session.modes.altScreen }
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
    const session = this.sessions.get(input.paneId)
    if (!session) return
    // Flush before disposing: the batcher discards `pending`, so an exiting
    // process used to lose its last words (often the error that killed it).
    session.outputBatcher.flush()
    session.inputQueue.dispose()
    session.outputBatcher.dispose()
    killProcess(session.pty)
    this.sessions.delete(input.paneId)
    // An explicit stop is not a crash to be explained on return.
    this.exitedSessions.delete(input.paneId)
  }

  async restart(input: TerminalStopInput): Promise<void> {
    const session = this.sessions.get(input.paneId)
    if (!session) return
    const { workspaceId, agentCommand, disableRtk, cols, rows } = session
    this.stop(input)
    // A fresh process gets a fresh ring: replaying the old shell's output over
    // the new one would show history that no longer belongs to it.
    await this.start({ paneId: input.paneId, workspaceId, agentCommand, disableRtk, cols, rows })
  }

  stopWorkspace(workspaceId: string): void {
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) {
        this.stop({ paneId: session.paneId })
      }
    }
  }

  stopAll(): void {
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
