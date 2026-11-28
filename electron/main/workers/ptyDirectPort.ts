/**
 * OXE-488 · Direct MessagePort router inside the pty-host utility process.
 *
 * Manages transferred Renderer MessagePorts (keyed by windowId) so high-frequency
 * PTY output frames and flow-control ACKs travel in 1 hop (`ptyHost <-> Renderer`),
 * bypassing Electron Main's IPC fan-out and event loop.
 *
 * Compatible with both Electron's `MessagePortMain` (message event `{ data }`) and
 * Node's `worker_threads.MessagePort` (direct payload value) for unit/integration tests.
 */
import type {
  PtyDirectFromRendererMessage,
  PtyDirectToRendererMessage
} from '../services/terminal/pty-host-protocol'

export interface DirectPortLike {
  postMessage(message: unknown): void
  start?: () => void
  close?: () => void
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  off?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

export interface PtyDirectPortStats {
  connectedPorts: number
  directFrames: number
  directBytes: number
  directAcks: number
  fallbackFrames: number
}

interface PortEntry {
  port: DirectPortLike
  onMessage: (raw: unknown) => void
  onClose: () => void
}

function unwrapPortMessage(raw: unknown): PtyDirectFromRendererMessage | null {
  const candidate = (raw && typeof raw === 'object' && 'data' in raw && !('t' in raw))
    ? (raw as { data: unknown }).data
    : raw
  if (!candidate || typeof candidate !== 'object' || !('t' in candidate)) return null
  const msg = candidate as Partial<PtyDirectFromRendererMessage>
  if (msg.t === 'ack' && typeof msg.paneId === 'string' && typeof msg.chars === 'number') {
    return { t: 'ack', paneId: msg.paneId, chars: msg.chars }
  }
  return null
}

function detachListener(port: DirectPortLike, event: string, listener: (...args: unknown[]) => void): void {
  try {
    if (typeof port.off === 'function') port.off(event, listener)
    else port.removeListener?.(event, listener)
  } catch { /* port already closed */ }
}

export class PtyDirectPortRouter {
  private readonly ports = new Map<number, PortEntry>()
  private readonly paneToId = new Map<string, number>()
  private readonly idToPane = new Map<number, string>()
  private directFrames = 0
  private directBytes = 0
  private directAcks = 0
  private fallbackFrames = 0

  constructor(
    private readonly hooks: {
      onAck: (id: number, chars: number) => void
      onAllPortsGone?: () => void
    }
  ) {}

  attachPort(windowId: number, port: DirectPortLike): void {
    // Replace any previous port for this windowId cleanly (e.g. renderer reload) without leaking handles.
    const previous = this.ports.get(windowId)
    if (previous) this.closeEntry(windowId, previous, false)

    const onMessage = (raw: unknown): void => {
      const msg = unwrapPortMessage(raw)
      if (!msg) return
      if (msg.t === 'ack') {
        const id = this.paneToId.get(msg.paneId)
        if (id === undefined) return
        this.directAcks += 1
        this.hooks.onAck(id, msg.chars)
      }
    }
    const onClose = (): void => {
      const current = this.ports.get(windowId)
      if (current && current.port === port) {
        this.closeEntry(windowId, current, true)
      }
    }

    const entry: PortEntry = { port, onMessage, onClose }
    this.ports.set(windowId, entry)
    port.on?.('message', onMessage)
    port.on?.('close', onClose)
    try { port.start?.() } catch { /* ignore if already started */ }
  }

  detachPort(windowId: number): void {
    const entry = this.ports.get(windowId)
    if (!entry) return
    this.closeEntry(windowId, entry, true)
  }

  bindPane(id: number, paneId: string): void {
    const prevPane = this.idToPane.get(id)
    if (prevPane && prevPane !== paneId && this.paneToId.get(prevPane) === id) {
      this.paneToId.delete(prevPane)
    }
    this.idToPane.set(id, paneId)
    this.paneToId.set(paneId, id)
  }

  unbindId(id: number): void {
    const paneId = this.idToPane.get(id)
    if (paneId === undefined) return
    this.idToPane.delete(id)
    if (this.paneToId.get(paneId) === id) this.paneToId.delete(paneId)
  }

  hasPorts(): boolean {
    return this.ports.size > 0
  }

  sendData(paneId: string, ptyId: number, seq: number, data: string): boolean {
    if (this.ports.size === 0) return false
    const delivered = this.broadcast({ t: 'data', paneId, ptyId, seq, data })
    if (delivered > 0) {
      this.directFrames += 1
      this.directBytes += data.length
      return true
    }
    return false
  }

  notifyBound(paneId: string, ptyId: number, enabled: boolean): void {
    if (this.ports.size === 0) return
    this.broadcast({ t: 'bound', paneId, ptyId, enabled })
  }

  recordFallback(): void {
    this.fallbackFrames += 1
  }

  stats(): PtyDirectPortStats {
    return {
      connectedPorts: this.ports.size,
      directFrames: this.directFrames,
      directBytes: this.directBytes,
      directAcks: this.directAcks,
      fallbackFrames: this.fallbackFrames
    }
  }

  dispose(): void {
    for (const [windowId, entry] of [...this.ports]) {
      this.closeEntry(windowId, entry, false)
    }
    this.ports.clear()
    this.paneToId.clear()
    this.idToPane.clear()
  }

  private broadcast(message: PtyDirectToRendererMessage): number {
    let delivered = 0
    for (const [windowId, entry] of [...this.ports]) {
      try {
        entry.port.postMessage(message)
        delivered += 1
      } catch {
        this.closeEntry(windowId, entry, true)
      }
    }
    return delivered
  }

  private closeEntry(windowId: number, entry: PortEntry, notifyIfEmpty: boolean): void {
    this.ports.delete(windowId)
    detachListener(entry.port, 'message', entry.onMessage)
    detachListener(entry.port, 'close', entry.onClose)
    try { entry.port.close?.() } catch { /* already closed */ }
    if (notifyIfEmpty && this.ports.size === 0) {
      this.hooks.onAllPortsGone?.()
    }
  }
}
