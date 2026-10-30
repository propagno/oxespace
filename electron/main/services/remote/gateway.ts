import { createHash, createPrivateKey, randomBytes, X509Certificate } from 'node:crypto'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { AppDatabase } from '../../db'
import { mainMessage } from '../../../../shared/messages'
import {
  isHelloChallenge, pairingUri, pairingVerification, readPairRequest, REMOTE_LIMITS, REMOTE_PAIRING_PATH, REMOTE_PROTOCOL_VERSION,
  type RemoteAuthFrame, type RemotePairingErrorCode, type RemotePairResponse, type RemoteSubscription
} from '../../../../shared/remote/protocol'
import { REMOTE_MIN_PORT, type RemoteChange, type RemoteDevice, type RemoteGatewayStatus, type RemotePairingOffer } from '../../../../shared/types/remote'
import { createSecretCipher, type SafeStorageLike } from '../oxequery/secret-cipher'
import { certificateFingerprint, createGatewayCertificate } from './certificate'
import { RemoteConnection, type AuthOutcome, type ConnectionHost, type RemoteTopicSource } from './connection'
import { parseAnswerPairingInput, parseDeviceId, parseDeviceInput, parseRenameInput, parseSetEnabledInput } from './inputs'
import { isPrivateAddress, listenAddresses, peerAddress, type ListenAddress } from './network'
import { PAIRING_PROMPT_TIMEOUT_MS, PairingDesk } from './pairing'
import { RemoteStore, TooManyDevicesError, type DeviceRecord } from './store'
import { AccessTokens, readDevicePublicKey, sameSecret, verifyRefreshSignature } from './tokens'
import { refuseUpgrade, upgradeRefusal, WebSocketConnection } from './websocket'

/**
 * The desktop side of the remote gateway (B9 · M1–M3): HTTPS and WSS on one port, on private interfaces only, off
 * until the person turns it on in Settings › Devices, and off again on every launch. `POST /pair` pairs a phone after
 * the person accepts on screen; the WebSocket at `/` speaks the C5 protocol.
 *
 * Nothing here can reach the internal MCP server, agent executions or accounts: the gateway is built from the database,
 * `safeStorage` and the topic sources it is given, and nothing else.
 */

export const REMOTE_SOCKET_PATH = '/'
const MAX_CONNECTIONS = 16
const MAX_UNAUTHENTICATED_PER_ADDRESS = 4
const SEEN_WRITE_INTERVAL_MS = 60_000
const AUTH_FAILURE_AUDITS_PER_MINUTE = 20

export interface RemoteGatewayDeps {
  db: AppDatabase
  storage: SafeStorageLike
  broadcast(change: RemoteChange): void
  now?: () => number
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  /** Which interface addresses may be listened on; private ones only, unless a test says otherwise. */
  isAllowedAddress?: (address: string) => boolean
  desktopName?: string
  promptTimeoutMs?: number
  topics?: Partial<Record<RemoteSubscription, RemoteTopicSource>>
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

interface Running {
  port: number
  addresses: ListenAddress[]
  servers: https.Server[]
  fingerprint: string
  tokens: AccessTokens
}

class GatewayStartError extends Error {
  constructor(readonly reason: NonNullable<RemoteGatewayStatus['error']>) { super(reason.code) }
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Connection: 'close'
  })
  res.end(payload)
}

const PAIRING_STATUS: Record<RemotePairingErrorCode, number> = {
  malformed: 400, 'pairing-refused': 403, 'pairing-used': 409, 'too-many-devices': 409, 'pairing-expired': 410, 'pairing-locked': 429
}

/** The machine's name as the phone sees it: printable, at most 64 characters. Never an account or a path. */
export function displayName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, REMOTE_LIMITS.maxDeviceNameLength)
  return clean || 'OXESpace'
}

export class RemoteGateway implements ConnectionHost {
  readonly desktopName: string
  private readonly store: RemoteStore
  private readonly pairing: PairingDesk
  private running: Running | null = null
  private error: RemoteGatewayStatus['error']
  private queue: Promise<unknown> = Promise.resolve()
  private readonly connections = new Set<RemoteConnection>()
  private readonly sockets = new Set<Duplex>()
  private readonly commandTimes = new Map<string, number[]>()
  private readonly lastSeenWrite = new Map<string, number>()
  private authAudits = { windowStart: 0, count: 0 }

  constructor(private readonly deps: RemoteGatewayDeps) {
    this.store = new RemoteStore(deps.db, this.now)
    this.desktopName = displayName(deps.desktopName ?? hostname())
    this.pairing = new PairingDesk(this.now, deps.promptTimeoutMs ?? PAIRING_PROMPT_TIMEOUT_MS, prompt => this.deps.broadcast({ pairing: prompt }))
    this.store.pruneAudit()
  }

  readonly now = (): number => (this.deps.now ?? Date.now)()

  // ---- The window's channels ----------------------------------------------------------------------------------

  status(): RemoteGatewayStatus {
    const running = this.running
    const der = running ? null : this.store.settings().certificateDer
    return {
      enabled: !!running,
      listening: running ? { addresses: running.addresses.map(entry => entry.address), port: running.port } : null,
      fingerprint: running?.fingerprint ?? (der ? certificateFingerprint(der) : null),
      devices: this.store.activeCount(),
      maxDevices: REMOTE_LIMITS.maxDevices,
      ...(this.error ? { error: this.error } : {})
    }
  }

  devices(): RemoteDevice[] {
    const connected = new Set([...this.connections].map(connection => connection.deviceId).filter(Boolean))
    return this.store.devices().map(device => ({ deviceId: device.deviceId, name: device.name, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt, connected: connected.has(device.deviceId) }))
  }

  async setEnabled(value: unknown): Promise<RemoteGatewayStatus> {
    const input = parseSetEnabledInput(value)
    return this.serialize(async () => {
      if (!input.enabled) {
        await this.shutdown('person')
        this.error = undefined
      } else {
        const port = input.port ?? this.store.settings().port
        if (this.running?.port !== port) {
          await this.shutdown('restart')
          try {
            if (port < REMOTE_MIN_PORT) throw new GatewayStartError(mainMessage('remote.port.privileged', { port }))
            this.running = await this.start(port)
            this.error = undefined
            this.store.savePort(port)
            this.store.audit({ action: 'enable', outcome: 'ok', detail: `port ${port}` })
          } catch (caught) {
            this.error = caught instanceof GatewayStartError ? caught.reason : mainMessage('remote.certificate.failed', {})
            this.store.audit({ action: 'enable', outcome: 'failed', detail: this.error.code })
          }
        }
      }
      const status = this.status()
      this.deps.broadcast({ status, devices: this.devices() })
      return status
    })
  }

  startPairing(): RemotePairingOffer {
    const running = this.running
    if (!running) throw new Error('Turn the gateway on first')
    if (this.store.activeCount() >= REMOTE_LIMITS.maxDevices) throw new Error('Too many devices')
    const { code, expiresAt } = this.pairing.start()
    this.store.audit({ action: 'pairing-start', outcome: 'ok' })
    const host = running.addresses[0].address
    return { uri: pairingUri({ v: REMOTE_PROTOCOL_VERSION, host, port: running.port, fp: running.fingerprint, code, name: this.desktopName }), expiresAt }
  }

  cancelPairing(): void {
    if (this.pairing.cancel()) this.store.audit({ action: 'pairing-cancel', outcome: 'ok' })
  }

  answerPairing(value: unknown): void {
    const input = parseAnswerPairingInput(value)
    this.pairing.answer(input.promptId, input.accept)
  }

  revoke(value: unknown): void {
    const { deviceId } = parseDeviceInput(value)
    if (!this.store.revoke(deviceId)) throw new Error('Unknown device')
    for (const connection of this.connections) if (connection.deviceId === deviceId) connection.revoke()
    this.commandTimes.delete(deviceId)
    this.store.audit({ action: 'revoke', outcome: 'ok', deviceId })
    this.deps.broadcast({ devices: this.devices(), status: this.status() })
  }

  rename(value: unknown): RemoteDevice {
    const { deviceId, name } = parseRenameInput(value)
    if (!this.store.rename(deviceId, name)) throw new Error('Unknown device')
    this.store.audit({ action: 'rename', outcome: 'ok', deviceId })
    const devices = this.devices()
    this.deps.broadcast({ devices })
    return devices.find(device => device.deviceId === deviceId)!
  }

  /** On quit: closes everything, like switching it off. */
  stop(): Promise<void> {
    return this.serialize(() => this.shutdown('quit'))
  }

  // ---- Lifecycle ----------------------------------------------------------------------------------------------

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async start(port: number): Promise<Running> {
    const material = this.material()
    const addresses = listenAddresses((this.deps.interfaces ?? networkInterfaces)(), this.deps.isAllowedAddress ?? isPrivateAddress)
    if (!addresses.length) throw new GatewayStartError(mainMessage('remote.network.noPrivateInterface', {}))
    const servers: https.Server[] = [], bound: ListenAddress[] = []
    for (const address of addresses) {
      const server = this.createServer(material)
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject)
          server.listen({ host: address.host, port, exclusive: true }, () => { server.off('error', reject); resolve() })
        })
        servers.push(server); bound.push(address)
      } catch (caught) {
        const code = (caught as NodeJS.ErrnoException).code
        if (code === 'EADDRINUSE' || code === 'EACCES') {
          await Promise.all(servers.map(closeServer))
          throw new GatewayStartError(mainMessage('remote.port.inUse', { port }))
        }
        // An address that vanished or cannot be bound (an IPv6 zone, a disconnected adapter) is skipped.
      }
    }
    if (!servers.length) throw new GatewayStartError(mainMessage('remote.network.noPrivateInterface', {}))
    return { port, addresses: bound, servers, fingerprint: material.fingerprint, tokens: new AccessTokens(material.tokenKey, this.now) }
  }

  /** The certificate and token key, made the first time and read back from `safeStorage` after that. */
  private material(): { certificatePem: string; keyPem: string; fingerprint: string; tokenKey: Buffer } {
    const cipher = createSecretCipher(this.deps.storage, this.deps.platform, this.deps.env)
    if (!cipher.available()) throw new GatewayStartError(mainMessage('remote.certificate.failed', {}))
    const settings = this.store.settings()
    if (settings.certificateDer && settings.certificateKey && settings.tokenKey) {
      try {
        const certificate = new X509Certificate(settings.certificateDer)
        const keyPem = cipher.decrypt(settings.certificateKey)
        const tokenKey = Buffer.from(cipher.decrypt(settings.tokenKey), 'base64')
        if (!certificate.checkPrivateKey(createPrivateKey(keyPem)) || tokenKey.length !== 32) throw new Error('mismatch')
        return { certificatePem: certificate.toString(), keyPem, fingerprint: certificateFingerprint(settings.certificateDer), tokenKey }
      } catch {
        // The stored secrets cannot be read back (the system key changed): a new certificate means every phone's pin
        // is wrong, so every device is revoked and pairs again.
        const revoked = this.store.revokeAll()
        this.store.audit({ action: 'certificate', outcome: 'replaced', detail: `${revoked} devices revoked` })
      }
    }
    try {
      const certificate = createGatewayCertificate(this.now())
      const tokenKey = randomBytes(32)
      this.store.saveSecrets({ certificateDer: certificate.der, certificateKey: cipher.encrypt(certificate.keyPem), tokenKey: cipher.encrypt(tokenKey.toString('base64')) })
      this.store.audit({ action: 'certificate', outcome: 'created' })
      return { certificatePem: new X509Certificate(certificate.der).toString(), keyPem: certificate.keyPem, fingerprint: certificateFingerprint(certificate.der), tokenKey }
    } catch {
      throw new GatewayStartError(mainMessage('remote.certificate.failed', {}))
    }
  }

  private createServer(material: { certificatePem: string; keyPem: string }): https.Server {
    const server = https.createServer({
      cert: material.certificatePem, key: material.keyPem, minVersion: 'TLSv1.2', handshakeTimeout: 10_000, maxHeaderSize: 8 * 1024
    }, (req, res) => { void this.request(req, res) })
    server.headersTimeout = 10_000
    server.requestTimeout = (this.deps.promptTimeoutMs ?? PAIRING_PROMPT_TIMEOUT_MS) + 30_000
    server.keepAliveTimeout = 5_000
    server.maxHeadersCount = 64
    server.maxConnections = MAX_CONNECTIONS * 2
    server.on('connection', (socket: Socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.upgrade(req, socket, head))
    server.on('tlsClientError', () => { /* a client that is not speaking TLS, or not trusting us: nothing to answer */ })
    return server
  }

  private async shutdown(reason: 'person' | 'restart' | 'quit'): Promise<void> {
    const running = this.running
    this.running = null
    this.pairing.reset()
    if (!running) return
    for (const connection of this.connections) connection.close()
    // Gone as far as anyone asks from here on; each still records its last-seen time when its socket closes.
    this.connections.clear()
    const closing = Promise.all(running.servers.map(closeServer))
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await closing
    this.store.audit({ action: 'disable', outcome: 'ok', detail: reason })
  }

  // ---- HTTPS: pairing -----------------------------------------------------------------------------------------

  private async request(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const running = this.running
    if (!running) return json(res, 503, { code: 'not-found' })
    if (req.url !== REMOTE_PAIRING_PATH) return json(res, 404, { code: 'not-found' })
    if (req.method !== 'POST') return json(res, 405, { code: 'malformed' })
    const address = peerAddress(req.socket.remoteAddress)
    if (!this.pairing.attempt(address)) {
      this.store.audit({ action: 'pairing', outcome: 'pairing-locked', remoteAddress: address })
      return this.pairFailure(res, 'pairing-locked')
    }
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') return this.pairFailure(res, 'malformed')
    const body = await readBody(req, REMOTE_LIMITS.maxFrameBytes)
    if (body === null) return this.pairFailure(res, 'malformed')
    let parsed: unknown
    try { parsed = JSON.parse(body) } catch { return this.pairFailure(res, 'malformed') }
    const read = readPairRequest(parsed)
    if (!read.ok) return this.pairFailure(res, 'malformed')
    const publicKey = readDevicePublicKey(Buffer.from(read.request.publicKey, 'base64url'))
    if (!publicKey) return this.pairFailure(res, 'malformed')
    const outcome = (code: string) => this.store.audit({ action: 'pairing', outcome: code, remoteAddress: address })

    const claim = this.pairing.claim(read.request.code)
    if (claim !== 'ok') { outcome(claim); return this.pairFailure(res, claim) }
    if (this.store.activeCount() >= REMOTE_LIMITS.maxDevices) { outcome('too-many-devices'); return this.pairFailure(res, 'too-many-devices') }

    const asked = this.pairing.ask(read.request.deviceName, pairingVerification(createHash('sha256').update(publicKey).digest()))
    if (!asked) { outcome('pairing-refused'); return this.pairFailure(res, 'pairing-refused') }
    // A phone that hangs up takes its question off the screen.
    const abandon = () => { if (!res.writableEnded) this.pairing.settle(false, asked.promptId) }
    res.on('close', abandon)
    const accepted = await asked.answer
    res.off('close', abandon)
    if (res.destroyed || res.writableEnded) { outcome('abandoned'); return }
    if (!accepted || this.running !== running) { outcome('pairing-refused'); return this.pairFailure(res, 'pairing-refused') }
    let device: DeviceRecord
    try { device = this.store.addDevice(read.request.deviceName, publicKey) } catch (caught) {
      if (caught instanceof TooManyDevicesError) { outcome('too-many-devices'); return this.pairFailure(res, 'too-many-devices') }
      throw caught
    }
    const response: RemotePairResponse = { deviceId: device.deviceId, ...running.tokens.issue(device.deviceId) }
    this.store.audit({ action: 'pairing', outcome: 'paired', deviceId: device.deviceId, remoteAddress: address })
    json(res, 200, response)
    this.deps.broadcast({ devices: this.devices(), status: this.status() })
  }

  private pairFailure(res: ServerResponse, code: RemotePairingErrorCode): void {
    json(res, PAIRING_STATUS[code], { code })
  }

  // ---- WSS: the protocol --------------------------------------------------------------------------------------

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => socket.destroy())
    if (!this.running || req.url !== REMOTE_SOCKET_PATH) return refuseUpgrade(socket, 404)
    const refusal = upgradeRefusal(req)
    if (refusal !== null) return refuseUpgrade(socket, refusal)
    const address = peerAddress(req.socket.remoteAddress)
    if (this.connections.size >= MAX_CONNECTIONS) return refuseUpgrade(socket, 503)
    const waiting = [...this.connections].filter(connection => connection.address === address && !connection.deviceId).length
    if (waiting >= MAX_UNAUTHENTICATED_PER_ADDRESS) return refuseUpgrade(socket, 429)
    const connection = new RemoteConnection(address, this)
    const ws = new WebSocketConnection(socket, REMOTE_LIMITS.maxFrameBytes, {
      onText: text => connection.receive(text),
      onTooLarge: () => connection.tooLarge(),
      onClose: () => connection.closed()
    })
    connection.attach(ws)
    this.connections.add(connection)
    ;(socket as Socket).setNoDelay?.(true)
    ;(socket as Socket).setKeepAlive?.(true, 30_000)
    ws.accept(req.headers['sec-websocket-key'] as string, head)
  }

  authenticate(frame: RemoteAuthFrame, challenge: string, address: string): AuthOutcome {
    const running = this.running
    if (!running) return { ok: false, code: 'internal' }
    const outcome = this.check(running, frame, challenge)
    if (!outcome.ok) this.auditAuthFailure(outcome.code, address, 'deviceId' in outcome ? outcome.deviceId : undefined)
    return outcome.ok ? outcome : { ok: false, code: outcome.code }
  }

  private check(running: Running, frame: RemoteAuthFrame, challenge: string): AuthOutcome | { ok: false; code: 'unauthenticated' | 'token-expired' | 'revoked'; deviceId?: string } {
    if (frame.accessToken !== undefined) {
      const token = running.tokens.check(frame.accessToken)
      if (!token.ok) return token
      const device = this.store.device(token.deviceId)
      if (!device) return { ok: false, code: 'unauthenticated' }
      if (device.revoked) return { ok: false, code: 'revoked', deviceId: device.deviceId }
      // The same token back, with what is left of it: an access token never extends itself.
      return { ok: true, deviceId: device.deviceId, expiresAt: token.expiresAt, result: { accessToken: frame.accessToken, expiresInMs: token.expiresAt - this.now() } }
    }
    const refresh = frame.refresh!
    let deviceId: string
    try { deviceId = parseDeviceId(refresh.deviceId) } catch { return { ok: false, code: 'unauthenticated' } }
    const device = this.store.device(deviceId)
    if (!device) return { ok: false, code: 'unauthenticated' }
    if (device.revoked) return { ok: false, code: 'revoked', deviceId }
    if (!isHelloChallenge(refresh.nonce) || !sameSecret(refresh.nonce, challenge)) return { ok: false, code: 'unauthenticated', deviceId }
    if (!verifyRefreshSignature(device.publicKey, running.fingerprint, deviceId, refresh.nonce, refresh.signature)) return { ok: false, code: 'unauthenticated', deviceId }
    const result = running.tokens.issue(deviceId)
    return { ok: true, deviceId, expiresAt: this.now() + result.expiresInMs, result }
  }

  /** Recorded, but at most a few a minute, so a flood of bad connections cannot flood the trail. */
  private auditAuthFailure(code: string, address: string, deviceId?: string): void {
    const now = this.now()
    if (now - this.authAudits.windowStart >= 60_000) this.authAudits = { windowStart: now, count: 0 }
    if (++this.authAudits.count > AUTH_FAILURE_AUDITS_PER_MINUTE) return
    this.store.audit({ action: 'auth-failure', outcome: code, remoteAddress: address, deviceId: deviceId ?? null })
  }

  isRevoked(deviceId: string): boolean {
    return this.store.device(deviceId)?.revoked !== false
  }

  takeCommand(deviceId: string): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.now(), times = (this.commandTimes.get(deviceId) ?? []).filter(at => at > now - 60_000)
    if (times.length >= REMOTE_LIMITS.commandsPerMinute) {
      this.commandTimes.set(deviceId, times)
      return { ok: false, retryAfterMs: Math.max(1, times[0] + 60_000 - now) }
    }
    times.push(now)
    this.commandTimes.set(deviceId, times)
    return { ok: true }
  }

  topic(topic: RemoteSubscription): RemoteTopicSource | undefined {
    return this.deps.topics?.[topic]
  }

  authenticated(connection: RemoteConnection): void {
    this.lastSeenWrite.delete(connection.deviceId!)
    this.seen(connection.deviceId!)
    this.deps.broadcast({ devices: this.devices() })
  }

  seen(deviceId: string): void {
    const now = this.now()
    if (now - (this.lastSeenWrite.get(deviceId) ?? 0) < SEEN_WRITE_INTERVAL_MS) return
    this.lastSeenWrite.set(deviceId, now)
    this.store.touch(deviceId, now)
  }

  closed(connection: RemoteConnection): void {
    this.connections.delete(connection)
    if (!connection.deviceId) return
    this.store.touch(connection.deviceId, this.now())
    this.deps.broadcast({ devices: this.devices() })
  }
}

function closeServer(server: https.Server): Promise<void> {
  return new Promise(resolve => {
    server.close(() => resolve())
    server.closeAllConnections?.()
  })
}

/** The body as text, or null when it is larger than `limit` bytes or does not arrive whole. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) { req.resume(); return Promise.resolve(null) }
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let total = 0, done = false
    const finish = (value: string | null) => { if (!done) { done = true; resolve(value) } }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limit) { finish(null); req.removeAllListeners('data'); req.resume(); return }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
    req.on('aborted', () => finish(null))
  })
}
