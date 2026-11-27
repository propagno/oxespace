import { spawn as spawnChild } from 'node:child_process'
import { join } from 'node:path'
import type { IDisposable, IPty } from 'node-pty'
import { readJson, writePrivateJson } from '../private-json'
import {
  daemonUserHash,
  defaultPtyDaemonEndpoint,
  generateDaemonToken,
  type PtyDaemonEvent
} from './pty-daemon-protocol'

type ExitEvent = { exitCode: number; signal?: number }

class Emitter<T> {
  private readonly listeners = new Set<(event: T) => unknown>()
  readonly event = (listener: (event: T) => unknown): IDisposable => {
    this.listeners.add(listener)
    return { dispose: () => { this.listeners.delete(listener) } }
  }

  fire(event: T): void {
    for (const listener of [...this.listeners]) {
      try { listener(event) } catch (error) { queueMicrotask(() => { throw error }) }
    }
  }
}

export interface DaemonPtyTransportSink {
  write(sessionId: string, data: string): Promise<void>
  resize(sessionId: string, cols: number, rows: number): Promise<void>
  killSession(sessionId: string, signal?: string): Promise<void>
}

export class DaemonPtyProxy implements IPty {
  pid: number
  process: string
  cols: number
  rows: number
  handleFlowControl = false
  private readonly dataEmitter = new Emitter<string>()
  private readonly exitEmitter = new Emitter<ExitEvent>()
  private ended = false
  readonly onData = this.dataEmitter.event
  readonly onExit = this.exitEmitter.event

  constructor(
    readonly sessionId: string,
    private readonly client: DaemonPtyTransportSink,
    initial: { pid: number; process: string; cols: number; rows: number }
  ) {
    this.pid = initial.pid
    this.process = initial.process
    this.cols = initial.cols
    this.rows = initial.rows
  }

  write(data: string | Buffer): void {
    if (this.ended) return
    const text = typeof data === 'string' ? data : data.toString('utf8')
    void this.client.write(this.sessionId, text).catch(() => undefined)
  }

  resize(columns: number, rows: number): void {
    if (this.ended) return
    this.cols = columns
    this.rows = rows
    void this.client.resize(this.sessionId, columns, rows).catch(() => undefined)
  }

  clear(): void { /* handled by renderer xterm */ }
  pause(): void { /* noop on remote daemon transport */ }
  resume(): void { /* noop on remote daemon transport */ }

  kill(signal?: string): void {
    if (this.ended) return
    void this.client.killSession(this.sessionId, signal).catch(() => undefined)
  }

  /** @internal */
  receiveEvent(event: PtyDaemonEvent): void {
    if (this.ended) return
    if (event.event === 'data') {
      this.dataEmitter.fire(event.data)
    } else if (event.event === 'process') {
      this.process = event.process
    } else if (event.event === 'exit') {
      this.end({ exitCode: event.exitCode, ...(event.signal !== undefined ? { signal: event.signal } : {}) })
    }
  }

  /** @internal */
  end(event: ExitEvent): void {
    if (this.ended) return
    this.ended = true
    this.exitEmitter.fire(event)
  }
}

interface DaemonDescriptor {
  endpoint?: string
  token?: string
  pid?: number
}

export interface DaemonClientConnector<TClient> {
  (options: { endpoint: string; token: string; connectTimeoutMs?: number }): TClient
}

/**
 * Resolves a standalone Node.js executable for spawning the detached PTY daemon.
 * Never invokes the Electron app binary as Node (the RunAsNode fuse is disabled in packaged builds).
 */
export function resolveDaemonNodeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const explicit = env.OXESPACE_NODE_EXECUTABLE?.trim()
  if (explicit) return explicit
  if (!process.versions.electron) return process.execPath
  return platform === 'win32' ? 'node.exe' : 'node'
}

/**
 * Connects to an existing detached PTY daemon for this userData runtime directory or spawns a new
 * detached standalone Node process. Metadata is stored owner-only (0600) in `<userData>/pty-daemon.json`.
 */
export async function launchOrConnectPtyDaemon<TClient extends { connect(): Promise<unknown> }>(
  createClient: DaemonClientConnector<TClient>,
  options: {
    userDataPath: string
    entryPath: string
    idleShutdownMs?: number
    nodeExecutable?: string
  }
): Promise<TClient> {
  const descriptorPath = join(options.userDataPath, 'pty-daemon.json')
  const existing = (await readJson(descriptorPath).catch(() => ({}))) as DaemonDescriptor
  if (typeof existing.endpoint === 'string' && typeof existing.token === 'string') {
    try {
      const client = createClient({ endpoint: existing.endpoint, token: existing.token, connectTimeoutMs: 1200 })
      await client.connect()
      return client
    } catch {
      // Existing descriptor is stale; spawn a fresh detached daemon.
    }
  }

  const endpoint = defaultPtyDaemonEndpoint(daemonUserHash(options.userDataPath), options.userDataPath)
  const token = generateDaemonToken()
  const nodeExec = options.nodeExecutable?.trim() || resolveDaemonNodeExecutable()
  const child = spawnChild(nodeExec, [options.entryPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      OXESPACE_PTY_DAEMON_STANDALONE: '1',
      OXESPACE_PTY_DAEMON_ENDPOINT: endpoint,
      OXESPACE_PTY_DAEMON_TOKEN: token,
      ...(options.idleShutdownMs ? { OXESPACE_PTY_DAEMON_IDLE_MS: String(options.idleShutdownMs) } : {})
    }
  })
  child.unref()

  await writePrivateJson(descriptorPath, { endpoint, token, pid: child.pid ?? 0 })

  const deadline = Date.now() + 5_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const client = createClient({ endpoint, token, connectTimeoutMs: 1000 })
      await client.connect()
      return client
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to start detached PTY daemon')
}
