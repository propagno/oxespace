import type { IPty, IPtyForkOptions } from 'node-pty'
import { spawn } from 'node-pty'
import { existsSync } from 'node:fs'
import { delimiter, extname, join } from 'node:path'
import type { AppDatabase } from '../db/index'
import { WorkspaceService } from './workspace.service'
import { ShellProfileService } from './shell-profile.service'
import { killProcess } from '../utils/process-cleanup'
import { RtkService } from './rtk.service'
import type { TerminalDataEvent, TerminalExitEvent, TerminalResizeInput, TerminalStartInput, TerminalStopInput, TerminalWriteInput } from '../../../shared/types/ipc'

interface PtyModule {
  spawn(file: string, args: string[], options: IPtyForkOptions): IPty
}

interface TerminalManagerOptions {
  pty?: PtyModule
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  emitData?: (event: TerminalDataEvent) => void
  emitExit?: (event: TerminalExitEvent) => void
}

interface TerminalSession {
  paneId: string
  workspaceId: string
  pty: IPty
  agentCommand?: string
  disableRtk?: boolean
}

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>()
  private readonly pty: PtyModule
  private readonly workspaceService: WorkspaceService
  private readonly shellProfileService: ShellProfileService
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly emitData: (event: TerminalDataEvent) => void
  private readonly emitExit: (event: TerminalExitEvent) => void
  private readonly rtkService = new RtkService()

  constructor(db: AppDatabase, options: TerminalManagerOptions = {}) {
    this.pty = options.pty ?? { spawn }
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    this.workspaceService = new WorkspaceService(db)
    this.shellProfileService = new ShellProfileService(db)
    this.emitData = options.emitData ?? (() => undefined)
    this.emitExit = options.emitExit ?? (() => undefined)
  }

  async start(input: TerminalStartInput): Promise<void> {
    if (this.sessions.has(input.paneId)) return

    const workspace = this.workspaceService.get(input.workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${input.workspaceId} not found`)
    }

    const pane = workspace.panes.find((item) => item.id === input.paneId)
    if (!pane) {
      throw new Error(`Pane ${input.paneId} not found`)
    }

    const shellProfile = this.shellProfileService.get(pane.shellProfileId ?? workspace.defaultShellProfileId)
    if (!shellProfile) {
      throw new Error(`Shell profile ${pane.shellProfileId ?? workspace.defaultShellProfileId} not found`)
    }

    const agentParts = input.agentCommand ? input.agentCommand.trim().split(/\s+/) : null
    const executable = agentParts
      ? resolveExecutable(agentParts[0], this.env, this.platform)
      : resolveExecutable(shellProfile.executable, this.env, this.platform)
    const args = agentParts
      ? agentParts.slice(1)
      : [...shellProfile.args, ...(input.agentArgs ?? [])]

    // Pane-level rootPath overrides the workspace root — used by git worktree panes.
    const cwd = pane.rootPath && existsSync(pane.rootPath) ? pane.rootPath : workspace.rootPath

    let finalEnv = this.env
    if (!input.disableRtk) {
      try {
        const rtkBin = await this.rtkService.ensureRtk()
        finalEnv = { ...this.env, PATH: `${rtkBin}${delimiter}${this.env.PATH ?? ''}` }
      } catch (err) {
        // Fall back gracefully if download fails
      }
    } else {
      finalEnv = { ...this.env, RTK_DISABLED: '1' }
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
      throw new Error(`Unable to start ${shellProfile.name}. Check Settings > Shell profiles executable "${shellProfile.executable}". ${toMessage(error)}`)
    }

    ptyProcess.onData((data) => this.emitData({ paneId: input.paneId, data }))
    ptyProcess.onExit(({ exitCode }) => {
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
            ptyProcess.write(input.initialPrompt! + '\r')
          }
        }, 800)
      })
    }

    this.sessions.set(input.paneId, {
      paneId: input.paneId,
      workspaceId: input.workspaceId,
      pty: ptyProcess,
      agentCommand: input.agentCommand,
      disableRtk: input.disableRtk
    })
  }

  write(input: TerminalWriteInput): void {
    this.sessions.get(input.paneId)?.pty.write(input.data)
  }

  resize(input: TerminalResizeInput): void {
    this.sessions.get(input.paneId)?.pty.resize(input.cols, input.rows)
  }

  stop(input: TerminalStopInput): void {
    const session = this.sessions.get(input.paneId)
    if (!session) return
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

  const pathExtensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)

  const executableNames = pathExtensions.map((extension) => `${executable}${extension.toLowerCase()}`)
  executableNames.push(executable)

  if (executable.includes('\\') || executable.includes('/')) {
    return executableNames.find((candidate) => existsSync(candidate)) ?? executable
  }

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const executableName of executableNames) {
      const candidate = join(directory, executableName)
      if (existsSync(candidate)) return candidate
    }
  }

  return executable
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Terminal process failed'
}
