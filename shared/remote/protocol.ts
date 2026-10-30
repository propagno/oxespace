/**
 * C5 · Remote protocol between the desktop gateway (B9, off by default, LAN only, TLS only) and the Android companion.
 *
 * Frames are JSON text over WSS, one object per message, each at most `REMOTE_LIMITS.maxFrameBytes`. The version is
 * negotiated in `hello`; a change that removes or renames anything bumps `REMOTE_PROTOCOL_VERSION`. Fields are only
 * added. The Kotlin side is generated from the JSON Schema of this file, so everything here stays plain data.
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
  maxTextLength: 32_000
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
  /** Set by the gateway: its display name, never the machine's account or path. */
  desktopName?: string
}

/** Access token, or a refresh signed with the device key (proof of possession). */
export interface RemoteAuthFrame extends FrameBase<'auth'> {
  id: string
  accessToken?: string
  refresh?: { deviceId: string; nonce: string; signature: string }
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
