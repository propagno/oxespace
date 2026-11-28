import { chmodSync, unlinkSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { spawn as nodePtySpawn, type IPty, type IPtyForkOptions, type IWindowsPtyForkOptions } from 'node-pty'
import xtermHeadless from '@xterm/headless'
import { DA1_REPLY, Da1Filter } from '../services/pty-da1'
import { PtyModeTracker } from '../services/pty-mode-tracker'
import { PtyRingBuffer } from '../services/pty-ring-buffer'
import { PtyOriginBatcher } from './ptyOriginBatcher'
import {
  PTY_DAEMON_DEFAULT_IDLE_SHUTDOWN_MS,
  PTY_DAEMON_MAX_FRAME_BYTES,
  PTY_DAEMON_PROTOCOL_VERSION,
  assertLocalDaemonEndpoint,
  tokensEqual,
  type PtyDaemonAttachResult,
  type PtyDaemonEvent,
  type PtyDaemonRequest,
  type PtyDaemonResponse,
  type PtyDaemonSessionInfo
} from '../services/terminal/pty-daemon-protocol'
import type { PtyModule } from '../services/terminal/session-start'

const AUTH_TIMEOUT_MS = 5_000
const HEADLESS_SCROLLBACK = 2_000

interface SerializeAddonLike {
  serialize(): string
  dispose?(): void
}

type SerializeAddonCtor = new () => SerializeAddonLike

let serializeAddonPromise: Promise<SerializeAddonCtor | null> | null = null

/** Dynamically probes optional `@xterm/addon-serialize` without failing if absent. */
async function loadSerializeAddon(): Promise<SerializeAddonCtor | null> {
  if (!serializeAddonPromise) {
    const pkg = '@xterm/addon-serialize'
    serializeAddonPromise = import(/* @vite-ignore */ pkg)
      .then((mod: { SerializeAddon?: SerializeAddonCtor; default?: { SerializeAddon?: SerializeAddonCtor } }) =>
        mod.SerializeAddon ?? mod.default?.SerializeAddon ?? null
      )
      .catch(() => null)
  }
  return serializeAddonPromise
}

export interface PtyDaemonServerOptions {
  endpoint: string
  token: string
  platform?: NodeJS.Platform
  pty?: PtyModule
  ringCapacityBytes?: number
  idleShutdownMs?: number
  onIdleShutdown?: () => void
  onError?: (error: Error) => void
}

export interface PtyDaemonServer {
  readonly endpoint: string
  listen(): Promise<void>
  close(): Promise<void>
  shutdown(): Promise<{ terminated: number }>
  sessionCount(): number
}

interface DaemonSession {
  sessionId: string
  pty: IPty
  pid: number
  cols: number
  rows: number
  cwd: string
  startedAt: number
  alive: boolean
  processName: string
  ring: PtyRingBuffer
  modes: PtyModeTracker
  da1: Da1Filter
  screen: InstanceType<typeof xtermHeadless.Terminal>
  serializeAddon: SerializeAddonLike | null
  writeQueue: Promise<void>
  batcher: PtyOriginBatcher
  subscribers: Set<Socket>
}

interface ClientState {
  authenticated: boolean
  attachedSessions: Set<string>
}

function renderHeadlessFallback(terminal: InstanceType<typeof xtermHeadless.Terminal>): string {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine(i)
    if (line) lines.push(line.translateToString(true))
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\r\n')
}

function writeRawFrame(socket: Socket, serializedLine: string): void {
  if (socket.destroyed || !socket.writable) return
  try {
    socket.write(serializedLine)
  } catch {
    /* client socket already closing */
  }
}

function sendFrame(socket: Socket, frame: PtyDaemonResponse | PtyDaemonEvent): void {
  writeRawFrame(socket, `${JSON.stringify(frame)}\n`)
}

export function createPtyDaemonServer(options: PtyDaemonServerOptions): PtyDaemonServer {
  const platform = options.platform ?? process.platform
  assertLocalDaemonEndpoint(options.endpoint, platform)
  if (!options.token || options.token.length < 32) {
    throw new Error('PTY daemon requires a 32-byte auth token')
  }

  const ptyMod: PtyModule = options.pty ?? { spawn: nodePtySpawn }
  const idleShutdownMs = options.idleShutdownMs ?? PTY_DAEMON_DEFAULT_IDLE_SHUTDOWN_MS
  const sessions = new Map<string, DaemonSession>()
  const clients = new Map<Socket, ClientState>()
  let server: Server | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const cancelIdleTimer = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const scheduleIdleShutdownIfEmpty = (): void => {
    cancelIdleTimer()
    if (closed || sessions.size > 0 || idleShutdownMs <= 0) return
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (closed || sessions.size > 0) return
      void closeServer().then(() => {
        options.onIdleShutdown?.()
      })
    }, idleShutdownMs)
    idleTimer.unref?.()
  }

  const toInfo = (session: DaemonSession): PtyDaemonSessionInfo => ({
    sessionId: session.sessionId,
    pid: session.pid,
    cols: session.cols,
    rows: session.rows,
    cwd: session.cwd,
    startedAt: session.startedAt,
    alive: session.alive,
    process: session.processName
  })

  const captureSnapshot = async (session: DaemonSession): Promise<string> => {
    await session.writeQueue
    if (session.serializeAddon) {
      try {
        return session.serializeAddon.serialize()
      } catch {
        // Fall through to headless active-buffer snapshot.
      }
    }
    return renderHeadlessFallback(session.screen)
  }

  const spawnSession = async (req: Extract<PtyDaemonRequest, { type: 'spawnSession' }>): Promise<PtyDaemonSessionInfo> => {
    const existing = sessions.get(req.sessionId)
    if (existing && existing.alive) return toInfo(existing)

    cancelIdleTimer()
    const cols = Math.max(1, Math.min(1000, Math.floor(req.cols || 80)))
    const rows = Math.max(1, Math.min(1000, Math.floor(req.rows || 24)))
    const forkOptions: IPtyForkOptions | IWindowsPtyForkOptions = {
      name: 'xterm-256color',
      cwd: req.cwd,
      cols,
      rows,
      env: req.env ?? (process.env as Record<string, string>),
      ...(platform === 'win32' ? { useConptyDll: true } : {})
    }
    const pty = ptyMod.spawn(req.file, req.args, forkOptions)
    const screen = new xtermHeadless.Terminal({
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      scrollback: HEADLESS_SCROLLBACK,
      allowProposedApi: true
    })
    const SerializeCtor = await loadSerializeAddon()
    let serializeAddon: SerializeAddonLike | null = null
    if (SerializeCtor) {
      try {
        serializeAddon = new SerializeCtor()
        screen.loadAddon(serializeAddon as unknown as Parameters<typeof screen.loadAddon>[0])
      } catch {
        serializeAddon = null
      }
    }

    const session: DaemonSession = {
      sessionId: req.sessionId,
      pty,
      pid: pty.pid,
      cols,
      rows,
      cwd: req.cwd,
      startedAt: Date.now(),
      alive: true,
      processName: pty.process || req.file,
      ring: new PtyRingBuffer(options.ringCapacityBytes),
      modes: new PtyModeTracker(),
      da1: new Da1Filter(),
      screen,
      serializeAddon,
      writeQueue: Promise.resolve(),
      batcher: new PtyOriginBatcher({
        onFlush: (data) => {
          session.modes.consume(data)
          session.ring.push(data)
          session.writeQueue = session.writeQueue.then(
            () => new Promise<void>(resolve => {
              try {
                session.screen.write(data, () => resolve())
              } catch {
                resolve()
              }
            })
          )
          if (session.subscribers.size > 0) {
            const line = `${JSON.stringify({ event: 'data', sessionId: session.sessionId, data })}\n`
            for (const subscriber of session.subscribers) writeRawFrame(subscriber, line)
          }
        }
      }),
      subscribers: new Set<Socket>()
    }
    sessions.set(req.sessionId, session)

    pty.onData((chunk) => {
      try {
        const answerDa1 = session.subscribers.size === 0
        const filtered = session.da1.filter(chunk, answerDa1)
        if (filtered.answered > 0) {
          for (let i = 0; i < filtered.answered; i += 1) {
            try { pty.write(DA1_REPLY) } catch { /* exiting */ }
          }
        }
        if (filtered.data) session.batcher.push(filtered.data)
      } catch {
        /* never let callback errors crash node-pty */
      }
    })

    pty.onExit(({ exitCode, signal }) => {
      try {
        session.batcher.flush()
        session.batcher.dispose()
        session.alive = false
        sessions.delete(session.sessionId)
        for (const subscriber of session.subscribers) {
          sendFrame(subscriber, {
            event: 'exit',
            sessionId: session.sessionId,
            exitCode,
            ...(signal !== undefined ? { signal } : {})
          })
          clients.get(subscriber)?.attachedSessions.delete(session.sessionId)
        }
        session.subscribers.clear()
        try { session.screen.dispose() } catch { /* ignore */ }
        scheduleIdleShutdownIfEmpty()
      } catch {
        /* never let exit callbacks throw */
      }
    })

    return toInfo(session)
  }

  const detachSocket = (socket: Socket): void => {
    const state = clients.get(socket)
    if (!state) return
    for (const sessionId of state.attachedSessions) {
      sessions.get(sessionId)?.subscribers.delete(socket)
    }
    state.attachedSessions.clear()
    clients.delete(socket)
  }

  const shutdownAll = async (): Promise<{ terminated: number }> => {
    cancelIdleTimer()
    const active = [...sessions.values()]
    let terminated = 0
    for (const session of active) {
      terminated += 1
      session.batcher.dispose()
      session.alive = false
      sessions.delete(session.sessionId)
      session.subscribers.clear()
      try { session.pty.kill() } catch { /* already dead */ }
      try { session.screen.dispose() } catch { /* ignore */ }
    }
    await closeServer()
    return { terminated }
  }

  const closeServer = async (): Promise<void> => {
    if (closed) return
    closed = true
    cancelIdleTimer()
    for (const socket of [...clients.keys()]) {
      detachSocket(socket)
      socket.destroy()
    }
    const activeServer = server
    server = null
    if (activeServer) {
      await new Promise<void>(resolve => activeServer.close(() => resolve()))
    }
    if (platform !== 'win32') {
      try { unlinkSync(options.endpoint) } catch { /* already removed */ }
    }
  }

  const handleRequest = async (socket: Socket, state: ClientState, req: PtyDaemonRequest): Promise<void> => {
    const id = typeof req.id === 'number' ? req.id : 0
    if (!state.authenticated) {
      if (
        req.type !== 'hello' ||
        req.protocolVersion !== PTY_DAEMON_PROTOCOL_VERSION ||
        !tokensEqual(req.token, options.token)
      ) {
        sendFrame(socket, { id, ok: false, error: 'unauthorized' })
        detachSocket(socket)
        socket.end()
        socket.destroy()
        return
      }
      state.authenticated = true
      sendFrame(socket, { id, ok: true, result: { protocolVersion: PTY_DAEMON_PROTOCOL_VERSION, pid: process.pid } })
      return
    }

    try {
      if (req.type === 'hello') {
        sendFrame(socket, { id, ok: true, result: { protocolVersion: PTY_DAEMON_PROTOCOL_VERSION, pid: process.pid } })
        return
      }
      if (req.type === 'listSessions') {
        sendFrame(socket, { id, ok: true, result: [...sessions.values()].map(toInfo) })
        return
      }
      if (req.type === 'spawnSession') {
        const info = await spawnSession(req)
        sendFrame(socket, { id, ok: true, result: info })
        return
      }
      if (req.type === 'attachSession') {
        const session = sessions.get(req.sessionId)
        if (!session || !session.alive) {
          sendFrame(socket, { id, ok: false, error: `Session ${req.sessionId} not found` })
          return
        }
        session.batcher.flush()
        session.subscribers.add(socket)
        state.attachedSessions.add(session.sessionId)
        const snapshot = await captureSnapshot(session)
        const result: PtyDaemonAttachResult = {
          session: toInfo(session),
          snapshot,
          prologue: session.modes.prologue(),
          ringTail: session.ring.snapshot()
        }
        sendFrame(socket, { id, ok: true, result })
        return
      }
      if (req.type === 'detachSession') {
        sessions.get(req.sessionId)?.subscribers.delete(socket)
        state.attachedSessions.delete(req.sessionId)
        sendFrame(socket, { id, ok: true, result: { detached: true } })
        return
      }
      if (req.type === 'write') {
        const session = sessions.get(req.sessionId)
        if (!session || !session.alive) {
          sendFrame(socket, { id, ok: false, error: `Session ${req.sessionId} not found` })
          return
        }
        session.pty.write(req.data)
        sendFrame(socket, { id, ok: true, result: null })
        return
      }
      if (req.type === 'resize') {
        const session = sessions.get(req.sessionId)
        if (!session || !session.alive) {
          sendFrame(socket, { id, ok: false, error: `Session ${req.sessionId} not found` })
          return
        }
        const cols = Math.max(1, Math.min(1000, Math.floor(req.cols)))
        const rows = Math.max(1, Math.min(1000, Math.floor(req.rows)))
        session.batcher.flush()
        session.cols = cols
        session.rows = rows
        session.pty.resize(cols, rows)
        try { session.screen.resize(Math.max(cols, 20), Math.max(rows, 5)) } catch { /* ignore */ }
        sendFrame(socket, { id, ok: true, result: null })
        return
      }
      if (req.type === 'killSession') {
        const session = sessions.get(req.sessionId)
        if (session) {
          session.batcher.flush()
          try { session.pty.kill(req.signal) } catch { /* already dead */ }
        }
        sendFrame(socket, { id, ok: true, result: null })
        return
      }
      if (req.type === 'shutdown') {
        const active = [...sessions.values()]
        let terminated = 0
        for (const session of active) {
          terminated += 1
          session.batcher.dispose()
          session.alive = false
          sessions.delete(session.sessionId)
          session.subscribers.clear()
          try { session.pty.kill() } catch { /* already dead */ }
          try { session.screen.dispose() } catch { /* ignore */ }
        }
        sendFrame(socket, { id, ok: true, result: { terminated } })
        setImmediate(() => { void closeServer() })
        return
      }
      sendFrame(socket, { id, ok: false, error: 'Unsupported command' })
    } catch (error) {
      sendFrame(socket, { id, ok: false, error: error instanceof Error ? error.message : 'Daemon command failed' })
    }
  }

  const handleConnection = (socket: Socket): void => {
    const state: ClientState = { authenticated: false, attachedSessions: new Set() }
    clients.set(socket, state)
    socket.setEncoding('utf8')

    const authTimer = setTimeout(() => {
      if (!state.authenticated) {
        detachSocket(socket)
        socket.destroy()
      }
    }, AUTH_TIMEOUT_MS)
    authTimer.unref?.()

    let buffer = ''
    const cleanupSocket = (): void => {
      clearTimeout(authTimer)
      detachSocket(socket)
    }
    socket.on('close', cleanupSocket)
    socket.on('error', () => {
      cleanupSocket()
      socket.destroy()
    })

    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > PTY_DAEMON_MAX_FRAME_BYTES) {
        cleanupSocket()
        socket.destroy()
        return
      }
      let newlineIdx = buffer.indexOf('\n')
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (line) {
          let parsed: PtyDaemonRequest
          try {
            parsed = JSON.parse(line) as PtyDaemonRequest
          } catch {
            sendFrame(socket, { id: 0, ok: false, error: 'invalid_json' })
            if (!state.authenticated) {
              cleanupSocket()
              socket.destroy()
              return
            }
            newlineIdx = buffer.indexOf('\n')
            continue
          }
          void handleRequest(socket, state, parsed).then(() => {
            if (state.authenticated) clearTimeout(authTimer)
          })
          if (!state.authenticated && parsed.type !== 'hello') return
        }
        newlineIdx = buffer.indexOf('\n')
      }
    })
  }

  return {
    endpoint: options.endpoint,
    async listen(): Promise<void> {
      if (server) return
      if (platform !== 'win32') {
        try { unlinkSync(options.endpoint) } catch { /* stale socket may not exist */ }
      }
      const next = createServer(handleConnection)
      next.on('error', (err) => options.onError?.(err))
      await new Promise<void>((resolve, reject) => {
        next.once('error', reject)
        next.listen(options.endpoint, () => {
          next.off('error', reject)
          if (platform !== 'win32') {
            try { chmodSync(options.endpoint, 0o600) } catch { /* best-effort owner-only mode */ }
          }
          resolve()
        })
      })
      server = next
    },
    close: closeServer,
    shutdown: shutdownAll,
    sessionCount: () => sessions.size
  }
}

/** Standalone detached daemon entrypoint when spawned via `child_process.spawn`. */
if (process.env.OXESPACE_PTY_DAEMON_STANDALONE === '1') {
  const endpoint = process.env.OXESPACE_PTY_DAEMON_ENDPOINT ?? ''
  const token = process.env.OXESPACE_PTY_DAEMON_TOKEN ?? ''
  const idleRaw = Number(process.env.OXESPACE_PTY_DAEMON_IDLE_MS ?? '')
  const idleShutdownMs = Number.isFinite(idleRaw) && idleRaw > 0 ? idleRaw : PTY_DAEMON_DEFAULT_IDLE_SHUTDOWN_MS
  const daemon = createPtyDaemonServer({
    endpoint,
    token,
    idleShutdownMs,
    onIdleShutdown: () => { process.exit(0) }
  })
  void daemon.listen().catch(() => { process.exit(1) })
}
