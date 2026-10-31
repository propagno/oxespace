import { createHash, createPrivateKey, randomBytes, X509Certificate } from 'node:crypto'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { AppDatabase } from '../../db'
import { mainMessage, type MainMessage } from '../../../../shared/messages'
import { MainMessageError } from '../../ipc/main-message-error'
import {
  isHelloChallenge, pairingUri, pairingVerification, readPairRequest, REMOTE_LIMITS, REMOTE_PAIRING_PATH, REMOTE_PROTOCOL_VERSION, REMOTE_WS_PATH,
  type RemoteAuthFrame, type RemoteCommand, type RemotePairingErrorCode, type RemotePairResponse, type RemoteSubscription
} from '../../../../shared/remote/protocol'
import {
  REMOTE_DEFAULT_DESKTOP_NAME, REMOTE_MIN_PORT, type RemoteChange, type RemoteDevice, type RemoteGatewayStatus, type RemotePairingFailureReason, type RemotePairingOffer
} from '../../../../shared/types/remote'
import { createSecretCipher, type SafeStorageLike } from '../oxequery/secret-cipher'
import { certificateFingerprint, createGatewayCertificate } from './certificate'
import { auditDetail, RemoteCommands } from './commands'
import { mentionsForbidden, RemoteConnection, type AuthOutcome, type ConnectionHost, type RemoteCommandAnswer, type RemoteTopicSource } from './connection'
import type { RemoteDesktop } from './desktop'
import {
  cleanDeviceName, deviceNameProblem, deviceNotFound, parseAnswerPairingInput, parseDesktopNameInput, parseDeviceId, parseDeviceInput, parseRenameInput, parseSetEnabledInput, parseSetPhoneWriteInput
} from './inputs'
import { isPrivateAddress, listenAddresses, peerAddress, type ListenAddress } from './network'
import { PAIRING_PROMPT_TIMEOUT_MS, PairingDesk } from './pairing'
import { RemoteStore, TooManyDevicesError, type DeviceRecord } from './store'
import { createTopics } from './topics'
import { AccessTokens, readDevicePublicKey, sameSecret, verifyRefreshSignature } from './tokens'
import { frameSocket, refuseUpgrade, upgradeRefusal, WS_CLOSE } from './websocket'

/**
 * The desktop side of the remote gateway (B9 · M1–M3): HTTPS and WSS on one port, on private interfaces only, off
 * until the person turns it on in Settings › Devices, and off again on every launch. `POST /pair` pairs a phone after
 * the person accepts on screen; the WebSocket at `REMOTE_WS_PATH` (`/v1/ws`) speaks the C5 protocol, framed by `ws`.
 *
 * Nothing here can reach the internal MCP server, agent executions or accounts: the gateway is built from the database,
 * `safeStorage` and the `RemoteDesktop` it is given (M4 topics, M5 commands), and nothing else.
 */

const MAX_CONNECTIONS = 16
const MAX_UNAUTHENTICATED_PER_ADDRESS = 4
/** Connections still to sign in, across every address: half the slots, so signed-in phones always have the other half. */
const MAX_UNAUTHENTICATED = 8
const SEEN_WRITE_INTERVAL_MS = 60_000
const AUTH_FAILURE_AUDITS_PER_MINUTE = 20
/** Failed pairings told to the window per minute, so a flood of bad requests from the LAN cannot flood the window. */
const PAIRING_FAILURES_SHOWN_PER_MINUTE = 20

export interface RemoteGatewayDeps {
  db: AppDatabase
  storage: SafeStorageLike
  broadcast(change: RemoteChange): void
  /** A phone's pairing attempt failed: `remote.pairing.failed` with its reason only, never who or where. */
  pairingFailed?(message: MainMessage): void
  now?: () => number
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>
  /** Which interface addresses may be listened on; private ones only, unless a test says otherwise. */
  isAllowedAddress?: (address: string) => boolean
  promptTimeoutMs?: number
  /** What phones may watch and do (M4, M5). Without it no topic has data and every command is `forbidden`. */
  desktop?: RemoteDesktop
  /** Overrides of single topic sources (tests). */
  topics?: Partial<Record<RemoteSubscription, RemoteTopicSource>>
  /** Topic timings, for tests. */
  topicTiming?: { pollMs?: number; debounceMs?: number; flushMs?: number }
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Connection slots, for tests. */
  limits?: { connections?: number; unauthenticatedPerAddress?: number; unauthenticated?: number }
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
  malformed: 400, 'pairing-invalid': 403, 'pairing-refused': 403, 'reserved-name': 403, 'pairing-used': 409, 'too-many-devices': 409, 'pairing-expired': 410, 'pairing-locked': 429
}

/** What the window is told for each answer the phone gets. A question that timed out is `expired`, said where it happens. */
const PAIRING_FAILURE_REASON: Record<RemotePairingErrorCode, RemotePairingFailureReason> = {
  malformed: 'invalid', 'pairing-invalid': 'invalid', 'pairing-used': 'invalid', 'pairing-locked': 'invalid', 'pairing-expired': 'expired',
  'pairing-refused': 'refused', 'too-many-devices': 'limit', 'reserved-name': 'reserved-name'
}

export class RemoteGateway implements ConnectionHost {
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
  private pairingFailuresShown = { windowStart: 0, count: 0 }
  /** Panes the person let phones type into: in memory only, so off on every launch, and never set by a phone or MCP. */
  private readonly phoneWritePanes = new Set<string>()
  private readonly workspaceListeners = new Set<() => void>()
  private readonly rateLimitAudited = new Map<string, number>()
  private readonly topics: Partial<Record<RemoteSubscription, RemoteTopicSource>>
  private readonly commands: RemoteCommands | null
  /** Signs access tokens. Made at each launch and kept only in memory: a restart ends every access token, never a pairing. */
  private readonly tokenKey = randomBytes(32)
  /** `ws` with compression off and the C5 frame cap; it never listens itself, upgrades are handed to it. */
  private readonly websockets = new WebSocketServer({ noServer: true, maxPayload: REMOTE_LIMITS.maxFrameBytes, perMessageDeflate: false, clientTracking: false })

  constructor(private readonly deps: RemoteGatewayDeps) {
    this.store = new RemoteStore(deps.db, this.now)
    this.pairing = new PairingDesk(this.now, deps.promptTimeoutMs ?? PAIRING_PROMPT_TIMEOUT_MS, prompt => this.deps.broadcast({ pairing: prompt }))
    this.store.pruneAudit()
    const desktop = deps.desktop
    this.topics = {
      ...(desktop ? createTopics({
        desktop, phoneWrite: () => this.phoneWritePanes, ...deps.topicTiming,
        onWorkspacesChanged: listener => { this.workspaceListeners.add(listener); return () => { this.workspaceListeners.delete(listener) } }
      }) : {}),
      ...deps.topics
    }
    this.commands = desktop ? new RemoteCommands({ desktop, now: this.now, phoneWrite: () => this.phoneWritePanes }) : null
  }

  readonly now = (): number => (this.deps.now ?? Date.now)()

  /** What phones see in `hello` and the QR: "OXESpace" or the person's choice, never the host name. */
  get desktopName(): string {
    return this.store.settings().desktopName ?? REMOTE_DEFAULT_DESKTOP_NAME
  }

  // ---- The window's channels ----------------------------------------------------------------------------------

  status(): RemoteGatewayStatus {
    const running = this.running, settings = this.store.settings()
    const der = running ? null : settings.certificateDer
    return {
      enabled: !!running,
      desktopName: settings.desktopName ?? REMOTE_DEFAULT_DESKTOP_NAME,
      listening: running ? { addresses: running.addresses.map(entry => entry.address), port: running.port } : null,
      fingerprint: running?.fingerprint ?? (der ? certificateFingerprint(der) : null),
      devices: this.store.activeCount(),
      maxDevices: REMOTE_LIMITS.maxDevices,
      phoneWritePanes: [...this.phoneWritePanes].sort(),
      listenedBefore: settings.listenedBefore,
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
        // Turning it off also takes back every pane the phone could type into.
        this.clearPhoneWrite()
      } else {
        const port = input.port ?? this.store.settings().port
        if (this.running?.port !== port) {
          await this.shutdown('restart')
          try {
            if (port < REMOTE_MIN_PORT) throw new GatewayStartError(mainMessage('remote.port.privileged', { port }))
            this.running = await this.start(port)
            this.error = undefined
            this.store.savePort(port)
            this.store.markListened()
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
    if (!running) throw new MainMessageError(mainMessage('remote.gateway.offline', {}), 'Turn the gateway on first')
    if (this.store.activeCount() >= REMOTE_LIMITS.maxDevices) {
      throw new MainMessageError(mainMessage('remote.pairing.limit', { max: REMOTE_LIMITS.maxDevices }), 'Too many devices')
    }
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
    if (!this.store.revoke(deviceId)) throw deviceNotFound()
    for (const connection of this.connections) if (connection.deviceId === deviceId) connection.revoke()
    this.commandTimes.delete(deviceId)
    this.commands?.forget(deviceId)
    this.store.audit({ action: 'revoke', outcome: 'ok', deviceId })
    this.deps.broadcast({ devices: this.devices(), status: this.status() })
  }

  rename(value: unknown): RemoteDevice {
    const { deviceId, name } = parseRenameInput(value)
    if (!this.store.rename(deviceId, name)) throw deviceNotFound()
    this.store.audit({ action: 'rename', outcome: 'ok', deviceId })
    const devices = this.devices()
    this.deps.broadcast({ devices })
    return devices.find(device => device.deviceId === deviceId)!
  }

  setDesktopName(value: unknown): RemoteGatewayStatus {
    const { name } = parseDesktopNameInput(value)
    this.store.saveDesktopName(name)
    this.store.audit({ action: 'desktop-name', outcome: name === null ? 'default' : 'set' })
    const status = this.status()
    this.deps.broadcast({ status })
    return status
  }

  /** Lets phones type into one pane, or stops it. The window's own action: never a phone command or an MCP tool. */
  setPhoneWrite(value: unknown): RemoteGatewayStatus {
    const { paneId, allowed } = parseSetPhoneWriteInput(value)
    const changed = allowed !== this.phoneWritePanes.has(paneId)
    if (allowed) this.phoneWritePanes.add(paneId)
    else this.phoneWritePanes.delete(paneId)
    if (changed) {
      this.store.audit({ action: 'phone-write', outcome: allowed ? 'on' : 'off', detail: paneId })
      this.workspacesChanged()
    }
    const status = this.status()
    this.deps.broadcast({ status })
    return status
  }

  private clearPhoneWrite(): void {
    if (!this.phoneWritePanes.size) return
    this.phoneWritePanes.clear()
    this.store.audit({ action: 'phone-write', outcome: 'cleared' })
    this.workspacesChanged()
  }

  private workspacesChanged(): void {
    for (const listener of [...this.workspaceListeners]) { try { listener() } catch { /* a closed subscription */ } }
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
    return { port, addresses: bound, servers, fingerprint: material.fingerprint, tokens: new AccessTokens(this.tokenKey, this.now) }
  }

  /** The certificate, made the first time and read back from `safeStorage` after that. */
  private material(): { certificatePem: string; keyPem: string; fingerprint: string } {
    const cipher = createSecretCipher(this.deps.storage, this.deps.platform, this.deps.env)
    if (!cipher.available()) throw new GatewayStartError(mainMessage('remote.certificate.failed', {}))
    const settings = this.store.settings()
    if (settings.certificateDer && settings.certificateKey) {
      try {
        const certificate = new X509Certificate(settings.certificateDer)
        const keyPem = cipher.decrypt(settings.certificateKey)
        if (!certificate.checkPrivateKey(createPrivateKey(keyPem))) throw new Error('mismatch')
        return { certificatePem: certificate.toString(), keyPem, fingerprint: certificateFingerprint(settings.certificateDer) }
      } catch {
        // The stored key cannot be read back (the system key changed): a new certificate means every phone's pin
        // is wrong, so every device is revoked and pairs again.
        const revoked = this.store.revokeAll()
        this.store.audit({ action: 'certificate', outcome: 'replaced', detail: `${revoked} devices revoked` })
      }
    }
    try {
      const certificate = createGatewayCertificate(this.now())
      this.store.saveCertificate({ der: certificate.der, encryptedKey: cipher.encrypt(certificate.keyPem) })
      this.store.audit({ action: 'certificate', outcome: 'created' })
      return { certificatePem: new X509Certificate(certificate.der).toString(), keyPem: certificate.keyPem, fingerprint: certificateFingerprint(certificate.der) }
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
    for (const connection of this.connections) { connection.close(WS_CLOSE.goingAway); connection.closed() }
    // Each was settled above (last-seen written); the late close events from `ws` find nothing left to do.
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
    // The name the phone chose, without invisible format characters. A name only the app may speak as is refused
    // before the code is spent: the phone hears `reserved-name` (it checks the same lists first), the window the reason.
    const deviceName = cleanDeviceName(read.request.deviceName)
    const named = deviceNameProblem(deviceName)
    if (named === 'invalid') return this.pairFailure(res, 'malformed')
    if (named === 'reserved') { outcome('reserved-name'); return this.pairFailure(res, 'reserved-name') }

    const claim = this.pairing.claim(read.request.code)
    if (claim !== 'ok') { outcome(claim); return this.pairFailure(res, claim) }
    if (this.store.activeCount() >= REMOTE_LIMITS.maxDevices) { outcome('too-many-devices'); return this.pairFailure(res, 'too-many-devices') }

    const asked = this.pairing.ask(deviceName, pairingVerification(createHash('sha256').update(publicKey).digest()))
    if (!asked) { outcome('pairing-refused'); return this.pairFailure(res, 'pairing-refused') }
    // A phone that hangs up takes its question off the screen.
    const abandon = () => { if (!res.writableEnded) this.pairing.settle('abandoned', asked.promptId) }
    res.on('close', abandon)
    const answer = await asked.answer
    res.off('close', abandon)
    // The phone hung up while the question was on screen: nobody to answer, but the window is told why it closed.
    if (res.destroyed || res.writableEnded) { outcome('abandoned'); this.tellPairingFailed('peer-closed'); return }
    // No answer in time is `expired` for the window; the phone hears `pairing-refused` either way.
    if (answer === 'expired') { outcome('pairing-refused'); return this.pairFailure(res, 'pairing-refused', 'expired') }
    if (answer !== 'accepted' || this.running !== running) { outcome('pairing-refused'); return this.pairFailure(res, 'pairing-refused') }
    let device: DeviceRecord
    try { device = this.store.addDevice(deviceName, publicKey) } catch (caught) {
      if (caught instanceof TooManyDevicesError) { outcome('too-many-devices'); return this.pairFailure(res, 'too-many-devices') }
      throw caught
    }
    const response: RemotePairResponse = { deviceId: device.deviceId, ...running.tokens.issue(device.deviceId) }
    this.store.audit({ action: 'pairing', outcome: 'paired', deviceId: device.deviceId, remoteAddress: address })
    json(res, 200, response)
    this.deps.broadcast({ devices: this.devices(), status: this.status() })
  }

  /** The phone's answer, and the window's: every failed attempt reaches it once, with the reason and nothing else. */
  private pairFailure(res: ServerResponse, code: RemotePairingErrorCode, reason = PAIRING_FAILURE_REASON[code]): void {
    json(res, PAIRING_STATUS[code], { code })
    this.tellPairingFailed(reason)
  }

  /** `remote.pairing.failed` to the window, at most `PAIRING_FAILURES_SHOWN_PER_MINUTE` a minute. */
  private tellPairingFailed(reason: RemotePairingFailureReason): void {
    const now = this.now()
    if (now - this.pairingFailuresShown.windowStart >= 60_000) this.pairingFailuresShown = { windowStart: now, count: 0 }
    if (++this.pairingFailuresShown.count > PAIRING_FAILURES_SHOWN_PER_MINUTE) return
    try { this.deps.pairingFailed?.(mainMessage('remote.pairing.failed', { reason })) } catch { /* a closed window */ }
  }

  // ---- WSS: the protocol --------------------------------------------------------------------------------------

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => socket.destroy())
    if (!this.running || req.url !== REMOTE_WS_PATH) return refuseUpgrade(socket, 404)
    const refusal = upgradeRefusal(req)
    if (refusal !== null) return refuseUpgrade(socket, refusal)
    const address = peerAddress(req.socket.remoteAddress)
    const limits = { connections: MAX_CONNECTIONS, unauthenticatedPerAddress: MAX_UNAUTHENTICATED_PER_ADDRESS, unauthenticated: MAX_UNAUTHENTICATED, ...this.deps.limits }
    const waiting = [...this.connections].filter(connection => !connection.deviceId)
    if (waiting.filter(connection => connection.address === address).length >= limits.unauthenticatedPerAddress) return refuseUpgrade(socket, 429)
    // Connections still to sign in share a bounded number of slots across every address, and the oldest makes room for
    // a new one: a few addresses holding sockets open cannot take every slot, and a phone that signs in keeps its own.
    if (waiting.length >= limits.unauthenticated) waiting[0].evict()
    if (this.connections.size >= limits.connections) return refuseUpgrade(socket, 503)
    // `ws` checks the handshake itself (version, key) and answers 400 to a bad one.
    this.websockets.handleUpgrade(req, socket, head, ws => {
      const connection = new RemoteConnection(address, this)
      connection.attach(frameSocket(ws))
      this.connections.add(connection)
      ;(socket as Socket).setNoDelay?.(true)
      ;(socket as Socket).setKeepAlive?.(true, 30_000)
      ws.on('message', (data, isBinary) => {
        if (isBinary) return connection.close(WS_CLOSE.unsupportedData)
        connection.receive(Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.concat(data as Buffer[]).toString('utf8'))
      })
      // A frame over the cap, bad UTF-8, an unmasked frame: `ws` closes with the matching code by itself.
      ws.on('error', () => { setTimeout(() => ws.terminate(), 500).unref?.() })
      ws.on('close', () => connection.closed())
    })
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

  async runCommand(deviceId: string, command: RemoteCommand, args: unknown): Promise<RemoteCommandAnswer> {
    const taken = this.takeCommand(deviceId)
    if (!taken.ok) {
      this.auditRateLimited(deviceId, command)
      return { ok: false, code: 'rate-limited', retryAfterMs: taken.retryAfterMs }
    }
    let answer: RemoteCommandAnswer
    if (args !== undefined && mentionsForbidden(args)) answer = { ok: false, code: 'forbidden' }
    else if (!this.commands) answer = { ok: false, code: 'forbidden' }
    else answer = await this.commands.run(deviceId, command, args)
    this.store.audit({ action: 'command', outcome: answer.ok ? 'ok' : answer.code, deviceId, detail: auditDetail(command, args) })
    return answer
  }

  unknownCommand(deviceId: string): RemoteCommandAnswer {
    const taken = this.takeCommand(deviceId)
    if (!taken.ok) {
      this.auditRateLimited(deviceId, 'unknown')
      return { ok: false, code: 'rate-limited', retryAfterMs: taken.retryAfterMs }
    }
    // The name the phone sent is not recorded: it is anything the phone chose.
    this.store.audit({ action: 'command', outcome: 'unknown-command', deviceId, detail: 'unknown' })
    return { ok: false, code: 'unknown-command' }
  }

  /** The first refusal of each minute per device is recorded, so a phone hammering the limit cannot flood the trail. */
  private auditRateLimited(deviceId: string, command: string): void {
    const now = this.now(), last = this.rateLimitAudited.get(deviceId)
    if (last !== undefined && now - last < 60_000) return
    this.rateLimitAudited.set(deviceId, now)
    this.store.audit({ action: 'command', outcome: 'rate-limited', deviceId, detail: command })
  }

  private takeCommand(deviceId: string): { ok: true } | { ok: false; retryAfterMs: number } {
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
    return this.topics[topic]
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
