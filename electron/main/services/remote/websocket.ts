import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebSocket } from 'ws'
import type { FrameSocket } from './connection'

/**
 * The gateway's side of the WebSocket, around `ws`: what is refused before `ws` sees the upgrade, and the small
 * adapter `RemoteConnection` talks through. `ws` does the framing (masking, fragments, UTF-8, the size cap and close
 * codes); it runs with compression off.
 */

const CLOSE_GRACE_MS = 500
/** Unsent bytes a slow reader may hold before it is dropped. */
const MAX_PENDING_WRITE_BYTES = 4 * 1024 * 1024

export const WS_CLOSE = { normal: 1000, goingAway: 1001, unsupportedData: 1003, policy: 1008, tooBig: 1009 } as const

/**
 * The HTTP status that refuses an upgrade before `ws` handles it, or null. A request with an `Origin` comes from a
 * browser page: the phone app never sends one, so it is refused.
 */
export function upgradeRefusal(req: IncomingMessage): number | null {
  if (req.method !== 'GET') return 405
  if (req.headers.origin !== undefined) return 403
  return null
}

const STATUS_TEXT: Record<number, string> = { 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 429: 'Too Many Requests', 503: 'Service Unavailable' }

export function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref?.()
}

/** Closing starts the close handshake; whatever the phone does, the socket is gone within half a second. */
export function frameSocket(ws: WebSocket): FrameSocket {
  return {
    get isOpen() { return ws.readyState === ws.OPEN },
    sendText(text: string): boolean {
      if (ws.readyState !== ws.OPEN) return false
      if (ws.bufferedAmount > MAX_PENDING_WRITE_BYTES) { this.close(WS_CLOSE.policy); return false }
      ws.send(text)
      return true
    },
    close(code: number = WS_CLOSE.normal): void {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(code)
      setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref?.()
    }
  }
}
