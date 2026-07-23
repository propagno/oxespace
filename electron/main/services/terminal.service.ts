import type { IPty, IPtyForkOptions } from 'node-pty'
import { spawn } from 'node-pty'
import { existsSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'
import type { AppDatabase } from '../db/index'
import { killProcess } from '../utils/process-cleanup'
import { getRtkService, type RtkService } from './rtk.service'
import { PtyInputQueue } from './pty-input-queue'
import { PtyOutputBatcher } from './pty-output-batcher'
import type { TerminalDataEvent, TerminalExitEvent, TerminalResizeInput, TerminalStartInput, TerminalStopInput, TerminalWriteInput } from '../../../shared/types/ipc'

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
}

interface TerminalSession {
  paneId: string
  workspaceId: string
  pty: IPty
  agentCommand?: string
  disableRtk?: boolean
  inputQueue: PtyInputQueue
  outputBatcher: PtyOutputBatcher
}

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
  private readonly rtkService: RtkService

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

    let ptyProcess: IPty
    try {
      ptyProcess = this.pty.spawn(executable, args, {
        name: 'xterm-256color',
        cwd,
        cols: 80,
        rows: 24,
        env: finalEnv
      })
    } catch (error) {
      if (input.agentCommand) {
        throw new Error(`Unable to start agent "${input.agentCommand}". ${toMessage(error)}`)
      }
      throw new Error(`Unable to start ${launch.shell_profile_name}. Check Settings > Shell profiles executable "${launch.shell_executable}". ${toMessage(error)}`)
    }

    this.sessions.set(input.paneId, {
      paneId: input.paneId,
      workspaceId: input.workspaceId,
      pty: ptyProcess,
      agentCommand: input.agentCommand,
      disableRtk: input.disableRtk,
      inputQueue: new PtyInputQueue(ptyProcess),
      outputBatcher: new PtyOutputBatcher(input.paneId, this.emitData)
    })

    ptyProcess.onData((data) => this.sessions.get(input.paneId)?.outputBatcher.push(data))
    ptyProcess.onExit(({ exitCode }) => {
      this.sessions.get(input.paneId)?.outputBatcher.flush()
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
    this.sessions.get(input.paneId)?.pty.resize(input.cols, input.rows)
  }

  stop(input: TerminalStopInput): void {
    const session = this.sessions.get(input.paneId)
    if (!session) return
    session.inputQueue.dispose()
    session.outputBatcher.dispose()
    killProcess(session.pty)
    this.sessions.delete(input.paneId)
  }

  async restart(input: TerminalStopInput): Promise<void> {
    const session = this.sessions.get(input.paneId)
    if (!session) return
    this.stop(input)
    await this.start({ paneId: input.paneId, workspaceId: session.workspaceId, agentCommand: session.agentCommand, disableRtk: session.disableRtk })
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

  private requireSession(paneId: string): TerminalSession {
    const session = this.sessions.get(paneId)
    if (!session) {
      throw new Error(`Terminal session ${paneId} is not running`)
    }
    return session
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

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terminal process failed'
}
