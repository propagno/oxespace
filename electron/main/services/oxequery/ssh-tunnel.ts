import { createServer, type Server, type Socket } from 'node:net'
import { Client, type ConnectConfig } from 'ssh2'
import type { Endpoint } from './connection-options'
import { OxeQueryError, type TunnelSettings } from './oxequery-errors'

export interface OpenTunnel {
  /** The local end: dial this instead of the real server. */
  endpoint: Endpoint
  /** The host key the server presented, in `SHA256:<base64>` form. */
  fingerprint: string
  close(): Promise<void>
  /** Fires once when the tunnel goes away on its own (network, server restart). */
  onClose(listener: () => void): void
}

export interface TunnelOptions {
  connectTimeoutMs?: number
  keepaliveMs?: number
  /** Test seam for the transport. */
  createClient?: () => Client
}

/**
 * The socket of the user's SSH agent: SSH_AUTH_SOCK on Linux and macOS, the OpenSSH agent's named pipe
 * on Windows. Null when there is none to talk to.
 */
export function agentSocket(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (env.SSH_AUTH_SOCK) return env.SSH_AUTH_SOCK
  return platform === 'win32' ? String.raw`\\.\pipe\openssh-ssh-agent` : null
}

function agentSocketOrFail(): string {
  const socket = agentSocket()
  if (!socket) throw new OxeQueryError('tunnel', 'No SSH agent was found (SSH_AUTH_SOCK is not set). Start ssh-agent and add your key with ssh-add, or choose another sign-in method.')
  return socket
}

/** True when the SSH client library loaded into this bundle. */
export function tunnelAvailable(): boolean {
  return typeof Client === 'function'
}

/** OpenSSH's notation: SHA-256 of the key blob, base64 without padding. */
export function fingerprintOf(hexHash: string): string {
  return `SHA256:${Buffer.from(hexHash, 'hex').toString('base64').replace(/=+$/, '')}`
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : 'unknown error'
  if (/All configured authentication methods failed/i.test(text)) return 'The SSH server rejected the credentials.'
  if (/Timed out while waiting for handshake|Timeout/i.test(text)) return 'The SSH server did not answer in time.'
  if (/ECONNREFUSED/.test(text)) return 'The SSH server refused the connection. Check the host and port.'
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return 'The SSH host name could not be resolved.'
  if (/Cannot parse privateKey|no passphrase given|Encrypted private OpenSSH key|bad passphrase/i.test(text)) return 'The SSH private key could not be read. It may need its passphrase.'
  return text.replace(/\s+/g, ' ').slice(0, 300)
}

/**
 * Opens a local port that forwards to `target` through `ssh`.
 *
 * The server's host key is checked before any credential is sent: a key that was
 * never trusted is reported (so the person can compare the fingerprint), and a
 * key that differs from the trusted one is a hard failure.
 */
export async function openTunnel(ssh: TunnelSettings, target: Endpoint, options: TunnelOptions = {}): Promise<OpenTunnel> {
  const client = options.createClient?.() ?? new Client()
  let presented = ''
  let mismatch = false

  const config: ConnectConfig = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.user,
    ...(ssh.privateKey ? { privateKey: ssh.privateKey, ...(ssh.passphrase ? { passphrase: ssh.passphrase } : {}) } : {}),
    ...(ssh.password && !ssh.privateKey ? { password: ssh.password } : {}),
    ...(ssh.agent ? { agent: agentSocketOrFail() } : {}),
    readyTimeout: options.connectTimeoutMs ?? 10_000,
    keepaliveInterval: options.keepaliveMs ?? 15_000,
    keepaliveCountMax: 3,
    hostHash: 'sha256',
    hostVerifier: (hash: string): boolean => {
      presented = fingerprintOf(hash)
      if (!ssh.pinnedFingerprint) return false
      if (ssh.pinnedFingerprint.replace(/=+$/, '') !== presented) { mismatch = true; return false }
      return true
    }
  }

  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown): void => {
      client.removeAllListeners()
      client.on('error', () => undefined)
      client.end()
      if (mismatch) reject(new OxeQueryError('host-key-changed', `The SSH server's host key for ${ssh.host}:${ssh.port} is different from the one you trusted. This can mean the server was rebuilt or that someone is intercepting the connection. Do not continue until you have confirmed it.`, [ssh.pinnedFingerprint ?? '', presented]))
      else if (presented && !ssh.pinnedFingerprint) reject(new OxeQueryError('host-key-unknown', `${ssh.host}:${ssh.port} presented a host key you have not trusted yet. Compare this fingerprint with the server's before continuing.`, [presented]))
      else reject(new OxeQueryError('tunnel', describe(error)))
    }
    client.once('ready', resolve)
    client.once('error', fail)
    try { client.connect(config) } catch (error) { fail(error) }
  })

  const sockets = new Set<Socket>()
  let closed = false
  const listeners: (() => void)[] = []
  const server: Server = createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    client.forwardOut(socket.remoteAddress ?? '127.0.0.1', socket.remotePort ?? 0, target.host, target.port, (error, stream) => {
      if (error) { socket.destroy(); return }
      stream.on('error', () => socket.destroy())
      stream.on('close', () => socket.destroy())
      socket.pipe(stream).pipe(socket)
    })
  })

  const shutdown = async (): Promise<void> => {
    if (closed) return
    closed = true
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    client.removeAllListeners()
    client.on('error', () => undefined)
    client.end()
    for (const listener of listeners.splice(0)) listener()
  }

  client.on('error', () => void shutdown())
  client.on('close', () => void shutdown())

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  }).catch(async error => { await shutdown(); throw new OxeQueryError('tunnel', describe(error)) })

  return {
    endpoint: { host: '127.0.0.1', port },
    fingerprint: presented,
    close: shutdown,
    onClose: listener => { if (closed) listener(); else listeners.push(listener) }
  }
}

/** Reads only the host key, without authenticating. Used to show a fingerprint before it is trusted. */
export async function probeHostKey(ssh: Pick<TunnelSettings, 'host' | 'port'>, options: TunnelOptions = {}): Promise<string> {
  const client = options.createClient?.() ?? new Client()
  let presented = ''
  return new Promise<string>((resolve, reject) => {
    const finish = (error?: unknown): void => {
      client.removeAllListeners()
      client.on('error', () => undefined)
      client.end()
      if (presented) resolve(presented)
      else reject(new OxeQueryError('tunnel', describe(error)))
    }
    client.once('error', finish)
    try {
      client.connect({
        host: ssh.host, port: ssh.port, username: 'oxequery-probe', readyTimeout: options.connectTimeoutMs ?? 10_000, hostHash: 'sha256',
        // Seeing the key is enough; refuse before any authentication is attempted.
        hostVerifier: (hash: string): boolean => { presented = fingerprintOf(hash); return false }
      })
    } catch (error) { finish(error) }
  })
}
