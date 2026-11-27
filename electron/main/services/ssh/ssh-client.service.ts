import { Client, type ConnectConfig } from 'ssh2'

export type SshAuthType = 'key' | 'password' | 'agent'

export interface SshConnectionConfig {
  host: string
  port: number
  username: string
  authType?: SshAuthType
  password?: string
  privateKey?: string | Buffer
  passphrase?: string
  agent?: boolean
  /** Pinned SHA-256 host key fingerprint (`SHA256:<base64>`). Required before authentication. */
  pinnedFingerprint?: string
}

export interface SshClientOptions {
  connectTimeoutMs?: number
  keepaliveMs?: number
  keepaliveCountMax?: number
  /** Test seam for injecting a custom ssh2 Client. */
  createClient?: () => Client
}

export type SshClientErrorCode = 'host-key-unknown' | 'host-key-changed' | 'auth' | 'connection' | 'agent'

export class SshClientError extends Error {
  constructor(
    readonly code: SshClientErrorCode,
    message: string,
    readonly reasons?: string[]
  ) {
    super(message)
    this.name = 'SshClientError'
  }
}

export interface ConnectedSshClient {
  readonly client: Client
  /** The host key fingerprint presented by the server (`SHA256:<base64>`). */
  readonly fingerprint: string
  close(): void
}

/**
 * The socket of the user's SSH agent: `SSH_AUTH_SOCK` on Linux/macOS, the OpenSSH agent's
 * named pipe on Windows. Null when unavailable.
 */
export function agentSocket(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  if (env.SSH_AUTH_SOCK) return env.SSH_AUTH_SOCK
  return platform === 'win32' ? String.raw`\\.\pipe\openssh-ssh-agent` : null
}

function agentSocketOrFail(): string {
  const socket = agentSocket()
  if (!socket) {
    throw new SshClientError(
      'agent',
      'No SSH agent was found (SSH_AUTH_SOCK is not set). Start ssh-agent and add your key with ssh-add, or choose another sign-in method.'
    )
  }
  return socket
}

/** True when ssh2 loaded cleanly into this bundle. */
export function sshClientAvailable(): boolean {
  return typeof Client === 'function'
}

/** OpenSSH notation: SHA-256 of the host key blob, unpadded base64. */
export function fingerprintOf(hexHash: string): string {
  return `SHA256:${Buffer.from(hexHash, 'hex').toString('base64').replace(/=+$/, '')}`
}

/** Formats SSH transport/auth failures without ever leaking credentials. */
export function describeSshError(error: unknown): string {
  const text = error instanceof Error ? error.message : 'unknown error'
  if (/All configured authentication methods failed/i.test(text)) return 'The SSH server rejected the credentials.'
  if (/Timed out while waiting for handshake|Timeout/i.test(text)) return 'The SSH server did not answer in time.'
  if (/ECONNREFUSED/.test(text)) return 'The SSH server refused the connection. Check the host and port.'
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return 'The SSH host name could not be resolved.'
  if (/Cannot parse privateKey|no passphrase given|Encrypted private OpenSSH key|bad passphrase/i.test(text)) {
    return 'The SSH private key could not be read. It may need its passphrase.'
  }
  return text.replace(/\s+/g, ' ').slice(0, 300)
}

/**
 * Connects an authenticated `ssh2.Client` with mandatory SHA-256 TOFU host-key pinning.
 *
 * Host key verification ALWAYS runs before any credential is transmitted:
 * - Missing `pinnedFingerprint` rejects with `SshClientError('host-key-unknown', ..., [presented])`.
 * - Mismatched `pinnedFingerprint` rejects with `SshClientError('host-key-changed', ..., [pinned, presented])`.
 */
export async function connectSshClient(
  ssh: SshConnectionConfig,
  options: SshClientOptions = {}
): Promise<ConnectedSshClient> {
  const client = options.createClient?.() ?? new Client()
  let presented = ''
  let mismatch = false
  const useAgent = ssh.agent === true || (ssh.authType === 'agent' && !ssh.privateKey && !ssh.password)

  const connectConfig: ConnectConfig = {
    host: ssh.host,
    port: ssh.port,
    username: ssh.username,
    ...(ssh.privateKey ? { privateKey: ssh.privateKey, ...(ssh.passphrase ? { passphrase: ssh.passphrase } : {}) } : {}),
    ...(ssh.password && !ssh.privateKey ? { password: ssh.password } : {}),
    ...(useAgent ? { agent: agentSocketOrFail() } : {}),
    readyTimeout: options.connectTimeoutMs ?? 10_000,
    keepaliveInterval: options.keepaliveMs ?? 15_000,
    keepaliveCountMax: options.keepaliveCountMax ?? 3,
    hostHash: 'sha256',
    hostVerifier: (hash: string): boolean => {
      presented = fingerprintOf(hash)
      if (!ssh.pinnedFingerprint) return false
      if (ssh.pinnedFingerprint.replace(/=+$/, '') !== presented) {
        mismatch = true
        return false
      }
      return true
    }
  }

  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown): void => {
      client.removeAllListeners()
      client.on('error', () => undefined)
      client.end()
      if (mismatch) {
        reject(new SshClientError(
          'host-key-changed',
          `The SSH server's host key for ${ssh.host}:${ssh.port} is different from the one you trusted. This can mean the server was rebuilt or that someone is intercepting the connection. Do not continue until you have confirmed it.`,
          [ssh.pinnedFingerprint ?? '', presented]
        ))
      } else if (presented && !ssh.pinnedFingerprint) {
        reject(new SshClientError(
          'host-key-unknown',
          `${ssh.host}:${ssh.port} presented a host key you have not trusted yet. Compare this fingerprint with the server's before continuing.`,
          [presented]
        ))
      } else {
        const message = describeSshError(error)
        const code: SshClientErrorCode = /rejected the credentials|private key could not be read/i.test(message) ? 'auth' : 'connection'
        reject(new SshClientError(code, message))
      }
    }
    client.once('ready', resolve)
    client.once('error', fail)
    try {
      client.connect(connectConfig)
    } catch (error) {
      fail(error)
    }
  })

  return {
    client,
    fingerprint: presented,
    close(): void {
      client.removeAllListeners()
      client.on('error', () => undefined)
      client.end()
    }
  }
}

/**
 * Probes ONLY the server's SHA-256 host key fingerprint without attempting authentication.
 * Refuses the connection immediately inside `hostVerifier` once the hash is captured.
 */
export async function probeSshHostKey(
  target: { host: string; port: number },
  options: SshClientOptions = {}
): Promise<string> {
  const client = options.createClient?.() ?? new Client()
  let presented = ''
  return new Promise<string>((resolve, reject) => {
    const finish = (error?: unknown): void => {
      client.removeAllListeners()
      client.on('error', () => undefined)
      client.end()
      if (presented) resolve(presented)
      else reject(new SshClientError('connection', describeSshError(error)))
    }
    client.once('error', finish)
    try {
      client.connect({
        host: target.host,
        port: target.port,
        username: 'oxespace-probe',
        readyTimeout: options.connectTimeoutMs ?? 10_000,
        hostHash: 'sha256',
        hostVerifier: (hash: string): boolean => {
          presented = fingerprintOf(hash)
          return false
        }
      })
    } catch (error) {
      finish(error)
    }
  })
}
