import { randomBytes, timingSafeEqual } from 'node:crypto'
import { connect, createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import type {
  HostsProxyRow,
  HostsProxyStateKind,
  HostsProxyStatus
} from '../../../../shared/types/ipc'
import type { AppDatabase } from '../../db'

export type { HostsProxyRow, HostsProxyStateKind, HostsProxyStatus }

export const HOSTS_PROXY_IDLE_MS = 10 * 60_000

const DAY_MS = 86_400_000
const RETENTION_DAYS = 90
const DEFAULT_MAX_ROWS = 5000
const DEFAULT_MAX_CONNECTIONS = 256
const MAX_HEADER_BYTES = 32 * 1024
const CRASH_RETRY_MS = 150
const LOOPBACK_ENTRIES = ['localhost', '127.0.0.1', '::1'] as const

export interface HostsProxyLogger {
  info: (...parts: unknown[]) => void
  warn: (...parts: unknown[]) => void
  error: (...parts: unknown[]) => void
  debug?: (...parts: unknown[]) => void
}

export interface HostsProxyOptions {
  env?: NodeJS.ProcessEnv
  now?: () => number
  maxRows?: number
  idleTimeoutMs?: number
  maxConnections?: number
  logger?: HostsProxyLogger
  onListening?: (server: Server) => void
}

export type HostsProxyOrigin = { conversationId: string } | { paneId: string }

export interface HostsProxyGrant {
  env: Record<string, string>
  revoke: () => void
}

interface StoredGrant {
  secret: Buffer
  conversationId: string
}

interface DbHostRow {
  host: string
  port: number
  conversation_id: string
  count: number
  first_seen: number
  last_seen: number
  conversation_title: string | null
}

const NOOP_LOGGER: HostsProxyLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
}

/**
 * Local loopback outgoing-hosts proxy (1.5.0 A68 / H4, SECURITY S1–S6, HML 724-1..5).
 * Off by default; issues per-start credentials in memory only; logs only host and port per conversation;
 * splices CONNECT tunnels untouched and streams plain HTTP without buffering bodies.
 */
export class HostsProxy {
  private readonly baseEnv: NodeJS.ProcessEnv
  private readonly now: () => number
  private readonly maxRows: number
  private readonly idleTimeoutMs: number
  private readonly maxConnections: number
  private readonly logger: HostsProxyLogger
  private readonly onListening?: (server: Server) => void
  private readonly grants = new Map<string, StoredGrant>()
  private readonly openSockets = new Set<Socket>()
  private readonly listeners = new Set<() => void>()

  private enabled: boolean
  private state: HostsProxyStateKind = 'stopped'
  private reason: MainMessage | undefined
  private server: Server | null = null
  private port: number | null = null
  private activeConnections = 0
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(
    private readonly db: AppDatabase,
    options: HostsProxyOptions = {}
  ) {
    this.baseEnv = options.env ?? process.env
    this.now = options.now ?? (() => Date.now())
    this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
    this.idleTimeoutMs = options.idleTimeoutMs ?? HOSTS_PROXY_IDLE_MS
    this.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS
    this.logger = options.logger ?? NOOP_LOGGER
    this.onListening = options.onListening

    const saved = this.db
      .prepare('SELECT enabled FROM outgoing_hosts_settings WHERE id = 1')
      .get() as { enabled: number } | undefined
    this.enabled = saved?.enabled === 1
    if (this.enabled) {
      void this.startOrFail().catch(() => undefined)
    }
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  status(): HostsProxyStatus {
    return {
      enabled: this.enabled,
      state: this.state,
      ...(this.reason ? { reason: this.reason } : {}),
      hosts: this.readHosts()
    }
  }

  async setEnabled(on: boolean): Promise<HostsProxyStatus> {
    this.enabled = Boolean(on)
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO outgoing_hosts_settings (id, enabled)
           VALUES (1, ?)
           ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled`
        )
        .run(this.enabled ? 1 : 0)
      this.audit(this.enabled ? 'hosts-proxy-on' : 'hosts-proxy-off')
    })()

    if (this.enabled) {
      await this.startOrFail()
    } else {
      this.reason = undefined
      if (this.grants.size === 0) {
        this.cancelRecovery()
        await this.closeServer()
        this.state = 'stopped'
      }
      this.emitChanged()
    }
    return this.status()
  }

  async retry(): Promise<HostsProxyStatus> {
    if (!this.enabled) return this.status()
    await this.startOrFail()
    return this.status()
  }

  clear(): HostsProxyStatus {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM outgoing_hosts').run()
      this.audit('hosts-proxy-clear')
    })()
    this.emitChanged()
    return this.status()
  }

  grant(origin: HostsProxyOrigin): HostsProxyGrant {
    if (!this.enabled || this.state !== 'running' || this.port === null) {
      return { env: {}, revoke: () => undefined }
    }
    const id = randomBytes(8).toString('hex')
    const secretHex = randomBytes(16).toString('hex')
    const conversationId = 'conversationId' in origin ? origin.conversationId : ''
    this.grants.set(id, { secret: Buffer.from(secretHex, 'utf8'), conversationId })

    const proxyUrl = `http://${id}:${secretHex}@127.0.0.1:${this.port}`
    const noProxy = this.buildNoProxy()
    let revoked = false
    return {
      env: {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        NO_PROXY: noProxy,
        no_proxy: noProxy
      },
      revoke: () => {
        if (revoked) return
        revoked = true
        this.grants.delete(id)
        if (!this.enabled && this.grants.size === 0) {
          this.cancelRecovery()
          void this.closeServer().then(() => {
            if (!this.enabled && this.grants.size === 0) {
              this.state = 'stopped'
              this.emitChanged()
            }
          })
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.disposed = true
    this.cancelRecovery()
    this.grants.clear()
    for (const socket of [...this.openSockets]) {
      socket.destroy()
    }
    this.openSockets.clear()
    await this.closeServer()
    this.state = 'stopped'
  }

  private hasUserProxy(): boolean {
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'] as const) {
      const val = this.baseEnv[key]
      if (typeof val === 'string' && val.trim().length > 0) return true
    }
    return false
  }

  private buildNoProxy(): string {
    const raw = this.baseEnv.NO_PROXY ?? this.baseEnv.no_proxy ?? ''
    const entries = raw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
    for (const loopback of LOOPBACK_ENTRIES) {
      if (!entries.includes(loopback)) entries.push(loopback)
    }
    return entries.join(',')
  }

  private async startOrFail(): Promise<void> {
    this.cancelRecovery()
    if (this.hasUserProxy()) {
      await this.closeServer()
      this.state = 'failed'
      this.reason = mainMessage('hostsProxy.userProxy', {})
      this.emitChanged()
      return
    }
    if (this.server && this.server.listening && this.port !== null) {
      this.state = 'running'
      this.reason = undefined
      this.emitChanged()
      return
    }
    const desiredPort = this.port ?? 0
    try {
      await this.listenOn(desiredPort)
      this.state = 'running'
      this.reason = undefined
      this.emitChanged()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      this.state = 'failed'
      if (code === 'EADDRINUSE' && desiredPort > 0) {
        this.reason = mainMessage('hostsProxy.portInUse', { port: desiredPort })
      } else {
        this.reason = mainMessage('hostsProxy.failed', {})
      }
      this.logger.warn('hosts-proxy listen failed', code ?? 'error')
      this.emitChanged()
    }
  }

  private listenOn(targetPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer({ allowHalfOpen: false }, socket => this.handleClient(socket))
      let settled = false
      let intentionalClose = false
      ;(server as Server & { __intentionalClose?: () => void }).__intentionalClose = () => {
        intentionalClose = true
      }

      const onInitialError = (err: Error) => {
        if (settled) return
        settled = true
        try {
          server.close()
        } catch { /* ignore */ }
        reject(err)
      }

      server.once('error', onInitialError)
      server.listen(targetPort, '127.0.0.1', () => {
        if (settled) return
        settled = true
        server.removeListener('error', onInitialError)
        const address = server.address() as AddressInfo | null
        if (!address || typeof address.port !== 'number') {
          intentionalClose = true
          server.close()
          reject(new Error('No bound address'))
          return
        }
        this.server = server
        this.port = address.port

        const triggerCrashRecovery = () => {
          if (intentionalClose || this.disposed) return
          if (this.server === server) {
            this.server = null
          }
          if (!this.enabled && this.grants.size === 0) {
            this.state = 'stopped'
            this.emitChanged()
            return
          }
          this.scheduleRecovery(server)
        }

        server.on('error', () => {
          this.logger.warn('hosts-proxy listener error')
          triggerCrashRecovery()
        })
        server.on('close', () => {
          triggerCrashRecovery()
        })

        this.onListening?.(server)
        resolve()
      })
    })
  }

  private scheduleRecovery(crashedServer: Server): void {
    if (this.recoveryTimer || this.disposed) return
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null
      if (this.disposed || (!this.enabled && this.grants.size === 0)) return
      try {
        crashedServer.close()
      } catch { /* already closed */ }
      const port = this.port ?? 0
      void this.listenOn(port).then(
        () => {
          this.state = 'running'
          this.reason = undefined
          this.emitChanged()
        },
        (error: NodeJS.ErrnoException) => {
          this.state = 'failed'
          if (error?.code === 'EADDRINUSE' && port > 0) {
            this.reason = mainMessage('hostsProxy.portInUse', { port })
          } else {
            this.reason = mainMessage('hostsProxy.failed', {})
          }
          this.logger.warn('hosts-proxy recovery failed', error?.code ?? 'error')
          this.emitChanged()
        }
      )
    }, CRASH_RETRY_MS)
    this.recoveryTimer.unref?.()
  }

  private cancelRecovery(): void {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer)
      this.recoveryTimer = null
    }
  }

  private closeServer(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return Promise.resolve()
    ;(server as Server & { __intentionalClose?: () => void }).__intentionalClose?.()
    return new Promise(resolve => {
      try {
        server.close(() => resolve())
      } catch {
        resolve()
      }
    })
  }

  private trackSocket(socket: Socket): void {
    this.openSockets.add(socket)
    socket.once('close', () => {
      this.openSockets.delete(socket)
    })
  }

  private handleClient(clientSocket: Socket): void {
    this.trackSocket(clientSocket)
    clientSocket.setNoDelay(true)
    const onHeaderTimeout = () => {
      clientSocket.destroy()
    }
    clientSocket.setTimeout(Math.min(this.idleTimeoutMs, 30_000), onHeaderTimeout)
    clientSocket.on('error', () => {
      clientSocket.destroy()
    })

    const chunks: Buffer[] = []
    let totalBytes = 0

    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      totalBytes += chunk.length
      const combined = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalBytes)
      const headerEnd = combined.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        if (totalBytes > MAX_HEADER_BYTES) {
          clientSocket.removeListener('data', onData)
          this.replyAndClose(clientSocket, '431 Request Header Fields Too Large')
        }
        return
      }
      clientSocket.removeListener('data', onData)
      clientSocket.setTimeout(0, onHeaderTimeout)
      clientSocket.pause()
      const headerText = combined.subarray(0, headerEnd).toString('latin1')
      const remainder = combined.subarray(headerEnd + 4)
      this.dispatchRequest(clientSocket, headerText, remainder)
    }

    clientSocket.on('data', onData)
  }

  private dispatchRequest(clientSocket: Socket, headerText: string, remainder: Buffer): void {
    const lines = headerText.split('\r\n')
    const requestLine = lines[0] ?? ''
    const match = /^([A-Z]+)\s+(\S+)\s+(HTTP\/1\.[01])$/.exec(requestLine)
    if (!match) {
      this.logger.warn('hosts-proxy 400 malformed request line')
      this.replyAndClose(clientSocket, '400 Bad Request')
      return
    }
    const [, method, target, httpVersion] = match
    const headerLines = lines.slice(1)

    const authHeader = this.findHeader(headerLines, 'proxy-authorization')
    const grant = this.authenticate(authHeader)
    if (!grant) {
      this.logger.info('hosts-proxy 407')
      clientSocket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="oxespace"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
      )
      return
    }

    if (this.activeConnections >= this.maxConnections) {
      this.logger.warn('hosts-proxy 503 capacity')
      this.replyAndClose(clientSocket, '503 Service Unavailable')
      return
    }

    if (method === 'CONNECT') {
      const parsed = parseConnectTarget(target)
      if (!parsed) {
        this.replyAndClose(clientSocket, '400 Bad Request')
        return
      }
      if (this.enabled) {
        this.recordHost(parsed.host, parsed.port, grant.conversationId)
      }
      this.openTunnel(clientSocket, parsed.host, parsed.port, remainder)
      return
    }

    const parsedHttp = parseHttpTarget(target)
    if (!parsedHttp) {
      this.replyAndClose(clientSocket, '400 Bad Request')
      return
    }
    if (this.enabled) {
      this.recordHost(parsedHttp.host, parsedHttp.port, grant.conversationId)
    }
    const forwardHeaders = headerLines.filter(line => {
      const colon = line.indexOf(':')
      if (colon <= 0) return true
      const name = line.slice(0, colon).trim().toLowerCase()
      return name !== 'proxy-authorization' && name !== 'proxy-connection'
    })
    const headBuffer = Buffer.from(
      `${method} ${parsedHttp.originPath} ${httpVersion}\r\n${forwardHeaders.join('\r\n')}\r\n\r\n`,
      'latin1'
    )
    this.forwardHttp(clientSocket, parsedHttp.host, parsedHttp.port, headBuffer, remainder)
  }

  private openTunnel(clientSocket: Socket, host: string, port: number, remainder: Buffer): void {
    let released = false
    this.activeConnections += 1
    const release = () => {
      if (released) return
      released = true
      this.activeConnections = Math.max(0, this.activeConnections - 1)
    }

    const upstream = connect({ host, port })
    this.trackSocket(upstream)
    upstream.setNoDelay(true)
    let connected = false

    const destroyBoth = () => {
      release()
      if (!clientSocket.destroyed) clientSocket.destroy()
      if (!upstream.destroyed) upstream.destroy()
    }

    clientSocket.once('close', release)
    upstream.once('close', release)

    clientSocket.setTimeout(this.idleTimeoutMs, destroyBoth)
    upstream.setTimeout(this.idleTimeoutMs, destroyBoth)

    upstream.once('error', () => {
      this.logger.warn('hosts-proxy 502', `${host}:${port}`)
      if (!connected && !clientSocket.destroyed) {
        this.replyAndClose(clientSocket, '502 Bad Gateway')
      } else {
        destroyBoth()
      }
      release()
    })

    upstream.once('connect', () => {
      connected = true
      if (clientSocket.destroyed) {
        destroyBoth()
        return
      }
      this.logger.debug?.('hosts-proxy connect', `${host}:${port}`)
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (remainder.length > 0) {
        upstream.write(remainder)
      }
      clientSocket.pipe(upstream)
      upstream.pipe(clientSocket)
      clientSocket.resume()
    })
  }

  private forwardHttp(
    clientSocket: Socket,
    host: string,
    port: number,
    headBuffer: Buffer,
    remainder: Buffer
  ): void {
    let released = false
    this.activeConnections += 1
    const release = () => {
      if (released) return
      released = true
      this.activeConnections = Math.max(0, this.activeConnections - 1)
    }

    const upstream = connect({ host, port })
    this.trackSocket(upstream)
    upstream.setNoDelay(true)
    let connected = false

    const destroyBoth = () => {
      release()
      if (!clientSocket.destroyed) clientSocket.destroy()
      if (!upstream.destroyed) upstream.destroy()
    }

    clientSocket.once('close', release)
    upstream.once('close', release)

    clientSocket.setTimeout(this.idleTimeoutMs, destroyBoth)
    upstream.setTimeout(this.idleTimeoutMs, destroyBoth)

    upstream.once('error', () => {
      this.logger.warn('hosts-proxy 502', `${host}:${port}`)
      if (!connected && !clientSocket.destroyed) {
        this.replyAndClose(clientSocket, '502 Bad Gateway')
      } else {
        destroyBoth()
      }
      release()
    })

    upstream.once('connect', () => {
      connected = true
      if (clientSocket.destroyed) {
        destroyBoth()
        return
      }
      this.logger.debug?.('hosts-proxy http', `${host}:${port}`)
      upstream.write(headBuffer)
      if (remainder.length > 0) {
        upstream.write(remainder)
      }
      clientSocket.pipe(upstream)
      upstream.pipe(clientSocket)
      clientSocket.resume()
    })
  }

  private replyAndClose(socket: Socket, statusText: string): void {
    if (socket.destroyed) return
    socket.end(`HTTP/1.1 ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }

  private findHeader(headerLines: string[], lowerName: string): string | undefined {
    for (const line of headerLines) {
      const colon = line.indexOf(':')
      if (colon <= 0) continue
      if (line.slice(0, colon).trim().toLowerCase() === lowerName) {
        return line.slice(colon + 1).trim()
      }
    }
    return undefined
  }

  private authenticate(header: string | undefined): StoredGrant | null {
    if (!header) return null
    const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header)
    if (!match) return null
    let decoded: string
    try {
      decoded = Buffer.from(match[1], 'base64').toString('utf8')
    } catch {
      return null
    }
    const colon = decoded.indexOf(':')
    if (colon <= 0) return null
    const user = decoded.slice(0, colon)
    const candidate = Buffer.from(decoded.slice(colon + 1), 'utf8')
    const grant = this.grants.get(user)
    if (!grant || grant.secret.length !== candidate.length) return null
    return timingSafeEqual(grant.secret, candidate) ? grant : null
  }

  private recordHost(host: string, port: number, conversationId: string): void {
    const timestamp = this.now()
    const cutoff = timestamp - RETENTION_DAYS * DAY_MS
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM outgoing_hosts WHERE last_seen < ?').run(cutoff)
      const existing = this.db
        .prepare(
          'SELECT count, first_seen FROM outgoing_hosts WHERE host = ? AND port = ? AND conversation_id = ?'
        )
        .get(host, port, conversationId) as { count: number; first_seen: number } | undefined
      const nextCount = (existing?.count ?? 0) + 1
      const firstSeen = existing?.first_seen ?? timestamp
      this.db
        .prepare(
          `REPLACE INTO outgoing_hosts (host, port, conversation_id, count, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(host, port, conversationId, nextCount, firstSeen, timestamp)
      this.db
        .prepare(
          `DELETE FROM outgoing_hosts
           WHERE rowid NOT IN (
             SELECT rowid FROM outgoing_hosts
             ORDER BY last_seen DESC, rowid DESC
             LIMIT ?
           )`
        )
        .run(this.maxRows)
    })()
    this.emitChanged()
  }

  private readHosts(): HostsProxyRow[] {
    const cutoff = this.now() - RETENTION_DAYS * DAY_MS
    const rows = this.db
      .prepare(
        `SELECT
           oh.host,
           oh.port,
           oh.conversation_id,
           oh.count,
           oh.first_seen,
           oh.last_seen,
           json_extract(ct.data_json, '$.title') AS conversation_title
         FROM outgoing_hosts oh
         LEFT JOIN conversation_threads ct ON ct.id = oh.conversation_id
         WHERE oh.last_seen >= ?
         ORDER BY oh.last_seen DESC, oh.rowid DESC
         LIMIT ?`
      )
      .all(cutoff, this.maxRows) as DbHostRow[]

    return rows.map(row => {
      const item: HostsProxyRow = {
        host: row.host,
        port: Number(row.port),
        count: Number(row.count),
        lastSeen: Number(row.last_seen),
        firstSeen: Number(row.first_seen)
      }
      if (row.conversation_id) {
        item.conversationId = row.conversation_id
        if (typeof row.conversation_title === 'string' && row.conversation_title.length > 0) {
          item.conversationTitle = row.conversation_title
        }
      }
      return item
    })
  }

  private audit(action: 'hosts-proxy-on' | 'hosts-proxy-off' | 'hosts-proxy-clear'): void {
    this.db
      .prepare(
        `INSERT INTO person_action_audit (ts, actor, action, target, outcome)
         VALUES (?, 'person', ?, '', 'ok')`
      )
      .run(this.now(), action)
  }

  private emitChanged(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function parseConnectTarget(target: string): { host: string; port: number } | null {
  let host: string
  let portText: string
  if (target.startsWith('[')) {
    const match = /^\[([^\]]+)\]:(\d+)$/.exec(target)
    if (!match) return null
    host = match[1]
    portText = match[2]
  } else {
    const colon = target.lastIndexOf(':')
    if (colon <= 0) return null
    host = target.slice(0, colon)
    portText = target.slice(colon + 1)
  }
  const port = Number(portText)
  if (!isSafeHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: host.toLowerCase(), port }
}

function parseHttpTarget(target: string): { host: string; port: number; originPath: string } | null {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || !url.hostname) return null
  const rawHost = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
  const port = url.port ? Number(url.port) : 80
  if (!isSafeHost(rawHost) || !Number.isInteger(port) || port < 1 || port > 65535) return null
  const originPath = `${url.pathname || '/'}${url.search}`
  return { host: rawHost.toLowerCase(), port, originPath }
}

function isSafeHost(host: string): boolean {
  if (!host || host.length > 255) return false
  return !/[\s/?#@\\]/.test(host)
}
