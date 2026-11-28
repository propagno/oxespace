/**
 * OXE-488 · Preload-side direct MessagePort bridge for ptyHost <-> Renderer.
 *
 * Keeps the transferred MessagePort inside the isolated preload closure (contextIsolation: true),
 * routes direct PTY output frames straight to `window.oxe.terminal.onData` listeners with
 * per-(paneId, ptyId) sequence deduplication & tiny cross-transport reorder window, and sends
 * flow-control ACKs directly back to pty-host in 1 hop. Falls back seamlessly to Electron IPC
 * when no MessagePort is connected or for non-utility-host panes (in-process, daemon, SSH).
 */
import type { IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type TerminalDataEvent } from '../../shared/types/ipc'
import { TERMINAL_PTY_PORT_CHANNEL, type TerminalTransportStats } from '../../shared/types/ipc/terminal'

interface PreloadPortIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
  removeListener(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
}

interface RendererPortLike {
  postMessage(message: unknown): void
  start?: () => void
  close?: () => void
  onmessage: ((event: { data: unknown }) => void) | null
}

interface PaneSeqState {
  ptyId: number
  lastSeq: number
  pending: Map<number, string>
  timer: ReturnType<typeof setTimeout> | null
}

const REORDER_TIMEOUT_MS = 50

export interface TerminalPortBridge {
  onData: (paneId: string, listener: (event: TerminalDataEvent) => void) => () => void
  ack: (paneId: string, chars: number) => Promise<void> | void
  syncCursor: (paneId: string, ptyId: number, frameSeq: number) => void
  clearPane: (paneId: string) => void
  getStats: () => TerminalTransportStats
}

export function createTerminalPortBridge(
  ipc: PreloadPortIpc,
  options: { listenPortChannel?: boolean } = {}
): TerminalPortBridge {
  const listeners = new Map<string, Set<(event: TerminalDataEvent) => void>>()
  const states = new Map<string, PaneSeqState>()
  const directPanes = new Set<string>()
  let ipcDataHandler: ((event: IpcRendererEvent, payload: unknown) => void) | null = null
  let activePort: RendererPortLike | null = null

  let directFrames = 0
  let directBytes = 0
  let directAcks = 0
  let fallbackFrames = 0
  let fallbackBytes = 0
  let fallbackAcks = 0
  let dedupedFrames = 0
  let reorderedFrames = 0

  const dispatch = (paneId: string, event: TerminalDataEvent): void => {
    const targets = listeners.get(paneId)
    if (!targets) return
    for (const target of targets) target(event)
  }

  const clearTimer = (state: PaneSeqState): void => {
    if (state.timer !== null) { clearTimeout(state.timer); state.timer = null }
  }

  const drainConsecutive = (paneId: string, state: PaneSeqState): void => {
    while (state.pending.has(state.lastSeq + 1)) {
      const nextSeq = state.lastSeq + 1
      const data = state.pending.get(nextSeq)!
      state.pending.delete(nextSeq)
      state.lastSeq = nextSeq
      dispatch(paneId, { paneId, data, ptyId: state.ptyId, seq: nextSeq })
    }
    if (state.pending.size === 0) clearTimer(state)
  }

  const flushAllPending = (paneId: string, state: PaneSeqState): void => {
    clearTimer(state)
    if (state.pending.size === 0) return
    const ordered = [...state.pending.entries()].sort((a, b) => a[0] - b[0])
    state.pending.clear()
    for (const [seq, data] of ordered) {
      if (seq <= state.lastSeq) { dedupedFrames += 1; continue }
      state.lastSeq = seq
      dispatch(paneId, { paneId, data, ptyId: state.ptyId, seq })
    }
  }

  const stateFor = (paneId: string, ptyId: number): PaneSeqState => {
    let state = states.get(paneId)
    if (!state) {
      state = { ptyId, lastSeq: 0, pending: new Map(), timer: null }
      states.set(paneId, state)
      return state
    }
    if (state.ptyId !== ptyId) {
      flushAllPending(paneId, state)
      state.ptyId = ptyId
      state.lastSeq = 0
    }
    return state
  }

  const ingestFrame = (event: TerminalDataEvent, fromPort: boolean): void => {
    if (fromPort) {
      directFrames += 1
      directBytes += event.data.length
      directPanes.add(event.paneId)
    } else {
      fallbackFrames += 1
      fallbackBytes += event.data.length
    }

    if (typeof event.ptyId !== 'number' || typeof event.seq !== 'number') {
      dispatch(event.paneId, event)
      return
    }

    const state = stateFor(event.paneId, event.ptyId)
    if (event.seq <= state.lastSeq) {
      dedupedFrames += 1
      return
    }

    // IPC fallback frames come from the slower Main path and may coalesce multiple origin batches:
    // never hold them behind a gap; emit immediately, advance cursor, and drain buffered port frames.
    if (!fromPort || state.lastSeq === 0 || event.seq === state.lastSeq + 1) {
      state.lastSeq = event.seq
      state.pending.delete(event.seq)
      dispatch(event.paneId, event)
      drainConsecutive(event.paneId, state)
      return
    }

    // Direct port frame arrived slightly ahead of an in-flight IPC frame during attach transition.
    reorderedFrames += 1
    state.pending.set(event.seq, event.data)
    if (state.timer === null) {
      state.timer = setTimeout(() => {
        state.timer = null
        flushAllPending(event.paneId, state)
      }, REORDER_TIMEOUT_MS)
    }
  }

  const detachActivePort = (): void => {
    if (!activePort) return
    const prev = activePort
    activePort = null
    directPanes.clear()
    try { prev.onmessage = null; prev.close?.() } catch { /* already closed */ }
  }

  if (options.listenPortChannel) {
    ipc.on(TERMINAL_PTY_PORT_CHANNEL, (event) => {
      const port = (event as { ports?: RendererPortLike[] } | undefined)?.ports?.[0]
      if (!port) return
      detachActivePort()
      activePort = port
      port.onmessage = (msgEvent) => {
        const msg = (msgEvent && typeof msgEvent === 'object' && 'data' in msgEvent ? msgEvent.data : msgEvent) as
          | { t: 'data'; paneId: string; ptyId: number; seq: number; data: string }
          | { t: 'bound'; paneId: string; ptyId: number; enabled: boolean }
          | null
        if (!msg || typeof msg !== 'object') return
        if (msg.t === 'data') {
          ingestFrame({ paneId: msg.paneId, ptyId: msg.ptyId, seq: msg.seq, data: msg.data }, true)
        } else if (msg.t === 'bound') {
          if (msg.enabled) directPanes.add(msg.paneId)
          else directPanes.delete(msg.paneId)
        }
      }
      try { port.start?.() } catch { /* already started */ }
    })
  }

  return {
    onData(paneId, listener) {
      let targets = listeners.get(paneId)
      if (!targets) { targets = new Set(); listeners.set(paneId, targets) }
      targets.add(listener)
      if (!ipcDataHandler) {
        ipcDataHandler = (_event, payload) => ingestFrame(payload as TerminalDataEvent, false)
        ipc.on(IPC_CHANNELS.terminal.onData, ipcDataHandler)
      }
      return () => {
        const current = listeners.get(paneId)
        if (!current) return
        current.delete(listener)
        if (current.size === 0) listeners.delete(paneId)
        if (listeners.size === 0 && ipcDataHandler) {
          ipc.removeListener(IPC_CHANNELS.terminal.onData, ipcDataHandler)
          ipcDataHandler = null
        }
      }
    },
    ack(paneId, chars) {
      if (!Number.isFinite(chars) || chars <= 0) return
      const count = Math.floor(chars)
      if (activePort && directPanes.has(paneId)) {
        try {
          activePort.postMessage({ t: 'ack', paneId, chars: count })
          directAcks += 1
          return
        } catch {
          detachActivePort()
        }
      }
      fallbackAcks += 1
      return ipc.invoke(IPC_CHANNELS.terminal.ack, paneId, count) as Promise<void>
    },
    syncCursor(paneId, ptyId, frameSeq) {
      const state = stateFor(paneId, ptyId)
      if (frameSeq > state.lastSeq) state.lastSeq = frameSeq
      for (const seq of [...state.pending.keys()]) {
        if (seq <= state.lastSeq) { state.pending.delete(seq); dedupedFrames += 1 }
      }
      drainConsecutive(paneId, state)
    },
    clearPane(paneId) {
      directPanes.delete(paneId)
      const state = states.get(paneId)
      if (state) { clearTimer(state); states.delete(paneId) }
    },
    getStats() {
      return {
        transport: activePort ? 'message-port' : 'ipc-fallback',
        portConnected: activePort !== null,
        directFrames,
        directBytes,
        directAcks,
        fallbackFrames,
        fallbackBytes,
        fallbackAcks,
        dedupedFrames,
        reorderedFrames
      }
    }
  }
}
