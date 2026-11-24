/**
 * OXE-400 · The PTY host: node-pty in an Electron utility process, so a fault in node-pty or in a terminal callback
 * ends this process, not the app (the measured proof in docs/validation/pty-rust-poc.md). Started by
 * electron/main/services/terminal/utility-pty.ts only when OXESPACE_PTY_HOST=utility.
 *
 * Every node-pty callback here is guarded: an exception in one must neither stop the message that reports the
 * terminal's exit (the proof saw a terminal that never ended) nor reach node-pty's native callback.
 */
import { spawn, type IPty } from 'node-pty'
import type { PtyHostEvent, PtyHostRequest } from '../services/terminal/pty-host-protocol'

const port = process.parentPort
const sessions = new Map<number, IPty>()
/** The foreground process name last reported per session; refreshed at most every PROCESS_POLL_MS while data flows. */
const lastProcess = new Map<number, { name: string; at: number }>()
const PROCESS_POLL_MS = 500

function send(event: PtyHostEvent): void {
  try { port.postMessage(event) } catch { /* the main process is gone; this process ends with it */ }
}

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

function start(request: Extract<PtyHostRequest, { t: 'spawn' }>): void {
  let pty: IPty
  try {
    pty = spawn(request.file, request.args, request.options)
  } catch (error) {
    send({ t: 'spawn-failed', id: request.id, message: error instanceof Error ? error.message : String(error) })
    return
  }
  sessions.set(request.id, pty)
  const name = foreground(pty)
  lastProcess.set(request.id, { name, at: Date.now() })
  send({ t: 'spawned', id: request.id, pid: pty.pid, process: name })
  pty.onData(data => {
    try {
      send({ t: 'data', id: request.id, data })
      reportProcess(request.id, pty)
    } catch { /* never into node-pty's callback */ }
  })
  pty.onExit(({ exitCode, signal }) => {
    try {
      sessions.delete(request.id)
      lastProcess.delete(request.id)
      send({ t: 'exit', id: request.id, exitCode, ...(signal ? { signal } : {}) })
    } catch { /* never into node-pty's callback */ }
  })
}

function handle(request: PtyHostRequest): void {
  if (request.t === 'spawn') { start(request); return }
  const pty = sessions.get(request.id)
  if (!pty) return
  try {
    if (request.t === 'write') pty.write(request.data)
    else if (request.t === 'resize') pty.resize(request.cols, request.rows)
    else if (request.t === 'kill') pty.kill(request.signal)
    else if (request.t === 'clear') pty.clear()
    else if (request.t === 'pause') pty.pause()
    else if (request.t === 'resume') pty.resume()
  } catch { /* the terminal is exiting; its exit message follows */ }
}

port.on('message', ({ data }) => handle(data as PtyHostRequest))
send({ t: 'ready', pid: process.pid })
