/**
 * C5 · Remote protocol between the desktop gateway (B9, off by default, LAN only, TLS only) and the Android companion.
 *
 * Frames are JSON text over WSS, one object per message, each at most `REMOTE_LIMITS.maxFrameBytes`. The version is
 * negotiated in `hello`; a change that removes or renames anything bumps `REMOTE_PROTOCOL_VERSION`. Fields are only
 * added. The Android app's `RemoteProtocol.kt` is generated from this file (a test there keeps it current), so
 * everything here stays plain data. A JSON Schema of it is optional.
 *
 * What the phone can never do is listed in `REMOTE_FORBIDDEN`: approvals of OxeQuery and of MCP `confirm`, sign-in and
 * tokens, secrets, MCP trust, policy edits and `host.exec` stay with the person, at the desktop. A test keeps every
 * command and subscription clear of them.
 */

export const REMOTE_PROTOCOL_VERSION = 1

export const REMOTE_LIMITS = {
  /** Largest frame either side accepts, in UTF-8 bytes. */
  maxFrameBytes: 64 * 1024,
  /** Open subscriptions per connection. */
  maxSubscriptions: 32,
  /** Commands per device per minute before `rate-limited`. */
  commandsPerMinute: 60,
  /** Life of an access token; refresh needs proof of the device key. Validity is computed on the desktop. */
  accessTokenTtlMs: 15 * 60_000,
  /** Life of the one-time pairing code in the QR. */
  pairingCodeTtlMs: 2 * 60_000,
  /** Paired devices per desktop. */
  maxDevices: 5,
  /** Time a connection may take to authenticate after `hello`. */
  authTimeoutMs: 10_000,
  /** Characters of message text a command may carry. */
  maxTextLength: 32_000,
  /** Pairing attempts per IP address in `pairingAttemptWindowMs` before `pairing-locked`. */
  pairingAttemptsPerWindow: 5,
  pairingAttemptWindowMs: 2 * 60_000,
  /** Characters of the device name a phone may give when pairing. */
  maxDeviceNameLength: 64
} as const

export const REMOTE_FRAME_TYPES = ['hello', 'auth', 'subscribe', 'unsubscribe', 'event', 'snapshot', 'command', 'ack', 'error'] as const
export type RemoteFrameType = typeof REMOTE_FRAME_TYPES[number]

/** What the phone can watch. Terminal output is read-only slices of the pane's ring buffer, by sequence. */
export const REMOTE_SUBSCRIPTIONS = ['workspaces', 'threads', 'thread', 'pendingRequests', 'terminal', 'jobs', 'delegations'] as const
export type RemoteSubscription = typeof REMOTE_SUBSCRIPTIONS[number]

/**
 * What the phone can do. `thread.respondRequest` answers a Thread request by id and generation (B1.1) after biometric
 * confirmation on the phone; `terminal.write` works only on a pane the person marked "allow from phone" on the desktop.
 */
export const REMOTE_COMMANDS = ['thread.send', 'thread.steer', 'thread.interrupt', 'thread.respondRequest', 'terminal.write'] as const
export type RemoteCommand = typeof REMOTE_COMMANDS[number]

/** Never a command, a subscription or an argument of the remote protocol. */
export const REMOTE_FORBIDDEN = [
  'oxequery.approve',
  'mcp.confirm',
  'mcp.trust',
  'accounts.signIn',
  'accounts.token',
  'secrets.read',
  'secrets.write',
  'policy.edit',
  'thread.access',
  'host.exec'
] as const
export type RemoteForbidden = typeof REMOTE_FORBIDDEN[number]

export const REMOTE_ERROR_CODES = [
  'unsupported-version',
  'unauthenticated',
  'token-expired',
  'revoked',
  'forbidden',
  'rate-limited',
  'frame-too-large',
  'malformed',
  'unknown-command',
  'too-many-subscriptions',
  'not-found',
  'not-pending',
  'stale-generation',
  'pane-not-shared',
  'internal'
] as const
export type RemoteErrorCode = typeof REMOTE_ERROR_CODES[number]

/** Every frame carries its type; frames that expect an answer carry an `id` the answer repeats. */
interface FrameBase<Type extends RemoteFrameType> { type: Type }

/** First frame each side sends. The gateway answers with the version both speak, or `unsupported-version`. */
export interface RemoteHelloFrame extends FrameBase<'hello'> {
  versions: number[]
  /** Set by the gateway: "OXESpace", or the name the person chose in Settings › Devices. Never the host name, an account or a path. */
  desktopName?: string
  /** Set by the gateway: 32 random bytes, base64url, new for every connection; a refresh signs it as its `nonce`. */
  challenge?: string
}

/**
 * Access token, or a refresh signed with the device key (proof of possession): ECDSA P-256 with SHA-256 over
 * `refreshSigningInput(fp, deviceId, nonce)`, where `nonce` is this connection's `hello.challenge`. `signature` is the
 * ASN.1 DER ECDSA signature (SEQUENCE of r and s) in base64url without padding; no other encoding is accepted. The `ack`
 * carries a `RemoteAuthResult`; a removed device gets `revoked`.
 */
export interface RemoteAuthFrame extends FrameBase<'auth'> {
  id: string
  accessToken?: string
  refresh?: { deviceId: string; nonce: string; signature: string }
}

/** `ack.result` of an `auth`: a fresh access token whose validity the desktop computed. */
export interface RemoteAuthResult {
  accessToken: string
  expiresInMs: number
}

export interface RemoteSubscribeFrame extends FrameBase<'subscribe'> {
  id: string
  topic: RemoteSubscription
  /** Thread id, pane id, … when the topic is one item. */
  target?: string
  /** Resume after this sequence; the gateway sends what came after, without gaps or repeats. */
  sinceSeq?: number
}

export interface RemoteUnsubscribeFrame extends FrameBase<'unsubscribe'> {
  id: string
  subscription: string
}

/** A change on a subscription: a notification followed by a read, as in C2 (`readSince`). */
export interface RemoteEventFrame extends FrameBase<'event'> {
  subscription: string
  seq: number
  /** The ThreadEvent `schemaVersion`, or this protocol's version for other topics. */
  schemaVersion: number
  data: unknown
}

/** The whole state of a subscription, sent first and whenever resuming is not possible. */
export interface RemoteSnapshotFrame extends FrameBase<'snapshot'> {
  subscription: string
  seq: number
  schemaVersion: number
  data: unknown
}

export interface RemoteCommandFrame extends FrameBase<'command'> {
  id: string
  command: RemoteCommand
  args: Record<string, unknown>
}

/** Success of a frame with an `id`; for `subscribe`, `subscription` names the stream. */
export interface RemoteAckFrame extends FrameBase<'ack'> {
  id: string
  subscription?: string
  result?: unknown
}

export interface RemoteErrorFrame extends FrameBase<'error'> {
  /** The frame it answers, when it had one. */
  id?: string
  code: RemoteErrorCode
  /** Milliseconds before retrying, for `rate-limited`. */
  retryAfterMs?: number
}

export type RemoteFrame =
  | RemoteHelloFrame
  | RemoteAuthFrame
  | RemoteSubscribeFrame
  | RemoteUnsubscribeFrame
  | RemoteEventFrame
  | RemoteSnapshotFrame
  | RemoteCommandFrame
  | RemoteAckFrame
  | RemoteErrorFrame

/** Frames the phone may send; the others only come from the desktop. */
export const REMOTE_CLIENT_FRAMES = ['hello', 'auth', 'subscribe', 'unsubscribe', 'command'] as const satisfies readonly RemoteFrameType[]

export function isRemoteFrameType(value: unknown): value is RemoteFrameType {
  return typeof value === 'string' && (REMOTE_FRAME_TYPES as readonly string[]).includes(value)
}

export function isRemoteCommand(value: unknown): value is RemoteCommand {
  return typeof value === 'string' && (REMOTE_COMMANDS as readonly string[]).includes(value)
}

/**
 * The checks every frame passes before it is looked at: size, JSON object, known type, and for a client frame a type
 * the phone may send and a known command. Field-level validation belongs to each handler.
 */
export function readRemoteFrame(text: string, from: 'client' | 'desktop'): { ok: true; frame: RemoteFrame } | { ok: false; code: RemoteErrorCode } {
  if (new TextEncoder().encode(text).byteLength > REMOTE_LIMITS.maxFrameBytes) return { ok: false, code: 'frame-too-large' }
  let value: unknown
  try { value = JSON.parse(text) } catch { return { ok: false, code: 'malformed' } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'malformed' }
  const type = (value as { type?: unknown }).type
  if (!isRemoteFrameType(type)) return { ok: false, code: 'malformed' }
  if (from === 'client' && !(REMOTE_CLIENT_FRAMES as readonly string[]).includes(type)) return { ok: false, code: 'malformed' }
  if (type === 'command' && !isRemoteCommand((value as { command?: unknown }).command)) return { ok: false, code: 'unknown-command' }
  return { ok: true, frame: value as RemoteFrame }
}

// ---- Pairing ------------------------------------------------------------------------------------------------------
//
// The desktop shows a QR with `pairingUri(...)`. The phone pins the certificate fingerprint from it, then POSTs a
// `RemotePairRequest` to `https://host:port/pair` over that pinned TLS. The desktop asks "Pair <deviceName>?" and
// answers only after the person clicks. A code is good for one attempt, whatever its outcome, and attempts are limited
// per IP address (`REMOTE_LIMITS.pairingAttemptsPerWindow`). Failures are 4xx with `{ code }` from
// `REMOTE_PAIRING_ERROR_CODES`; a code that matches no offer on screen is `pairing-invalid`.
//
// The certificate is self-signed and names no host: the phone trusts it only by comparing the SHA-256 of the DER it
// receives with the `fp` it read from the QR, and never by host name. A mismatch closes the connection.

export const REMOTE_PAIRING_SCHEME = 'oxespace'
export const REMOTE_PAIRING_PATH = '/pair'
/** The WebSocket endpoint, on the same pinned TLS port. */
export const REMOTE_WS_PATH = '/v1/ws'

/** What the QR carries. `fp` is the SHA-256 of the certificate's DER, as 64 lowercase hex characters. */
export interface RemotePairingQr {
  v: number
  host: string
  port: number
  fp: string
  /** One-time code: 128 random bits, base64url without padding (22 characters). */
  code: string
  /** The desktop's display name ("OXESpace" or the person's choice), never the host name, an account or a path. */
  name?: string
}

export interface RemotePairRequest {
  code: string
  deviceName: string
  /** EC P-256 public key, SubjectPublicKeyInfo DER, base64url without padding. The private key stays in the Keystore. */
  publicKey: string
}

export interface RemotePairResponse {
  deviceId: string
  accessToken: string
  expiresInMs: number
}

export const REMOTE_PAIRING_ERROR_CODES = ['pairing-expired', 'pairing-used', 'pairing-refused', 'pairing-locked', 'too-many-devices', 'malformed', 'pairing-invalid'] as const
export type RemotePairingErrorCode = typeof REMOTE_PAIRING_ERROR_CODES[number]

const BASE64URL = /^[A-Za-z0-9_-]+$/
/** Base64url without padding of exactly `bytes` bytes. */
const base64urlOf = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && BASE64URL.test(value) && value.length === Math.ceil(bytes * 4 / 3)

export const isCertificateFingerprint = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
export const isPairingCode = (value: unknown): value is string => base64urlOf(value, 16)
export const isHelloChallenge = (value: unknown): value is string => base64urlOf(value, 32)
/** An uncompressed P-256 SubjectPublicKeyInfo is 91 bytes. */
export const isDevicePublicKey = (value: unknown): value is string => base64urlOf(value, 91)

const isHost = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9.:-]{1,253}$/.test(value)
const isPort = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535
/** Control characters, C0, DEL and C1, the set Kotlin's `isISOControl` refuses. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const isDisplayName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= REMOTE_LIMITS.maxDeviceNameLength && !CONTROL.test(value)
const PAIRING_KEYS = ['v', 'host', 'port', 'fp', 'code', 'name'] as const

/** `oxespace://pair?v=…&host=…&port=…&fp=…&code=…[&name=…]` */
export function pairingUri(qr: RemotePairingQr): string {
  const query = new URLSearchParams({ v: String(qr.v), host: qr.host, port: String(qr.port), fp: qr.fp, code: qr.code })
  if (qr.name !== undefined) query.set('name', qr.name)
  return `${REMOTE_PAIRING_SCHEME}://pair?${query.toString()}`
}

/**
 * Reads a pairing QR, as strictly as the Android reader: each key at most once (two readers must never see different
 * codes), `v` exactly this protocol's version, the port in plain decimal digits, and no control character in the name.
 * The phone also refuses a host outside the LAN; that rule is the app's, not the contract's.
 */
export function readPairingUri(uri: string): { ok: true; qr: RemotePairingQr } | { ok: false } {
  const prefix = `${REMOTE_PAIRING_SCHEME}://pair?`
  if (typeof uri !== 'string' || !uri.startsWith(prefix) || uri.length > 1024) return { ok: false }
  const query = new URLSearchParams(uri.slice(prefix.length))
  if (PAIRING_KEYS.some(key => query.getAll(key).length > 1)) return { ok: false }
  const portText = query.get('port') ?? '', name = query.get('name') ?? undefined
  if (query.get('v') !== String(REMOTE_PROTOCOL_VERSION) || !/^[0-9]{1,5}$/.test(portText)) return { ok: false }
  const qr: RemotePairingQr = { v: REMOTE_PROTOCOL_VERSION, host: query.get('host') ?? '', port: Number(portText), fp: query.get('fp') ?? '', code: query.get('code') ?? '', ...(name !== undefined ? { name } : {}) }
  const valid = isHost(qr.host) && isPort(qr.port) && isCertificateFingerprint(qr.fp) && isPairingCode(qr.code) && (name === undefined || isDisplayName(name))
  return valid ? { ok: true, qr } : { ok: false }
}

/** Shape check of a pairing request body; anything else is `malformed`. */
export function readPairRequest(value: unknown): { ok: true; request: RemotePairRequest } | { ok: false; code: 'malformed' } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, code: 'malformed' }
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['code', 'deviceName', 'publicKey'].includes(key))) return { ok: false, code: 'malformed' }
  if (!isPairingCode(input.code) || !isDisplayName(input.deviceName) || !isDevicePublicKey(input.publicKey)) return { ok: false, code: 'malformed' }
  return { ok: true, request: { code: input.code, deviceName: input.deviceName, publicKey: input.publicKey } }
}

/**
 * Shape check of a refresh signature: base64url of an ASN.1 DER ECDSA signature (SEQUENCE of two INTEGERs, 8 to 72
 * bytes for P-256). The signature itself is verified by the desktop's crypto; anything else is refused before that.
 */
export function isDerSignature(value: unknown): value is string {
  if (typeof value !== 'string' || !BASE64URL.test(value) || value.length < 11 || value.length > 96) return false
  let binary: string
  try { binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)) } catch { return false }
  return binary.length >= 8 && binary.length <= 72 && binary.charCodeAt(0) === 0x30 && binary.charCodeAt(1) === binary.length - 2 && binary.charCodeAt(2) === 0x02
}

/** The exact text a refresh signs (UTF-8): binds the signature to this desktop's certificate, the device and the connection. */
export function refreshSigningInput(fp: string, deviceId: string, nonce: string): string {
  return `oxespace-refresh:1:${fp}:${deviceId}:${nonce}`
}

/** Crockford base32: no I, L, O or U, so the code reads aloud without confusion. */
const VERIFICATION_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * The 6 characters both screens show while pairing ("Check the code <verification> on the phone"): the first 30 bits
 * of SHA-256 over the device public key's SPKI DER bytes, in Crockford base32. Each side hashes with its own crypto
 * and passes the 32-byte digest here.
 */
export function pairingVerification(spkiSha256: Uint8Array): string {
  if (spkiSha256.length !== 32) throw new Error('Expected a SHA-256 digest')
  let bits = 0
  for (let index = 0; index < 4; index += 1) bits = bits * 256 + spkiSha256[index]
  bits = Math.floor(bits / 4)
  let text = ''
  for (let index = 0; index < 6; index += 1) { text = VERIFICATION_ALPHABET[bits % 32] + text; bits = Math.floor(bits / 32) }
  return text
}
