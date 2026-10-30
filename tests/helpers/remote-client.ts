import { createHash, randomBytes } from 'node:crypto'
import https from 'node:https'
import tls from 'node:tls'

/**
 * A phone, as far as the gateway can tell: real TLS with the certificate pinned by fingerprint (as the QR says), HTTP
 * for `/pair` and a WebSocket client written from RFC 6455 (masking, framing, close). Everything it receives is kept
 * in `received`, so a test can look for what must never cross the gateway.
 */

export const received: string[] = []

export interface Target { host: string; port: number; fp: string }

export function peerFingerprint(socket: tls.TLSSocket): string {
  return createHash('sha256').update(socket.getPeerX509Certificate()!.raw).digest('hex')
}

/** TLS to the gateway, refused unless its certificate is the pinned one; nothing is sent before the check. */
export function connectPinned(target: Target): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: target.host, port: target.port, rejectUnauthorized: false }, () => {
      if (peerFingerprint(socket) !== target.fp) { socket.destroy(); reject(new Error('certificate pin mismatch')); return }
      socket.off('error', reject)
      resolve(socket)
    })
    socket.once('error', reject)
  })
}

export interface HttpResult { status: number; headers: Record<string, string | string[] | undefined>; text: string; body: unknown }

export async function request(target: Target, options: { method?: string; path?: string; body?: string | Buffer; headers?: Record<string, string> } = {}): Promise<HttpResult> {
  const socket = await connectPinned(target)
  const body = options.body ?? ''
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: target.host, port: target.port, method: options.method ?? 'POST', path: options.path ?? '/pair', agent: false, rejectUnauthorized: false,
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...options.headers },
      createConnection: () => socket
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        received.push(JSON.stringify(res.headers), text)
        let parsed: unknown = null
        try { parsed = JSON.parse(text) } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, body: parsed })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

export function maskedFrame(opcode: number, payload: Buffer, options: { fin?: boolean; mask?: boolean } = {}): Buffer {
  const { fin = true, mask = true } = options
  const size = payload.length
  const header = size < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, (mask ? 0x80 : 0) | size])
    : size < 0x10000 ? Buffer.from([(fin ? 0x80 : 0) | opcode, (mask ? 0x80 : 0) | 126, size >> 8, size & 0xff])
      : (() => { const value = Buffer.alloc(10); value[0] = (fin ? 0x80 : 0) | opcode; value[1] = (mask ? 0x80 : 0) | 127; value.writeUInt32BE(size, 6); return value })()
  if (!mask) return Buffer.concat([header, payload])
  const key = randomBytes(4)
  const masked = Buffer.from(payload)
  for (let index = 0; index < masked.length; index += 1) masked[index] ^= key[index & 3]
  return Buffer.concat([header, key, masked])
}

export class TestSocket {
  readonly frames: unknown[] = []
  closeCode: number | null = null
  readonly closed: Promise<{ code: number | null; at: number }>
  private waiters: Array<(frame: unknown) => void> = []
  private buffer = Buffer.alloc(0)

  private constructor(readonly socket: tls.TLSSocket, rest: Buffer) {
    this.closed = new Promise(resolve => socket.on('close', () => resolve({ code: this.closeCode, at: Date.now() })))
    socket.on('data', (data: Buffer) => this.receive(data))
    socket.on('error', () => { /* ends in close */ })
    if (rest.length) this.receive(rest)
  }

  /** Opens a WebSocket; resolves with the socket on 101, or with the HTTP status that refused it. */
  static async open(target: Target, options: { path?: string; headers?: Record<string, string> } = {}): Promise<TestSocket | number> {
    const socket = await connectPinned(target)
    const key = randomBytes(16).toString('base64')
    const headers = { Host: `${target.host}:${target.port}`, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', ...options.headers }
    socket.write(`GET ${options.path ?? '/'} HTTP/1.1\r\n${Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`)
    const { head, rest } = await new Promise<{ head: string; rest: Buffer }>((resolve, reject) => {
      let data = Buffer.alloc(0)
      const onData = (chunk: Buffer) => {
        data = Buffer.concat([data, chunk])
        const end = data.indexOf('\r\n\r\n')
        if (end < 0) return
        socket.off('data', onData)
        resolve({ head: data.subarray(0, end).toString('latin1'), rest: data.subarray(end + 4) })
      }
      socket.on('data', onData)
      socket.once('close', () => reject(new Error('closed during handshake')))
    })
    received.push(head)
    const status = Number(head.split(' ')[1])
    if (status !== 101) { socket.destroy(); return status }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    if (!head.toLowerCase().includes(`sec-websocket-accept: ${accept.toLowerCase()}`)) throw new Error('bad Sec-WebSocket-Accept')
    return new TestSocket(socket, rest)
  }

  static async connect(target: Target): Promise<TestSocket> {
    const socket = await TestSocket.open(target)
    if (typeof socket === 'number') throw new Error(`upgrade refused: ${socket}`)
    return socket
  }

  send(frame: unknown): void { this.sendText(JSON.stringify(frame)) }
  sendText(text: string): void { this.sendRaw(maskedFrame(0x1, Buffer.from(text, 'utf8'))) }
  sendRaw(bytes: Buffer): void { if (!this.socket.destroyed) this.socket.write(bytes) }

  /** The next frame from the gateway, as parsed JSON. */
  next(timeoutMs = 3000): Promise<Record<string, unknown>> {
    const queued = this.frames.shift()
    if (queued !== undefined) return Promise.resolve(queued as Record<string, unknown>)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no frame arrived')), timeoutMs)
      this.waiters.push(frame => { clearTimeout(timer); resolve(frame as Record<string, unknown>) })
    })
  }

  /** Sends a frame and returns the answer. */
  async ask(frame: unknown): Promise<Record<string, unknown>> {
    this.send(frame)
    return this.next()
  }

  close(): void {
    this.sendRaw(maskedFrame(0x8, Buffer.from([0x03, 0xe8])))
    this.socket.end()
  }

  private receive(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data])
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f
      if (this.buffer[1] & 0x80) throw new Error('the server must not mask')
      let size = this.buffer[1] & 0x7f, offset = 2
      if (size === 126) { if (this.buffer.length < 4) return; size = this.buffer.readUInt16BE(2); offset = 4 }
      else if (size === 127) { if (this.buffer.length < 10) return; size = this.buffer.readUInt32BE(6); offset = 10 }
      if (this.buffer.length < offset + size) return
      const payload = this.buffer.subarray(offset, offset + size)
      this.buffer = this.buffer.subarray(offset + size)
      if (opcode === 0x8) { this.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : null; this.socket.end(); continue }
      if (opcode !== 0x1) continue
      const text = payload.toString('utf8')
      received.push(text)
      const frame = JSON.parse(text) as unknown
      const waiter = this.waiters.shift()
      if (waiter) waiter(frame)
      else this.frames.push(frame)
    }
  }
}
