// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'vitest'
import { RemoteConnection, type ConnectionHost } from '../../electron/main/services/remote/connection'
import { WebSocketConnection } from '../../electron/main/services/remote/websocket'
import { readPairRequest, readRemoteFrame, REMOTE_ERROR_CODES, REMOTE_FRAME_TYPES } from '../../shared/remote/protocol'
import { maskedFrame } from '../helpers/remote-client'

/** A seeded generator, so a failure reproduces. */
function random(seed: number) {
  let state = seed >>> 0
  const next = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 }
  const int = (max: number) => Math.floor(next() * max)
  const pick = <T>(values: readonly T[]): T => values[int(values.length)]
  const value = (depth = 0): unknown => {
    switch (int(depth > 3 ? 5 : 8)) {
      case 0: return null
      case 1: return next() < 0.5
      case 2: return pick([0, -1, 1.5, 2 ** 53, NaN, 1e308])
      case 3: return pick(['', 'hello', 'x'.repeat(int(200)), 'A'.repeat(22), '\u0000', 'thread.send', 'secrets.read'])
      case 4: return Buffer.from(Array.from({ length: int(40) }, () => int(256))).toString('latin1')
      case 5: return Array.from({ length: int(4) }, () => value(depth + 1))
      default: {
        const keys = ['type', 'id', 'code', 'deviceName', 'publicKey', 'command', 'args', 'topic', 'versions', 'accessToken', 'refresh', '__proto__', 'constructor']
        return Object.fromEntries(Array.from({ length: int(6) }, () => [pick(keys), key(depth)]))
      }
    }
    function key(d: number) { return next() < 0.3 ? pick(REMOTE_FRAME_TYPES) : value(d + 1) }
  }
  return { int, pick, value, next }
}

describe('fuzz: frame and pairing readers', () => {
  test('readRemoteFrame never throws and only accepts known client frames', () => {
    const r = random(1)
    for (let round = 0; round < 5000; round += 1) {
      const text = round % 3 === 0 ? randomBytes(r.int(300)).toString(r.pick(['utf8', 'latin1', 'base64'] as const)) : JSON.stringify(r.value())
      const read = readRemoteFrame(text ?? 'undefined', 'client')
      if (read.ok) expect(['hello', 'auth', 'subscribe', 'unsubscribe', 'command']).toContain(read.frame.type)
      else expect(REMOTE_ERROR_CODES).toContain(read.code)
    }
  })

  test('readPairRequest never throws and accepts only the exact shape', () => {
    const r = random(2)
    for (let round = 0; round < 5000; round += 1) {
      const read = readPairRequest(r.value())
      if (read.ok) expect(Object.keys(read.request).sort()).toEqual(['code', 'deviceName', 'publicKey'])
      else expect(read.code).toBe('malformed')
    }
  })
})

describe('fuzz: the WebSocket reader and the connection', () => {
  const host: ConnectionHost = {
    desktopName: 'Desk', now: () => 0, isRevoked: () => false, takeCommand: () => ({ ok: true }), topic: () => undefined,
    authenticate: () => ({ ok: false, code: 'unauthenticated' }), authenticated: () => {}, seen: () => {}, closed: () => {}
  }

  test('random bytes never throw; at worst the connection closes', () => {
    for (let round = 0; round < 500; round += 1) {
      const socket = new PassThrough()
      let texts = 0
      const ws = new WebSocketConnection(socket, 1024, { onText: () => { texts += 1 }, onClose: () => {} })
      ws.accept('dGhlIHNhbXBsZSBub25jZQ==', Buffer.alloc(0))
      expect(() => { for (let chunk = 0; chunk < 5; chunk += 1) ws.receive(randomBytes(1 + (round % 200))) }).not.toThrow()
      expect(texts).toBeGreaterThanOrEqual(0)
      socket.destroy()
    }
  })

  test('random frames through a connection only ever produce protocol frames', () => {
    const r = random(3)
    const sent: Array<Record<string, unknown>> = []
    for (let round = 0; round < 300; round += 1) {
      const connection = new RemoteConnection('10.0.0.9', host)
      connection.attach({ sendText: text => { sent.push(JSON.parse(text)); return true }, close: () => {}, isOpen: true })
      for (let frame = 0; frame < 10; frame += 1) {
        const payload = frame === 0 && round % 2 ? JSON.stringify({ type: 'hello', versions: [1] }) : JSON.stringify(r.value()) ?? 'x'
        expect(() => connection.receive(payload)).not.toThrow()
      }
      connection.closed()
    }
    for (const frame of sent) {
      expect(['hello', 'error', 'ack']).toContain(frame.type)
      if (frame.type === 'error') expect(REMOTE_ERROR_CODES).toContain(frame.code)
      // Nothing was ever authenticated, so nothing beyond hello and errors went out.
      expect(frame.type).not.toBe('ack')
    }
  })

  test('valid frames wrapped in random fragmentation still arrive whole', () => {
    const r = random(4)
    const socket = new PassThrough(), texts: string[] = []
    const ws = new WebSocketConnection(socket, 4096, { onText: text => texts.push(text), onClose: () => {} })
    ws.accept('dGhlIHNhbXBsZSBub25jZQ==', Buffer.alloc(0))
    const expected: string[] = []
    for (let round = 0; round < 50; round += 1) {
      const text = JSON.stringify({ round, pad: 'é'.repeat(r.int(500)) })
      expected.push(text)
      const bytes = maskedFrame(0x1, Buffer.from(text))
      for (let offset = 0; offset < bytes.length;) { const size = 1 + r.int(64); ws.receive(bytes.subarray(offset, offset + size)); offset += size }
    }
    expect(texts).toEqual(expected)
  })
})
