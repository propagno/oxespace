import { createServer, type Server, type Socket } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import type { RpcDispatcher, RpcRequest } from './dispatcher'

/**
 * F3 · Local stream transport for the RPC bus.
 *
 * Named pipe on Windows, unix domain socket elsewhere — both are filesystem/
 * namespace scoped to the logged-in user, so nothing is exposed on the network.
 * Framing is newline-delimited JSON; the first line of a connection must be the
 * bearer token, otherwise the socket is closed.
 */

const MAX_LINE_BYTES = 1024 * 1024
const AUTH_TIMEOUT_MS = 5_000

export interface RpcTransportOptions {
  dispatcher: RpcDispatcher
  token: string
  /** Named pipe path (Windows) or socket path (POSIX). */
  endpoint: string
  onError?: (error: Error) => void
}

export class RpcTransport {
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()

  constructor(private readonly options: RpcTransportOptions) {}

  get endpoint(): string {
    return this.options.endpoint
  }

  async start(): Promise<void> {
    if (this.server) return

    const server = createServer((socket) => this.handleConnection(socket))
    server.on('error', (error) => this.options.onError?.(error))

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.endpoint, () => {
        server.off('error', reject)
        resolve()
      })
    })

    this.server = server
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket)
    socket.setEncoding('utf8')

    let authenticated = false
    let buffer = ''

    // An unauthenticated socket must not linger holding a handle open.
    const authTimer = setTimeout(() => {
      if (!authenticated) socket.destroy()
    }, AUTH_TIMEOUT_MS)

    const close = (): void => {
      clearTimeout(authTimer)
      this.sockets.delete(socket)
      socket.destroy()
    }

    socket.on('error', close)
    socket.on('close', () => {
      clearTimeout(authTimer)
      this.sockets.delete(socket)
    })

    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_LINE_BYTES) {
        close()
        return
      }

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)

        if (!authenticated) {
          if (!tokensMatch(line, this.options.token)) {
            socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } })}\n`)
            close()
            return
          }
          authenticated = true
          clearTimeout(authTimer)
        } else if (line) {
          void this.handleLine(socket, line)
        }

        newlineIndex = buffer.indexOf('\n')
      }
    })
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: RpcRequest
    try {
      request = JSON.parse(line) as RpcRequest
    } catch {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } })}\n`)
      return
    }

    const response = await this.options.dispatcher.dispatch(request)
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
  }
}

/** Constant-time compare so the token can't be recovered by timing. */
function tokensMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Platform-appropriate endpoint for a given instance id. */
export function defaultRpcEndpoint(instanceId: string, socketDir: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\oxespace-rpc-${instanceId}`
    : `${socketDir.replace(/\/+$/, '')}/oxespace-rpc-${instanceId}.sock`
}
