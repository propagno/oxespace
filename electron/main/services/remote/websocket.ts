import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

/**
 * The server half of RFC 6455, only what the gateway needs: text messages from a masking client, ping/pong and close.
 * No extensions (no compression), no binary messages, a hard cap on each message before it is buffered, and UTF-8
 * checked strictly. Written here rather than added as a dependency: the surface is small and fully tested.
 */

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const CLOSE_GRACE_MS = 500
/** Unsent bytes a slow reader may hold before it is dropped. */
const MAX_PENDING_WRITE_BYTES = 4 * 1024 * 1024

export const WS_CLOSE = { normal: 1000, goingAway: 1001, protocolError: 1002, unsupportedData: 1003, invalidPayload: 1007, policy: 1008, tooBig: 1009 } as const

export function websocketAccept(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64')
}

const headerHasToken = (value: string | string[] | undefined, token: string): boolean =>
  typeof value === 'string' && value.toLowerCase().split(',').some(part => part.trim() === token)

/**
 * The HTTP status that refuses an upgrade, or null when it is a valid WebSocket handshake. A request with an
 * `Origin` comes from a browser page: the phone app never sends one, so it is refused.
 */
export function upgradeRefusal(req: IncomingMessage): number | null {
  if (req.method !== 'GET') return 405
  if (req.headers.origin !== undefined) return 403
  if (!headerHasToken(req.headers.upgrade, 'websocket') || !headerHasToken(req.headers.connection, 'upgrade')) return 400
  if (req.headers['sec-websocket-version'] !== '13') return 426
  const key = req.headers['sec-websocket-key']
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return 400
  return null
}

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 426: 'Upgrade Required', 429: 'Too Many Requests', 503: 'Service Unavailable' }

export function refuseUpgrade(socket: Duplex, status: number): void {
  const extra = status === 426 ? 'Sec-WebSocket-Version: 13\r\n' : ''
  socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n${extra}\r\n`)
  setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref?.()
}

export interface WebSocketHandlers {
  onText(text: string): void
  /** A message over the limit arrived; the connection is closing with 1009. */
  onTooLarge?(): void
  onActivity?(): void
  onClose(): void
}

export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const size = payload.length
  const header = size < 126 ? Buffer.from([0x80 | opcode, size])
    : size < 0x10000 ? Buffer.from([0x80 | opcode, 126, size >> 8, size & 0xff])
      : Buffer.concat([Buffer.from([0x80 | opcode, 127, 0, 0, 0, 0]), (() => { const value = Buffer.alloc(4); value.writeUInt32BE(size); return value })()])
  return Buffer.concat([header, payload])
}

export class WebSocketConnection {
  private buffer: Buffer = Buffer.alloc(0)
  private fragments: Buffer[] | null = null
  private fragmentBytes = 0
  private closing = false
  private closed = false
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  constructor(private readonly socket: Duplex, private readonly maxMessageBytes: number, private readonly handlers: WebSocketHandlers) {}

  /** Answers the handshake and starts reading. `head` is what arrived after the request headers. */
  accept(key: string, head: Buffer): void {
    this.socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(key)}\r\n\r\n`)
    this.socket.on('data', (data: Buffer) => this.receive(data))
    this.socket.on('close', () => this.finish())
    this.socket.on('error', () => this.socket.destroy())
    if (head.length) this.receive(head)
  }

  get isOpen(): boolean { return !this.closing && !this.closed }

  sendText(text: string): boolean {
    if (!this.isOpen) return false
    if (this.socket.writableLength > MAX_PENDING_WRITE_BYTES) { this.close(WS_CLOSE.policy); return false }
    this.socket.write(encodeFrame(0x1, Buffer.from(text, 'utf8')))
    return true
  }

  /** Starts the closing handshake; the socket is destroyed if the peer does not finish it within half a second. */
  close(code: number = WS_CLOSE.normal): void {
    if (this.closing || this.closed) return
    this.closing = true
    const payload = Buffer.alloc(2)
    payload.writeUInt16BE(code)
    try { this.socket.write(encodeFrame(0x8, payload)); this.socket.end() } catch { /* already gone */ }
    setTimeout(() => this.socket.destroy(), CLOSE_GRACE_MS).unref?.()
  }

  destroy(): void {
    this.closing = true
    this.socket.destroy()
  }

  /** Exposed for the fuzz test: feeds raw bytes as if they came from the socket. */
  receive(data: Buffer): void {
    if (this.closing || this.closed) return // Nothing more is read once closing has begun.
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data
    // A frame over the limit is refused from its header, so this only grows past it when a peer floods.
    if (this.buffer.length > 2 * this.maxMessageBytes + 1024) return this.fail(WS_CLOSE.tooBig)
    while (!this.closed && this.buffer.length >= 2) {
      const consumed = this.readFrame()
      if (consumed === 0) return
      this.buffer = this.buffer.subarray(consumed)
    }
  }

  /** Bytes used by one complete frame, or 0 when more are needed. */
  private readFrame(): number {
    const buffer = this.buffer
    const fin = (buffer[0] & 0x80) !== 0, opcode = buffer[0] & 0x0f
    if (buffer[0] & 0x70 || !(buffer[1] & 0x80)) { this.fail(WS_CLOSE.protocolError); return 0 }
    let size = buffer[1] & 0x7f, offset = 2
    if (size === 126) {
      if (buffer.length < 4) return 0
      size = buffer.readUInt16BE(2); offset = 4
    } else if (size === 127) {
      if (buffer.length < 10) return 0
      if (buffer.readUInt32BE(2) !== 0) { this.tooLarge(); return 0 }
      size = buffer.readUInt32BE(6); offset = 10
    }
    const control = (opcode & 0x08) !== 0
    if (control && (size > 125 || !fin)) { this.fail(WS_CLOSE.protocolError); return 0 }
    if (!control && this.fragmentBytes + size > this.maxMessageBytes) { this.tooLarge(); return 0 }
    const end = offset + 4 + size
    if (buffer.length < end) return 0
    const mask = buffer.subarray(offset, offset + 4)
    const payload = Buffer.from(buffer.subarray(offset + 4, end))
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index & 3]
    this.handlers.onActivity?.()
    this.frame(opcode, fin, payload)
    return end
  }

  private frame(opcode: number, fin: boolean, payload: Buffer): void {
    switch (opcode) {
      case 0x0:
        if (!this.fragments) return this.fail(WS_CLOSE.protocolError)
        this.fragments.push(payload); this.fragmentBytes += payload.length
        if (fin) { const whole = Buffer.concat(this.fragments); this.fragments = null; this.fragmentBytes = 0; this.message(whole) }
        return
      case 0x1:
        if (this.fragments) return this.fail(WS_CLOSE.protocolError)
        if (fin) return this.message(payload)
        this.fragments = [payload]; this.fragmentBytes = payload.length
        return
      case 0x2: return this.fail(WS_CLOSE.unsupportedData)
      case 0x8: return this.close(WS_CLOSE.normal)
      case 0x9: if (this.isOpen) this.socket.write(encodeFrame(0xa, payload)); return
      case 0xa: return
      default: return this.fail(WS_CLOSE.protocolError)
    }
  }

  private message(payload: Buffer): void {
    if (this.closing) return
    let text: string
    try { text = this.decoder.decode(payload) } catch { return this.fail(WS_CLOSE.invalidPayload) }
    this.handlers.onText(text)
  }

  private tooLarge(): void {
    this.handlers.onTooLarge?.()
    this.fail(WS_CLOSE.tooBig)
  }

  private fail(code: number): void {
    this.buffer = Buffer.alloc(0)
    this.close(code)
  }

  private finish(): void {
    if (this.closed) return
    this.closed = true
    this.closing = true
    this.buffer = Buffer.alloc(0)
    this.handlers.onClose()
  }
}
