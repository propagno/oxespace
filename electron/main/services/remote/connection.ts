import { randomBytes } from 'node:crypto'
import {
  readRemoteFrame, REMOTE_FORBIDDEN, REMOTE_LIMITS, REMOTE_PROTOCOL_VERSION, REMOTE_SUBSCRIPTIONS,
  type RemoteAuthFrame, type RemoteAuthResult, type RemoteCommandFrame, type RemoteErrorCode, type RemoteFrame,
  type RemoteSubscribeFrame, type RemoteSubscription, type RemoteUnsubscribeFrame
} from '../../../../shared/remote/protocol'
import { WS_CLOSE } from './websocket'

/**
 * One phone connection, after the WebSocket handshake: `hello`, then `auth` within `authTimeoutMs`, then
 * subscriptions and commands. Everything the phone sends is untrusted: each frame passes `readRemoteFrame`, then a
 * strict check of its own fields, and only then reaches the gateway.
 *
 * In this release (M1–M3) no command runs and no topic has data yet: commands are answered `forbidden` and topics
 * without a source `not-found`. M4 registers topic sources; M5 adds the commands.
 */

export type AuthOutcome = { ok: true; deviceId: string; expiresAt: number; result: RemoteAuthResult } | { ok: false; code: RemoteErrorCode }

export interface RemoteTopicFrame { kind: 'snapshot' | 'event'; seq: number; schemaVersion: number; data: unknown }

/** Where a topic's data comes from (M4). `open` returns null when the target does not exist. */
export interface RemoteTopicSource {
  open(request: { deviceId: string; target?: string; sinceSeq?: number }, emit: (frame: RemoteTopicFrame) => void): { close(): void } | null
}

export interface ConnectionHost {
  readonly desktopName: string
  now(): number
  authenticate(frame: RemoteAuthFrame, challenge: string, address: string): AuthOutcome
  isRevoked(deviceId: string): boolean
  takeCommand(deviceId: string): { ok: true } | { ok: false; retryAfterMs: number }
  topic(topic: RemoteSubscription): RemoteTopicSource | undefined
  authenticated(connection: RemoteConnection): void
  seen(deviceId: string): void
  closed(connection: RemoteConnection): void
}

export interface FrameSocket {
  sendText(text: string): boolean
  close(code?: number): void
  readonly isOpen: boolean
}

const FRAME_ID = /^[A-Za-z0-9._:-]{1,128}$/
const TARGET = /^[A-Za-z0-9._:-]{1,200}$/
/** Any frame, of any kind, per connection per minute. Commands have their own, lower limit per device. */
const MAX_FRAMES_PER_MINUTE = 600
const FORBIDDEN = new Set<string>(REMOTE_FORBIDDEN)

const hasOnlyKeys = (value: object, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key))
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/** True when any key or string inside `value` names something the phone may never do. */
export function mentionsForbidden(value: unknown, depth = 0): boolean {
  if (depth > 32) return true // Deeper than any real argument: refuse rather than walk it.
  if (typeof value === 'string') return FORBIDDEN.has(value)
  if (Array.isArray(value)) return value.some(item => mentionsForbidden(item, depth + 1))
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => FORBIDDEN.has(key) || mentionsForbidden(item, depth + 1))
  return false
}

export class RemoteConnection {
  /** 32 random bytes, base64url, new for this connection: a refresh on it must sign exactly this. */
  readonly challenge = randomBytes(32).toString('base64url')
  deviceId: string | null = null
  private state: 'hello' | 'auth' | 'ready' = 'hello'
  private expiresAt = 0
  private readonly subscriptions = new Map<string, { close(): void }>()
  private nextSubscription = 1
  private windowStart = 0
  private framesInWindow = 0
  private readonly authTimer: ReturnType<typeof setTimeout>
  private socket: FrameSocket | null = null
  private ended = false

  constructor(readonly address: string, private readonly host: ConnectionHost) {
    this.authTimer = setTimeout(() => {
      if (this.state !== 'ready') this.fail('unauthenticated')
    }, REMOTE_LIMITS.authTimeoutMs)
    this.authTimer.unref?.()
  }

  attach(socket: FrameSocket): void { this.socket = socket }

  get subscriptionCount(): number { return this.subscriptions.size }

  receive(text: string): void {
    if (!this.withinFrameRate()) return this.fail('rate-limited')
    const read = readRemoteFrame(text, 'client')
    if (!read.ok) {
      this.error(read.code, read.code === 'frame-too-large' ? undefined : frameId(text))
      if (this.state !== 'ready') this.close()
      return
    }
    const frame = read.frame
    if (this.state === 'hello') return frame.type === 'hello' ? this.hello(frame) : this.fail('unauthenticated', frameId(frame))
    switch (frame.type) {
      case 'hello': return this.state === 'ready' ? this.error('malformed') : this.fail('malformed')
      case 'auth': return this.auth(frame)
      default:
        if (this.state !== 'ready') return this.fail('unauthenticated', frameId(frame))
        if (frame.type === 'subscribe') return this.subscribe(frame)
        if (frame.type === 'unsubscribe') return this.unsubscribe(frame)
        if (frame.type === 'command') return this.command(frame)
        return this.error('malformed', frameId(frame))
    }
  }

  /** The device was revoked: say so and close; the socket is gone within a second whatever the phone does. */
  revoke(): void {
    this.error('revoked')
    this.close(WS_CLOSE.policy)
  }

  close(code: number = WS_CLOSE.policy): void {
    this.socket?.close(code)
  }

  /** The socket closed, from either side. */
  closed(): void {
    if (this.ended) return
    this.ended = true
    clearTimeout(this.authTimer)
    for (const subscription of this.subscriptions.values()) { try { subscription.close() } catch { /* a source failing to close does not matter now */ } }
    this.subscriptions.clear()
    this.host.closed(this)
  }

  /** Sent by the WebSocket layer when a message is over the limit, just before it closes with 1009. */
  tooLarge(): void { this.error('frame-too-large') }

  private hello(frame: RemoteFrame & { type: 'hello' }): void {
    const versions = (frame as { versions?: unknown }).versions
    if (!hasOnlyKeys(frame, ['type', 'versions']) || !Array.isArray(versions) || versions.length < 1 || versions.length > 16 ||
      !versions.every(value => Number.isSafeInteger(value) && value > 0)) return this.fail('malformed')
    if (!versions.includes(REMOTE_PROTOCOL_VERSION)) return this.fail('unsupported-version')
    this.state = 'auth'
    this.send({ type: 'hello', versions: [REMOTE_PROTOCOL_VERSION], desktopName: this.host.desktopName, challenge: this.challenge })
  }

  private auth(frame: RemoteAuthFrame): void {
    const id = frameId(frame)
    if (!id || !hasOnlyKeys(frame, ['type', 'id', 'accessToken', 'refresh'])) return this.fail('malformed', id)
    const byToken = frame.accessToken !== undefined, byRefresh = frame.refresh !== undefined
    if (byToken === byRefresh) return this.fail('malformed', id)
    if (byToken && typeof frame.accessToken !== 'string') return this.fail('malformed', id)
    if (byRefresh) {
      const refresh = frame.refresh as unknown
      if (!isPlainObject(refresh) || !hasOnlyKeys(refresh, ['deviceId', 'nonce', 'signature']) ||
        typeof refresh.deviceId !== 'string' || typeof refresh.nonce !== 'string' || typeof refresh.signature !== 'string') return this.fail('malformed', id)
    }
    const outcome = this.host.authenticate(frame, this.challenge, this.address)
    if (!outcome.ok) return this.fail(outcome.code, id)
    // One connection, one device: a token of another device does not switch it.
    if (this.deviceId && this.deviceId !== outcome.deviceId) return this.fail('forbidden', id)
    this.deviceId = outcome.deviceId
    this.expiresAt = outcome.expiresAt
    const first = this.state !== 'ready'
    this.state = 'ready'
    clearTimeout(this.authTimer)
    this.send({ type: 'ack', id, result: outcome.result })
    if (first) this.host.authenticated(this)
  }

  private subscribe(frame: RemoteSubscribeFrame): void {
    const id = frameId(frame)
    if (!id || !hasOnlyKeys(frame, ['type', 'id', 'topic', 'target', 'sinceSeq']) || typeof frame.topic !== 'string' ||
      (frame.target !== undefined && (typeof frame.target !== 'string' || !TARGET.test(frame.target))) ||
      (frame.sinceSeq !== undefined && (!Number.isSafeInteger(frame.sinceSeq) || frame.sinceSeq < 0))) return this.error('malformed', id)
    if (!this.session(id)) return
    if (FORBIDDEN.has(frame.topic)) return this.error('forbidden', id)
    if (!(REMOTE_SUBSCRIPTIONS as readonly string[]).includes(frame.topic)) return this.error('not-found', id)
    if (this.subscriptions.size >= REMOTE_LIMITS.maxSubscriptions) return this.error('too-many-subscriptions', id)
    const source = this.host.topic(frame.topic)
    if (!source) return this.error('not-found', id)
    const subscription = `sub-${this.nextSubscription++}`
    // What a source emits while opening waits for the ack, so the phone always learns the stream's name first.
    let pending: RemoteTopicFrame[] | null = []
    const emit = (data: RemoteTopicFrame) => {
      if (pending) pending.push(data)
      else if (this.subscriptions.has(subscription)) this.send({ type: data.kind, subscription, seq: data.seq, schemaVersion: data.schemaVersion, data: data.data })
    }
    let handle: { close(): void } | null
    try { handle = source.open({ deviceId: this.deviceId!, ...(frame.target !== undefined ? { target: frame.target } : {}), ...(frame.sinceSeq !== undefined ? { sinceSeq: frame.sinceSeq } : {}) }, emit) } catch { return this.error('internal', id) }
    if (!handle) return this.error('not-found', id)
    this.subscriptions.set(subscription, handle)
    this.send({ type: 'ack', id, subscription })
    const queued = pending
    pending = null
    for (const data of queued) emit(data)
  }

  private unsubscribe(frame: RemoteUnsubscribeFrame): void {
    const id = frameId(frame)
    if (!id || !hasOnlyKeys(frame, ['type', 'id', 'subscription']) || typeof frame.subscription !== 'string' || frame.subscription.length > 64) return this.error('malformed', id)
    if (!this.session(id)) return
    const handle = this.subscriptions.get(frame.subscription)
    if (!handle) return this.error('not-found', id)
    this.subscriptions.delete(frame.subscription)
    try { handle.close() } catch { /* already gone */ }
    this.send({ type: 'ack', id, subscription: frame.subscription })
  }

  private command(frame: RemoteCommandFrame): void {
    const id = frameId(frame)
    if (!id || !hasOnlyKeys(frame, ['type', 'id', 'command', 'args']) || !isPlainObject(frame.args)) return this.error('malformed', id)
    if (!this.session(id)) return
    const allowed = this.host.takeCommand(this.deviceId!)
    if (!allowed.ok) return this.send({ type: 'error', id, code: 'rate-limited', retryAfterMs: allowed.retryAfterMs })
    if (mentionsForbidden(frame.args)) return this.error('forbidden', id)
    // M5 runs commands; until then none reaches anything.
    this.error('forbidden', id)
  }

  /** The device is still paired and its token still valid; otherwise answers why and returns false. */
  private session(id: string): boolean {
    const deviceId = this.deviceId
    if (!deviceId) { this.error('unauthenticated', id); return false }
    if (this.host.isRevoked(deviceId)) { this.revoke(); return false }
    if (this.host.now() >= this.expiresAt) { this.error('token-expired', id); return false }
    this.host.seen(deviceId)
    return true
  }

  private withinFrameRate(): boolean {
    const now = this.host.now()
    if (now - this.windowStart >= 60_000) { this.windowStart = now; this.framesInWindow = 0 }
    this.framesInWindow += 1
    return this.framesInWindow <= MAX_FRAMES_PER_MINUTE
  }

  private error(code: RemoteErrorCode, id?: string): void {
    this.send({ type: 'error', ...(id ? { id } : {}), code })
  }

  /** Answers, then closes: used for anything that ends the connection. */
  private fail(code: RemoteErrorCode, id?: string): void {
    this.error(code, id)
    this.close(code === 'unsupported-version' ? WS_CLOSE.normal : WS_CLOSE.policy)
  }

  private send(frame: RemoteFrame): void {
    const text = JSON.stringify(frame)
    if (Buffer.byteLength(text) > REMOTE_LIMITS.maxFrameBytes) {
      this.socket?.sendText(JSON.stringify({ type: 'error', code: 'internal' }))
      return
    }
    this.socket?.sendText(text)
  }
}

/** The `id` of a frame, when it has a well-formed one, so an error can name what it answers. */
function frameId(value: unknown): string | undefined {
  let frame = value
  if (typeof value === 'string') { try { frame = JSON.parse(value) } catch { return undefined } }
  const id = isPlainObject(frame) ? frame.id : undefined
  return typeof id === 'string' && FRAME_ID.test(id) ? id : undefined
}
