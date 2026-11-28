/**
 * OXE-400 · A PtyModule whose terminals live in the PTY host utility process (electron/main/workers/pty-host.ts)
 * instead of the main process. The default since 23/11; OXESPACE_PTY_HOST=main keeps node-pty in the main process.
 *
 * Each terminal is a HostedPty, an IPty the rest of the app uses as it uses node-pty's. What changes:
 * - `pid` is 0 until the host reports the spawn, a few milliseconds later; `process` is the last name the host
 *   reported (at most every 500 ms while output flows) instead of a synchronous read;
 * - a spawn that fails in the host prints the reason in the terminal and ends it with code 1, where node-pty in main
 *   threw from spawn();
 * - when the host process ends (a crash, a kill, the app quitting), every terminal it held ends with code 1 and the
 *   next spawn starts a new host. The main process carries on (CA-1).
 */
import type { IDisposable, IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import type { BrowserWindow } from 'electron'
import type { PtyModule } from './session-start'
import type { DaemonPtyModule } from './daemon-pty'
import { HOST_GONE_EXIT_CODE, ptyHostMode, type PtyHostEvent, type PtyHostRequest } from './pty-host-protocol'
import { TERMINAL_PTY_PORT_CHANNEL } from '../../../../shared/types/ipc/terminal'

/** What this module needs of the host process: Electron's UtilityProcess in the app, a fake in tests. */
export interface PtyHostProcess {
  postMessage(request: PtyHostRequest, transfer?: unknown[]): void
  onMessage(listener: (event: PtyHostEvent) => void): void
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface DirectPortChannelPair {
  port1: unknown
  port2: unknown
}

export interface UtilityPtyModule extends PtyModule {
  /** The host's pid once it has reported it, for diagnostics; 0 before. */
  hostPid(): number
  /**
   * OXE-488 · Registers a renderer window for direct ptyHost <-> Renderer MessagePort transfer.
   * Transfers immediately if the host is already running, and re-transfers automatically if the host restarts.
   */
  attachWindow?(
    windowId: number,
    sendPortToRenderer: (port2: unknown) => void,
    createChannel: () => DirectPortChannelPair
  ): () => void
  dispose(): void
}

type ExitEvent = { exitCode: number; signal?: number }

/** node-pty's IEvent: a listener that throws does not stop the others, and still surfaces as an uncaught error. */
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

export class HostedPty implements IPty {
  pid = 0
  process: string
  cols: number
  rows: number
  private _handleFlowControl = false
  private _lastDataMeta: { seq?: number; direct?: boolean } | null = null
  private readonly data = new Emitter<string>()
  private readonly exit = new Emitter<ExitEvent>()
  private ended = false
  readonly onData = this.data.event
  readonly onExit = this.exit.event

  get hostSessionId(): number { return this.id }
  get lastDataMeta(): { seq?: number; direct?: boolean } | null { return this._lastDataMeta }

  get handleFlowControl(): boolean { return this._handleFlowControl }
  set handleFlowControl(enabled: boolean) {
    const next = Boolean(enabled)
    if (this._handleFlowControl === next) return
    this._handleFlowControl = next
    this.post({ t: 'flow-control', id: this.id, enabled: next })
  }

  /** Acknowledge parsed characters from the renderer for flow-control backpressure (OXE-483). */
  ackData(chars: number): void {
    if (!Number.isFinite(chars) || chars <= 0) return
    this.post({ t: 'ack', id: this.id, chars: Math.floor(chars) })
  }

  /** OXE-488 · Associates this hosted PTY session with its paneId so pty-host can route frames directly. */
  bindPane(paneId: string): void {
    this.post({ t: 'bind-pane', id: this.id, paneId })
  }

  /** OXE-488 · Toggles direct ptyHost -> Renderer MessagePort routing for an attached pane. */
  setDirectRoute(paneId: string, enabled: boolean): void {
    this.post({ t: 'direct-route', id: this.id, paneId, enabled })
  }

  constructor(private readonly id: number, private readonly send: (request: PtyHostRequest) => void, file: string, cols: number, rows: number) {
    this.process = file
    this.cols = cols
    this.rows = rows
  }

  resize(columns: number, rows: number): void {
    this.cols = columns
    this.rows = rows
    this.post({ t: 'resize', id: this.id, cols: columns, rows })
  }

  clear(): void { this.post({ t: 'clear', id: this.id }) }
  write(data: string | Buffer): void { this.post({ t: 'write', id: this.id, data: typeof data === 'string' ? data : data.toString('utf8') }) }
  kill(signal?: string): void { this.post({ t: 'kill', id: this.id, ...(signal ? { signal } : {}) }) }
  pause(): void { this.post({ t: 'pause', id: this.id }) }
  resume(): void { this.post({ t: 'resume', id: this.id }) }

  /** @internal The host's events for this terminal. */
  receive(event: PtyHostEvent): void {
    if (this.ended) return
    if (event.t === 'spawned') { this.pid = event.pid; if (event.process) this.process = event.process }
    else if (event.t === 'process') this.process = event.process
    else if (event.t === 'data') {
      this._lastDataMeta = (event.seq !== undefined || event.direct !== undefined)
        ? { seq: event.seq, direct: event.direct }
        : null
      try { this.data.fire(event.data) } finally { this._lastDataMeta = null }
    }
    else if (event.t === 'spawn-failed') { this.data.fire(`\r\n${event.message}\r\n`); this.end({ exitCode: 1 }) }
    else if (event.t === 'exit') this.end({ exitCode: event.exitCode, ...(event.signal ? { signal: event.signal } : {}) })
  }

  /** @internal Ends the terminal once; later events are ignored. */
  end(event: ExitEvent): void {
    if (this.ended) return
    this.ended = true
    this.exit.fire(event)
  }

  private post(request: PtyHostRequest): void {
    if (this.ended) return
    try { this.send(request) } catch { /* the host is gone; its exit ends this terminal */ }
  }
}

export function utilityPtyModule(forkHost: () => PtyHostProcess, onHostExit?: (code: number) => void): UtilityPtyModule {
  let host: PtyHostProcess | null = null
  let pid = 0
  let nextId = 1
  const terms = new Map<number, HostedPty>()
  const windows = new Map<number, { sendPort: (port2: unknown) => void; createChannel: () => DirectPortChannelPair }>()

  const transferPortToWindow = (current: PtyHostProcess, windowId: number, entry: { sendPort: (port2: unknown) => void; createChannel: () => DirectPortChannelPair }): void => {
    try {
      const { port1, port2 } = entry.createChannel()
      current.postMessage({ t: 'attach-renderer-port', windowId }, [port1])
      entry.sendPort(port2)
    } catch { /* graceful fallback to IPC when MessagePort transfer is unavailable */ }
  }

  const connect = (): PtyHostProcess => {
    if (host) return host
    const current = forkHost()
    host = current
    current.onMessage(event => {
      if (event.t === 'ready') { pid = event.pid; return }
      const term = terms.get(event.id)
      if (!term) return
      if (event.t === 'exit' || event.t === 'spawn-failed') terms.delete(event.id)
      term.receive(event)
    })
    current.onExit(code => {
      if (host === current) { host = null; pid = 0 }
      const gone = [...terms.values()]
      terms.clear()
      for (const term of gone) term.end({ exitCode: HOST_GONE_EXIT_CODE })
      onHostExit?.(code)
    })
    // Establish direct MessagePort channels for all registered windows whenever the host starts or restarts.
    for (const [windowId, entry] of windows) transferPortToWindow(current, windowId, entry)
    return current
  }

  return {
    spawn(file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions): IPty {
      const current = connect()
      const id = nextId++
      const term = new HostedPty(id, request => current.postMessage(request), file, options.cols ?? 80, options.rows ?? 24)
      terms.set(id, term)
      current.postMessage({ t: 'spawn', id, file, args, options })
      return term
    },
    hostPid: () => pid,
    attachWindow(windowId, sendPort, createChannel) {
      const entry = { sendPort, createChannel }
      windows.set(windowId, entry)
      if (host) transferPortToWindow(host, windowId, entry)
      return () => {
        if (windows.get(windowId) === entry) {
          windows.delete(windowId)
          try { host?.postMessage({ t: 'detach-renderer-port', windowId }) } catch { /* host already gone */ }
        }
      }
    },
    dispose() {
      const current = host
      host = null
      windows.clear()
      current?.kill()
    }
  }
}

/**
 * OXE-488 · Wires an Electron BrowserWindow to the utility PTY host via MessageChannelMain.
 * Re-establishes a fresh port on every `dom-ready` (initial load + reloads) and cleanly
 * detaches on `render-process-gone` or window close so no ports leak and no PTY deadlocks.
 */
export async function attachBrowserWindowToUtilityPty(
  utilityPty: UtilityPtyModule,
  window: BrowserWindow
): Promise<() => void> {
  if (typeof utilityPty.attachWindow !== 'function') return () => undefined
  const { MessageChannelMain } = await import('electron')
  if (typeof MessageChannelMain !== 'function') return () => undefined

  const windowId = window.webContents.id
  let detachCurrent: (() => void) | null = null
  let disposed = false

  const detach = (): void => {
    detachCurrent?.()
    detachCurrent = null
  }

  const establish = (): void => {
    if (disposed || window.isDestroyed()) return
    detach()
    detachCurrent = utilityPty.attachWindow!(
      windowId,
      (port2) => {
        if (disposed || window.isDestroyed()) return
        try {
          window.webContents.postMessage(
            TERMINAL_PTY_PORT_CHANNEL,
            { windowId },
            [port2 as Electron.MessagePortMain]
          )
        } catch { /* renderer navigated away; next dom-ready re-establishes */ }
      },
      () => new MessageChannelMain()
    )
  }

  const onDomReady = (): void => establish()
  const onGone = (): void => detach()
  const onClosed = (): void => cleanup()

  window.webContents.on('dom-ready', onDomReady)
  window.webContents.on('render-process-gone', onGone)
  window.once('closed', onClosed)
  if (!window.isDestroyed() && !window.webContents.isLoadingMainFrame()) establish()

  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    detach()
    if (!window.isDestroyed()) {
      window.webContents.removeListener('dom-ready', onDomReady)
      window.webContents.removeListener('render-process-gone', onGone)
    }
  }
  return cleanup
}

/**
 * The TerminalManager option electron/main/index.ts spreads: the PTY host (the built worker at `entry`) by default,
 * nothing (node-pty in main) when OXESPACE_PTY_HOST=main, or the detached PTY daemon when OXESPACE_PTY_HOST=daemon.
 */
export async function appPtyOption(
  env: NodeJS.ProcessEnv,
  entry: string,
  warn: (message: string) => void,
  daemonOptions?: { daemonEntry: string; userDataPath: string }
): Promise<{ pty?: UtilityPtyModule | DaemonPtyModule; utilityPty?: UtilityPtyModule; daemon?: DaemonPtyModule }> {
  const mode = ptyHostMode(env)
  if (mode === 'main') return {}
  if (mode === 'daemon' && daemonOptions) {
    try {
      const { connectOrStartPtyDaemon, createDaemonPtyModule } = await import('./daemon-pty')
      const client = await connectOrStartPtyDaemon({
        userDataPath: daemonOptions.userDataPath,
        entryPath: daemonOptions.daemonEntry
      })
      const daemon = createDaemonPtyModule(client)
      return { pty: daemon, daemon }
    } catch (error) {
      warn(`[terminal] detached PTY daemon unavailable, falling back to utility host: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const utilityPty = await appPtyHost(entry, warn)
  return { pty: utilityPty, utilityPty }
}

/** The app's PtyModule over the built worker at `entry`. */
export async function appPtyHost(entry: string, warn: (message: string) => void): Promise<UtilityPtyModule> {
  return utilityPtyModule(await forkUtilityPtyHost(entry), code => warn(`[terminal] PTY host exited (${code}); its terminals ended`))
}

/** The app's host: the built worker in a utility process named for getAppMetrics (serviceName). */
export async function forkUtilityPtyHost(entry: string): Promise<() => PtyHostProcess> {
  const { utilityProcess } = await import('electron')
  return () => {
    const child = utilityProcess.fork(entry, [], { serviceName: 'oxespace-pty-host' })
    return {
      postMessage: (request, transfer) => (
        transfer && transfer.length > 0
          ? child.postMessage(request, transfer as Electron.MessagePortMain[])
          : child.postMessage(request)
      ),
      onMessage: listener => { child.on('message', listener) },
      onExit: listener => { child.on('exit', listener) },
      kill: () => { child.kill() }
    }
  }
}
