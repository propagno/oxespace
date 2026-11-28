/**
 * OXE-400 · The PTY host: node-pty in an Electron utility process, so a fault in node-pty or in a terminal callback
 * ends this process, not the app (the measured proof in docs/validation/pty-rust-poc.md). Started by
 * electron/main/services/terminal/utility-pty.ts only when OXESPACE_PTY_HOST=utility.
 *
 * Every node-pty callback here is guarded: an exception in one must neither stop the message that reports the
 * terminal's exit (the proof saw a terminal that never ended) nor reach node-pty's native callback.
 */
import { spawn, type IPty, type IPtyForkOptions, type IWindowsPtyForkOptions } from 'node-pty'
import type { PtyHostEvent, PtyHostRequest } from '../services/terminal/pty-host-protocol'
import {
  ConptyKillSpawnThrottle,
  createDataFlushGuard,
  windowsConptyForkOptions,
  type DataFlushGuard
} from './conptyProtections'
import { PtyFlowControl } from './ptyFlowControl'
import { PtyOriginBatcher } from './ptyOriginBatcher'

type SpawnPtyFn = (file: string, args: string[], options: IPtyForkOptions | IWindowsPtyForkOptions) => IPty

interface HostedSession {
  pty: IPty
  batcher: PtyOriginBatcher
  flowControl: PtyFlowControl
  exitFlush: DataFlushGuard
}

export interface PtyHostRuntime {
  handle(request: PtyHostRequest): void
  ready(): void
  dispose(): void
}

const PROCESS_POLL_MS = 500

export function createPtyHostRuntime(
  send: (event: PtyHostEvent) => void,
  spawnPty: SpawnPtyFn = spawn,
  options: {
    batchMs?: number
    batchMaxBytes?: number
    highWatermark?: number
    lowWatermark?: number
    watchdogMs?: number
    platform?: NodeJS.Platform
    killSpawnThrottleMs?: number
    dataFlushTimeoutMs?: number
    exitQuietMs?: number
  } = {}
): PtyHostRuntime {
  const platform = options.platform ?? process.platform
  const sessions = new Map<number, HostedSession>()
  const pendingSpawns = new Map<number, () => void>()
  const killSpawnThrottle = new ConptyKillSpawnThrottle({
    platform,
    intervalMs: options.killSpawnThrottleMs
  })
  /** The foreground process name last reported per session; refreshed at most every PROCESS_POLL_MS while data flows. */
  const lastProcess = new Map<number, { name: string; at: number }>()

  function foreground(pty: IPty): string {
    try { return pty.process } catch { return '' }
  }

  function reportProcess(id: number, pty: IPty): void {
    const now = Date.now()
    const last = lastProcess.get(id)
    if (last && now - last.at < PROCESS_POLL_MS) return
    const name = foreground(pty)
    lastProcess.set(id, { name, at: now })
    if (name !== last?.name) send({ t: 'process', id, process: name })
  }

  function startNow(request: Extract<PtyHostRequest, { t: 'spawn' }>): void {
    pendingSpawns.delete(request.id)
    const forkOptions: IPtyForkOptions | IWindowsPtyForkOptions = {
      ...windowsConptyForkOptions(platform),
      ...request.options
    }
    let pty: IPty
    try {
      pty = spawnPty(request.file, request.args, forkOptions)
    } catch (error) {
      send({ t: 'spawn-failed', id: request.id, message: error instanceof Error ? error.message : String(error) })
      return
    }
    const flowControl = new PtyFlowControl(pty, {
      attached: false,
      highWatermark: options.highWatermark,
      lowWatermark: options.lowWatermark,
      watchdogMs: options.watchdogMs
    })
    const batcher = new PtyOriginBatcher({
      flushMs: options.batchMs,
      maxBytes: options.batchMaxBytes,
      onFlush: (data) => {
        flowControl.onData(data.length)
        send({ t: 'data', id: request.id, data })
        reportProcess(request.id, pty)
      }
    })
    const exitFlush = createDataFlushGuard({
      flush: () => batcher.flush(),
      timeoutMs: options.dataFlushTimeoutMs,
      quietMs: options.exitQuietMs ?? 0
    })
    sessions.set(request.id, { pty, batcher, flowControl, exitFlush })
    const name = foreground(pty)
    lastProcess.set(request.id, { name, at: Date.now() })
    send({ t: 'spawned', id: request.id, pid: pty.pid, process: name })
    pty.onData(data => {
      try {
        batcher.push(data)
        if (exitFlush.isExiting()) exitFlush.notifyData()
      } catch { /* never into node-pty's callback */ }
    })
    pty.onExit(({ exitCode, signal }) => {
      try {
        exitFlush.beginExit(() => {
          batcher.dispose()
          flowControl.dispose()
          exitFlush.dispose()
          sessions.delete(request.id)
          lastProcess.delete(request.id)
          send({ t: 'exit', id: request.id, exitCode, ...(signal ? { signal } : {}) })
        })
      } catch { /* never into node-pty's callback */ }
    })
  }

  function start(request: Extract<PtyHostRequest, { t: 'spawn' }>): void {
    const cancel = killSpawnThrottle.scheduleSpawn(() => startNow(request))
    if (!sessions.has(request.id)) {
      // Only tracked while deferred inside the win32 kill/spawn cooldown window.
      if (killSpawnThrottle.pendingCount() > 0) pendingSpawns.set(request.id, cancel)
    }
  }

  function handle(request: PtyHostRequest): void {
    if (request.t === 'spawn') { start(request); return }
    if (request.t === 'kill') {
      const cancelPending = pendingSpawns.get(request.id)
      if (cancelPending) {
        pendingSpawns.delete(request.id)
        cancelPending()
        send({ t: 'exit', id: request.id, exitCode: 0 })
        return
      }
    }
    const session = sessions.get(request.id)
    if (!session) return
    try {
      if (request.t === 'write') session.pty.write(request.data)
      else if (request.t === 'resize') { session.batcher.flush(); session.pty.resize(request.cols, request.rows) }
      else if (request.t === 'kill') {
        killSpawnThrottle.recordKill()
        session.batcher.flush()
        session.pty.kill(request.signal)
      }
      else if (request.t === 'clear') { session.batcher.flush(); session.pty.clear() }
      else if (request.t === 'pause') session.pty.pause()
      else if (request.t === 'resume') session.pty.resume()
      else if (request.t === 'ack') session.flowControl.ack(request.chars)
      else if (request.t === 'flow-control') session.flowControl.setAttached(request.enabled)
    } catch { /* the terminal is exiting; its exit message follows */ }
  }

  function dispose(): void {
    killSpawnThrottle.dispose()
    pendingSpawns.clear()
    for (const session of sessions.values()) {
      session.exitFlush.dispose()
      session.batcher.dispose()
      session.flowControl.dispose()
    }
    sessions.clear()
    lastProcess.clear()
  }

  return {
    handle,
    ready: () => send({ t: 'ready', pid: process.pid }),
    dispose
  }
}

if (process.parentPort) {
  const port = process.parentPort
  const runtime = createPtyHostRuntime(event => {
    try { port.postMessage(event) } catch { /* the main process is gone; this process ends with it */ }
  })
  port.on('message', ({ data }) => runtime.handle(data as PtyHostRequest))
  runtime.ready()
}
