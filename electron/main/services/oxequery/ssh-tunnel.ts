import { createServer, type Server, type Socket } from 'node:net'
import type { Client } from 'ssh2'
import type { Endpoint } from './connection-options'
import { OxeQueryError, type TunnelSettings } from './oxequery-errors'
import {
  agentSocket,
  connectSshClient,
  describeSshError,
  fingerprintOf,
  probeSshHostKey,
  SshClientError,
  sshClientAvailable
} from '../ssh/ssh-client.service'

export { agentSocket, fingerprintOf }

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

/** True when the SSH client library loaded into this bundle. */
export function tunnelAvailable(): boolean {
  return sshClientAvailable()
}

function mapSshError(error: unknown): OxeQueryError {
  if (error instanceof SshClientError) {
    if (error.code === 'host-key-unknown') return new OxeQueryError('host-key-unknown', error.message, error.reasons)
    if (error.code === 'host-key-changed') return new OxeQueryError('host-key-changed', error.message, error.reasons)
    return new OxeQueryError('tunnel', error.message, error.reasons)
  }
  return new OxeQueryError('tunnel', describeSshError(error))
}

/**
 * Opens a local port that forwards to `target` through `ssh`, delegating transport and
 * mandatory SHA-256 TOFU host-key verification to the shared `ssh-client.service.ts`.
 */
export async function openTunnel(ssh: TunnelSettings, target: Endpoint, options: TunnelOptions = {}): Promise<OpenTunnel> {
  const connected = await connectSshClient(
    {
      host: ssh.host,
      port: ssh.port,
      username: ssh.user,
      privateKey: ssh.privateKey,
      passphrase: ssh.passphrase,
      password: ssh.password,
      agent: ssh.agent,
      pinnedFingerprint: ssh.pinnedFingerprint
    },
    options
  ).catch(error => {
    throw mapSshError(error)
  })

  const { client, fingerprint } = connected
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
    connected.close()
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
  }).catch(async error => {
    await shutdown()
    throw mapSshError(error)
  })

  return {
    endpoint: { host: '127.0.0.1', port },
    fingerprint,
    close: shutdown,
    onClose: listener => { if (closed) listener(); else listeners.push(listener) }
  }
}

/** Reads only the host key, without authenticating. Used to show a fingerprint before it is trusted. */
export async function probeHostKey(ssh: Pick<TunnelSettings, 'host' | 'port'>, options: TunnelOptions = {}): Promise<string> {
  return probeSshHostKey(ssh, options).catch(error => {
    throw mapSshError(error)
  })
}
