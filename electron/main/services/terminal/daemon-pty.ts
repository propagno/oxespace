import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import type { IDisposable, IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import { readJson, writePrivateJson } from '../private-json'
import type { PtyModule } from './session-start'
import {
  PTY_DAEMON_MAX_FRAME_BYTES,
  PTY_DAEMON_PROTOCOL_VERSION,
  assertLocalDaemonEndpoint,
  daemonUserHash,
  defaultPtyDaemonEndpoint,
  generateDaemonToken,
  type PtyDaemonAttachResult,
  type PtyDaemonEvent,
  type PtyDaemonRequest,
  type PtyDaemonResponse,
  type PtyDaemonServerMessage,
  type PtyDaemonSessionInfo
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
    private readonly client: DaemonPtyClient,
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

export interface DaemonPtyClientOptions {
  endpoint: string
  token: string
  connectTimeoutMs?: number
  platform?: NodeJS.Platform
}

export interface DaemonSpawnInput {
  sessionId: string
  file: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export interface DaemonAttachedSession extends PtyDaemonAttachResult {
  pty: IPty
}

interface PendingRpc {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class DaemonPtyClient {
  private socket: Socket | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRpc>()
  private readonly proxies = new Map<string, DaemonPtyProxy>()
  private buffer = ''

  constructor(private readonly options: DaemonPtyClientOptions) {
    assertLocalDaemonEndpoint(options.endpoint, options.platform ?? process.platform)
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  async connect(): Promise<{ protocolVersion: number; pid: number }> {
    if (this.connected) {
      return this.request<{ protocolVersion: number; pid: number }>({
        type: 'hello',
        token: this.options.token,
        protocolVersion: PTY_DAEMON_PROTOCOL_VERSION
      })
    }

    const timeoutMs = this.options.connectTimeoutMs ?? 5_000
    const socket = await new Promise<Socket>((resolve, reject) => {
      const sock = connect(this.options.endpoint)
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error(`Timed out connecting to PTY daemon at ${this.options.endpoint}`))
      }, timeoutMs)
      sock.once('connect', () => {
        clearTimeout(timer)
        sock.off('error', onError)
        resolve(sock)
      })
      const onError = (err: Error): void => {
        clearTimeout(timer)
        reject(err)
      }
      sock.once('error', onError)
    })

    socket.setEncoding('utf8')
    this.socket = socket
    this.buffer = ''

    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('error', () => this.onSocketClosed())
    socket.on('close', () => this.onSocketClosed())

    try {
      return await this.request<{ protocolVersion: number; pid: number }>({
        type: 'hello',
        token: this.options.token,
        protocolVersion: PTY_DAEMON_PROTOCOL_VERSION
      })
    } catch (error) {
      await this.detachClient()
      throw error
    }
  }

  async listSessions(): Promise<PtyDaemonSessionInfo[]> {
    return this.request<PtyDaemonSessionInfo[]>({ type: 'listSessions' })
  }

  async spawnSession(input: DaemonSpawnInput): Promise<PtyDaemonSessionInfo> {
    return this.request<PtyDaemonSessionInfo>({
      type: 'spawnSession',
      sessionId: input.sessionId,
      file: input.file,
      args: input.args,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
      ...(input.env ? { env: input.env } : {})
    })
  }

  async attachSession(sessionId: string): Promise<DaemonAttachedSession> {
    const result = await this.request<PtyDaemonAttachResult>({ type: 'attachSession', sessionId })
    let proxy = this.proxies.get(sessionId)
    if (!proxy) {
      proxy = new DaemonPtyProxy(sessionId, this, {
        pid: result.session.pid,
        process: result.session.process ?? 'shell',
        cols: result.session.cols,
        rows: result.session.rows
      })
      this.proxies.set(sessionId, proxy)
    } else {
      proxy.pid = result.session.pid
      proxy.cols = result.session.cols
      proxy.rows = result.session.rows
    }
    return { ...result, pty: proxy }
  }

  async detachSession(sessionId: string): Promise<void> {
    this.proxies.delete(sessionId)
    if (!this.connected) return
    await this.request({ type: 'detachSession', sessionId })
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.request({ type: 'write', sessionId, data })
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.request({ type: 'resize', sessionId, cols, rows })
  }

  async killSession(sessionId: string, signal?: string): Promise<void> {
    await this.request({ type: 'killSession', sessionId, ...(signal ? { signal } : {}) })
  }

  /** Disconnects this client cleanly without killing any daemon-owned PTY sessions. */
  async detachClient(): Promise<void> {
    const socket = this.socket
    this.socket = null
    this.proxies.clear()
    this.rejectPending(new Error('PTY daemon client detached'))
    if (!socket || socket.destroyed) return
    await new Promise<void>(resolve => {
      socket.once('close', () => resolve())
      socket.end()
      socket.destroy()
    })
  }

  /** Explicitly terminates all active PTY trees in the daemon and shuts the daemon down. */
  async shutdown(): Promise<{ terminated: number }> {
    const result = await this.request<{ terminated: number }>({ type: 'shutdown' })
    await this.detachClient()
    return result
  }

  private request<T>(payload: Omit<PtyDaemonRequest, 'id'>): Promise<T> {
    const socket = this.socket
    if (!socket || socket.destroyed) {
      return Promise.reject(new Error('PTY daemon client is not connected'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject
      })
      try {
        socket.write(`${JSON.stringify({ ...payload, id })}\n`)
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error('Failed to write frame to PTY daemon'))
      }
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > PTY_DAEMON_MAX_FRAME_BYTES) {
      void this.detachClient()
      return
    }
    let newlineIdx = this.buffer.indexOf('\n')
    while (newlineIdx >= 0) {
      const line = this.buffer.slice(0, newlineIdx).trim()
      this.buffer = this.buffer.slice(newlineIdx + 1)
      if (line) this.handleLine(line)
      newlineIdx = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let message: PtyDaemonServerMessage
    try {
      message = JSON.parse(line) as PtyDaemonServerMessage
    } catch {
      return
    }
    if ('event' in message) {
      const proxy = this.proxies.get(message.sessionId)
      if (!proxy) return
      if (message.event === 'exit') this.proxies.delete(message.sessionId)
      proxy.receiveEvent(message)
      return
    }
    const response = message as PtyDaemonResponse
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new Error(response.error || 'Daemon request failed'))
  }

  private onSocketClosed(): void {
    this.socket = null
    this.rejectPending(new Error('PTY daemon connection closed'))
  }

  private rejectPending(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }
}

export interface DaemonPtyModule extends PtyModule {
  readonly mode: 'daemon'
  listSessions(): Promise<PtyDaemonSessionInfo[]>
  attachSession(sessionId: string): Promise<DaemonAttachedSession>
  detachClient(): Promise<void>
  shutdown(): Promise<{ terminated: number }>
  dispose(): void
}

interface DaemonDescriptor {
  endpoint?: string
  token?: string
  pid?: number
}

/**
 * Connects to an existing detached PTY daemon for this userData runtime directory or spawns a new one.
 * Metadata is stored owner-only (0600) in `<userData>/pty-daemon.json`.
 */
export async function connectOrStartPtyDaemon(options: {
  userDataPath: string
  entryPath: string
  idleShutdownMs?: number
}): Promise<DaemonPtyClient> {
  const descriptorPath = join(options.userDataPath, 'pty-daemon.json')
  const existing = (await readJson(descriptorPath).catch(() => ({}))) as DaemonDescriptor
  if (typeof existing.endpoint === 'string' && typeof existing.token === 'string') {
    try {
      const client = new DaemonPtyClient({ endpoint: existing.endpoint, token: existing.token, connectTimeoutMs: 1200 })
      await client.connect()
      return client
    } catch {
      // Existing descriptor is stale; spawn a fresh detached daemon.
    }
  }

  const endpoint = defaultPtyDaemonEndpoint(daemonUserHash(options.userDataPath), options.userDataPath)
  const token = generateDaemonToken()
  const child = spawnChild(process.execPath, [options.entryPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
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
      const client = new DaemonPtyClient({ endpoint, token, connectTimeoutMs: 1000 })
      await client.connect()
      return client
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to start detached PTY daemon')
}

/** Adapts a connected `DaemonPtyClient` to the `PtyModule` interface used by `TerminalManager`. */
export function createDaemonPtyModule(client: DaemonPtyClient): DaemonPtyModule {
  return {
    mode: 'daemon',
    spawn(file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions): IPty {
      const env = (options.env ?? {}) as Record<string, string>
      const sessionId = env.OXESPACE_PANE_ID || randomUUID()
      const cols = options.cols ?? 80
      const rows = options.rows ?? 24
      const proxy = new DaemonPtyProxy(sessionId, client, { pid: 0, process: file, cols, rows })
      void client
        .spawnSession({ sessionId, file, args, cwd: options.cwd ?? process.cwd(), cols, rows, env })
        .then(async info => {
          proxy.pid = info.pid
          if (info.process) proxy.process = info.process
          const attached = await client.attachSession(sessionId)
          attached.pty.onData(chunk => proxy.receiveEvent({ event: 'data', sessionId, data: chunk }))
          attached.pty.onExit(ev => proxy.end(ev))
        })
        .catch(error => {
          const message = error instanceof Error ? error.message : String(error)
          proxy.receiveEvent({ event: 'data', sessionId, data: `\r\n${message}\r\n` })
          proxy.end({ exitCode: 1 })
        })
      return proxy
    },
    listSessions: () => client.listSessions(),
    attachSession: sessionId => client.attachSession(sessionId),
    detachClient: () => client.detachClient(),
    shutdown: () => client.shutdown(),
    dispose: () => { void client.detachClient() }
  }
}
