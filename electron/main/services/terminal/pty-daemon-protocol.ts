import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { userInfo } from 'node:os'
import { join } from 'node:path'

/** Wire protocol version negotiated in the mandatory `hello` handshake. */
export const PTY_DAEMON_PROTOCOL_VERSION = 1

/** Maximum NDJSON frame length accepted by the daemon or client (16 MiB). */
export const PTY_DAEMON_MAX_FRAME_BYTES = 16 * 1024 * 1024

/** Default idle auto-shutdown timeout once zero PTY sessions remain. */
export const PTY_DAEMON_DEFAULT_IDLE_SHUTDOWN_MS = 5 * 60 * 1000

export interface PtyDaemonSessionInfo {
  sessionId: string
  pid: number
  cols: number
  rows: number
  cwd: string
  startedAt: number
  alive: boolean
  process?: string
}

export interface PtyDaemonAttachResult {
  session: PtyDaemonSessionInfo
  snapshot: string
  prologue: string
  ringTail: string
}

export type PtyDaemonRequest =
  | { id: number; type: 'hello'; token: string; protocolVersion: number }
  | { id: number; type: 'listSessions' }
  | {
    id: number
    type: 'spawnSession'
    sessionId: string
    file: string
    args: string[]
    cwd: string
    cols: number
    rows: number
    env?: Record<string, string>
  }
  | { id: number; type: 'attachSession'; sessionId: string }
  | { id: number; type: 'detachSession'; sessionId: string }
  | { id: number; type: 'write'; sessionId: string; data: string }
  | { id: number; type: 'resize'; sessionId: string; cols: number; rows: number }
  | { id: number; type: 'killSession'; sessionId: string; signal?: string }
  | { id: number; type: 'shutdown' }

export type PtyDaemonResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

export type PtyDaemonEvent =
  | { event: 'data'; sessionId: string; data: string }
  | { event: 'exit'; sessionId: string; exitCode: number; signal?: number }
  | { event: 'process'; sessionId: string; process: string }

export type PtyDaemonServerMessage = PtyDaemonResponse | PtyDaemonEvent

/** Generates a 32-byte cryptographically random auth token encoded as 64 lowercase hex chars. */
export function generateDaemonToken(): string {
  return randomBytes(32).toString('hex')
}

/** Deterministic per-user hash fragment used to scope Windows Named Pipe names. */
export function daemonUserHash(seed?: string): string {
  let identity = seed
  if (!identity) {
    try {
      const info = userInfo()
      identity = `${info.username}:${info.uid}:${info.homedir}`
    } catch {
      identity = process.env.USERNAME || process.env.USER || 'default'
    }
  }
  return createHash('sha256').update(identity).digest('hex').slice(0, 16)
}

/**
 * Local-only daemon IPC endpoint:
 * - Windows: Named Pipe `\\.\pipe\oxespace-pty-<userHash>`
 * - POSIX:   Unix Domain Socket `<runtimeDir>/oxespace-pty.sock`
 */
export function defaultPtyDaemonEndpoint(
  userHash: string,
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  const safeHash = userHash.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 48) || 'user'
  if (platform === 'win32') return `\\\\.\\pipe\\oxespace-pty-${safeHash}`
  return join(runtimeDir, 'oxespace-pty.sock')
}

/**
 * Enforces that the PTY daemon NEVER listens on TCP or any network address.
 * Throws unless `endpoint` is a Windows Named Pipe (win32) or a local Unix Domain Socket path (POSIX).
 */
export function assertLocalDaemonEndpoint(endpoint: string, platform: NodeJS.Platform = process.platform): void {
  const trimmed = endpoint.trim()
  if (!trimmed) throw new Error('PTY daemon endpoint must not be empty')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error(`PTY daemon refuses URL/network endpoint: ${trimmed}`)
  }
  if (/^(0\.0\.0\.0|127\.0\.0\.1|localhost|\[?::1?\]?)(:\d+)?$/i.test(trimmed) || /^[^\\/]+:\d+$/.test(trimmed)) {
    throw new Error(`PTY daemon refuses TCP host:port endpoint: ${trimmed}`)
  }
  if (platform === 'win32') {
    if (!/^\\\\\.\\pipe\\[A-Za-z0-9._-]+$/.test(trimmed)) {
      throw new Error(`PTY daemon requires a Windows Named Pipe (\\\\.\\pipe\\...): ${trimmed}`)
    }
    return
  }
  if (!trimmed.startsWith('/') || trimmed.includes('..') || trimmed.includes('\0')) {
    throw new Error(`PTY daemon requires an absolute local Unix Domain Socket path: ${trimmed}`)
  }
}

/** Constant-time token comparison to prevent timing side-channel leaks. */
export function tokensEqual(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== 'string' || !expected) return false
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
