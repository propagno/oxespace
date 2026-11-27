import { StringDecoder } from 'node:string_decoder'
import type { IDisposable, IPty } from 'node-pty'
import type { ClientChannel } from 'ssh2'
import {
  connectSshClient,
  type ConnectedSshClient,
  type SshClientOptions,
  type SshConnectionConfig
} from './ssh-client.service'

export type SshPtyConnectionState = 'connecting' | 'connected' | 'disconnected' | 'closed'

export interface SshHostedPtyOptions {
  config: SshConnectionConfig
  cols: number
  rows: number
  /** Optional remote working directory to `cd` into once the interactive shell opens. */
  initialDir?: string
  clientOptions?: SshClientOptions
}

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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * OXE-447 · `IPty` implementation backed by an interactive SSH shell (`client.shell`) over the
 * shared TOFU-verified `ssh-client.service.ts`.
 *
 * - UTF-8 safe via `StringDecoder('utf8')` across arbitrary TCP chunk boundaries.
 * - Supports live terminal resize (`setWindow(rows, cols, 0, 0)`), keepalive, abrupt disconnect
 *   detection (`state = 'disconnected'` without crashing listeners), and clean `reconnect()`.
 */
export class SshHostedPty implements IPty {
  readonly pid = 0
  process: string
  cols: number
  rows: number
  handleFlowControl = false

  private _state: SshPtyConnectionState = 'connecting'
  private connection: ConnectedSshClient | null = null
  private stream: ClientChannel | null = null
  private generation = 0
  private killed = false
  private exited = false

  private readonly dataEmitter = new Emitter<string>()
  private readonly exitEmitter = new Emitter<ExitEvent>()
  private readonly stateEmitter = new Emitter<SshPtyConnectionState>()

  readonly onData = this.dataEmitter.event
  readonly onExit = this.exitEmitter.event
  readonly onState = this.stateEmitter.event

  constructor(private readonly options: SshHostedPtyOptions) {
    this.cols = Math.max(1, Math.min(1000, Math.floor(options.cols || 80)))
    this.rows = Math.max(1, Math.min(1000, Math.floor(options.rows || 24)))
    this.process = `ssh:${options.config.username}@${options.config.host}`
  }

  get state(): SshPtyConnectionState {
    return this._state
  }

  get fingerprint(): string {
    return this.connection?.fingerprint ?? this.options.config.pinnedFingerprint ?? ''
  }

  async connect(): Promise<void> {
    if (this.killed) throw new Error('SSH terminal has been closed')
    await this.openShell()
  }

  async reconnect(): Promise<void> {
    if (this.killed) throw new Error('SSH terminal has been closed')
    this.teardownTransport()
    await this.openShell()
  }

  write(data: string | Buffer): void {
    if (this.killed || !this.stream || !this.stream.writable) return
    try {
      this.stream.write(data)
    } catch {
      /* transport closing; state listener handles disconnect */
    }
  }

  resize(columns: number, rows: number): void {
    const nextCols = Math.max(1, Math.min(1000, Math.floor(columns)))
    const nextRows = Math.max(1, Math.min(1000, Math.floor(rows)))
    this.cols = nextCols
    this.rows = nextRows
    if (this.killed || !this.stream || !this.stream.writable) return
    try {
      // ssh2 ClientChannel#setWindow expects (rows, cols, height, width).
      this.stream.setWindow(nextRows, nextCols, 0, 0)
    } catch {
      /* ignore if channel already closed */
    }
  }

  clear(): void { /* handled by xterm view */ }
  pause(): void { this.stream?.pause() }
  resume(): void { this.stream?.resume() }

  kill(): void {
    if (this.killed) return
    this.killed = true
    this.generation += 1
    this.teardownTransport()
    this.setState('closed')
    this.emitExitOnce({ exitCode: 0 })
  }

  private async openShell(): Promise<void> {
    const gen = ++this.generation
    this.setState('connecting')
    const connected = await connectSshClient(this.options.config, this.options.clientOptions)
    if (this.killed || gen !== this.generation) {
      connected.close()
      return
    }

    const stream = await new Promise<ClientChannel>((resolve, reject) => {
      connected.client.shell(
        { cols: this.cols, rows: this.rows, term: 'xterm-256color' },
        (error, channel) => {
          if (error || !channel) reject(error ?? new Error('Failed to open remote SSH shell'))
          else resolve(channel)
        }
      )
    }).catch(error => {
      connected.close()
      throw error
    })

    if (this.killed || gen !== this.generation) {
      stream.close()
      connected.close()
      return
    }

    this.connection = connected
    this.stream = stream
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    let receivedExitStatus = false
    let exitCode = 0

    const handleDisconnect = (): void => {
      if (gen !== this.generation) return
      const tailOut = stdoutDecoder.end()
      if (tailOut) this.dataEmitter.fire(tailOut)
      const tailErr = stderrDecoder.end()
      if (tailErr) this.dataEmitter.fire(tailErr)

      this.teardownTransport()
      if (this.killed || receivedExitStatus) {
        this.killed = true
        this.setState('closed')
        this.emitExitOnce({ exitCode })
      } else {
        this.setState('disconnected')
      }
    }

    stream.on('data', (chunk: Buffer | string) => {
      if (gen !== this.generation) return
      const text = typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk)
      if (text) this.dataEmitter.fire(text)
    })

    stream.stderr?.on('data', (chunk: Buffer | string) => {
      if (gen !== this.generation) return
      const text = typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk)
      if (text) this.dataEmitter.fire(text)
    })

    stream.on('exit', (code?: number | null) => {
      if (gen !== this.generation) return
      receivedExitStatus = true
      if (typeof code === 'number') exitCode = code
    })

    stream.on('close', handleDisconnect)
    stream.on('error', handleDisconnect)
    connected.client.on('close', handleDisconnect)
    connected.client.on('error', handleDisconnect)

    this.setState('connected')

    if (this.options.initialDir?.trim()) {
      this.write(`cd ${shellQuote(this.options.initialDir.trim())}\r`)
    }
  }

  private teardownTransport(): void {
    const stream = this.stream
    const connection = this.connection
    this.stream = null
    this.connection = null
    if (stream) {
      try { stream.removeAllListeners() } catch { /* ignore */ }
      try { stream.close() } catch { /* ignore */ }
    }
    if (connection) {
      try { connection.close() } catch { /* ignore */ }
    }
  }

  private setState(next: SshPtyConnectionState): void {
    if (this._state === next) return
    this._state = next
    this.stateEmitter.fire(next)
  }

  private emitExitOnce(event: ExitEvent): void {
    if (this.exited) return
    this.exited = true
    this.exitEmitter.fire(event)
  }
}

/** Connects to a pinned SSH host and opens an interactive `SshHostedPty` shell. */
export async function createSshHostedPty(options: SshHostedPtyOptions): Promise<SshHostedPty> {
  const pty = new SshHostedPty(options)
  await pty.connect()
  return pty
}
