// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import type { RemoteTopicSource } from '../../electron/main/services/remote/connection'
import { RemoteStore } from '../../electron/main/services/remote/store'
import { isHelloChallenge, REMOTE_COMMANDS, REMOTE_FORBIDDEN, REMOTE_LIMITS } from '../../shared/remote/protocol'
import { maskedFrame, received, TestSocket, type Target } from '../helpers/remote-client'
import { Harness, newPhone, signRefresh, type Phone } from '../helpers/remote-gateway-harness'

const harnesses: Harness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })

interface Paired { h: Harness; target: Target; phone: Phone; deviceId: string; accessToken: string }

async function paired(overrides: ConstructorParameters<typeof Harness>[0] = {}): Promise<Paired> {
  const h = new Harness(overrides)
  harnesses.push(h)
  const target = await h.enable()
  const { res, phone } = await h.pair()
  const body = res.body as { deviceId: string; accessToken: string }
  return { h, target, phone, deviceId: body.deviceId, accessToken: body.accessToken }
}

async function hello(target: Target): Promise<{ socket: TestSocket; challenge: string }> {
  const socket = await TestSocket.connect(target)
  const answer = await socket.ask({ type: 'hello', versions: [1] })
  return { socket, challenge: answer.challenge as string }
}

async function signedIn(p: Paired): Promise<TestSocket> {
  const { socket } = await hello(p.target)
  expect(await socket.ask({ type: 'auth', id: 'a1', accessToken: p.accessToken })).toMatchObject({ type: 'ack', id: 'a1' })
  return socket
}

describe('remote gateway: hello and auth', () => {
  test('hello answers with the version, the desktop name and a fresh 32-byte challenge per connection', async () => {
    const p = await paired()
    const first = await hello(p.target), second = await hello(p.target)
    expect(isHelloChallenge(first.challenge) && isHelloChallenge(second.challenge)).toBe(true)
    expect(first.challenge).not.toBe(second.challenge)
    const socket = await TestSocket.connect(p.target)
    expect(await socket.ask({ type: 'hello', versions: [1] })).toEqual({ type: 'hello', versions: [1], desktopName: 'OXESpace', challenge: expect.any(String) })

    const old = await TestSocket.connect(p.target)
    expect(await old.ask({ type: 'hello', versions: [7, 8] })).toEqual({ type: 'error', code: 'unsupported-version' })
    expect((await old.closed).code).toBe(1000)
    // Anything but hello first ends the connection.
    const rude = await TestSocket.connect(p.target)
    expect(await rude.ask({ type: 'subscribe', id: 's', topic: 'threads' })).toEqual({ type: 'error', id: 's', code: 'unauthenticated' })
    expect((await rude.closed).code).toBe(1008)
  })

  test('an access token signs in until it expires; it never extends itself', async () => {
    const p = await paired()
    const socket = await signedIn(p)
    expect(p.h.gateway.devices()[0].connected).toBe(true)
    const again = await hello(p.target)
    const ack = await again.socket.ask({ type: 'auth', id: 'x', accessToken: p.accessToken })
    expect(ack).toMatchObject({ result: { accessToken: p.accessToken } })
    expect((ack.result as { expiresInMs: number }).expiresInMs).toBeLessThanOrEqual(REMOTE_LIMITS.accessTokenTtlMs)

    p.h.clock += REMOTE_LIMITS.accessTokenTtlMs + 1
    // The open connection: its next request is told the token expired.
    expect(await socket.ask({ type: 'subscribe', id: 's1', topic: 'threads' })).toEqual({ type: 'error', id: 's1', code: 'token-expired' })
    const late = await hello(p.target)
    expect(await late.socket.ask({ type: 'auth', id: 'y', accessToken: p.accessToken })).toEqual({ type: 'error', id: 'y', code: 'token-expired' })
    expect((await late.socket.closed).code).toBe(1008)
    // A forged or altered token is just unauthenticated.
    const forged = await hello(p.target)
    const parts = p.accessToken.split('.')
    expect(await forged.socket.ask({ type: 'auth', id: 'z', accessToken: `${parts[0]}.${parts[1]}.${'A'.repeat(43)}` })).toMatchObject({ code: 'unauthenticated' })
  })

  test('refresh needs the device key\'s signature over this connection\'s challenge', async () => {
    const p = await paired()
    const { socket, challenge } = await hello(p.target)
    const signature = signRefresh(p.phone, p.target.fp, p.deviceId, challenge)
    const ack = await socket.ask({ type: 'auth', id: 'r1', refresh: { deviceId: p.deviceId, nonce: challenge, signature } })
    expect(ack).toMatchObject({ type: 'ack', id: 'r1', result: { expiresInMs: REMOTE_LIMITS.accessTokenTtlMs } })
    const fresh = (ack.result as { accessToken: string }).accessToken
    expect(fresh).not.toBe(p.accessToken)
    // The new token works after the old one would have expired.
    p.h.clock += REMOTE_LIMITS.accessTokenTtlMs - 1000
    const later = await hello(p.target)
    expect(await later.socket.ask({ type: 'auth', id: 'r2', accessToken: fresh })).toMatchObject({ type: 'ack' })

    // Replaying that signature on another connection: its challenge differs.
    const replay = await hello(p.target)
    expect(await replay.socket.ask({ type: 'auth', id: 'r3', refresh: { deviceId: p.deviceId, nonce: challenge, signature } })).toMatchObject({ code: 'unauthenticated' })
    // A signature over another nonce.
    const wrongNonce = await hello(p.target)
    const other = randomBytes(32).toString('base64url')
    expect(await wrongNonce.socket.ask({ type: 'auth', id: 'r4', refresh: { deviceId: p.deviceId, nonce: wrongNonce.challenge, signature: signRefresh(p.phone, p.target.fp, p.deviceId, other) } })).toMatchObject({ code: 'unauthenticated' })
    // Another key.
    const wrongKey = await hello(p.target)
    expect(await wrongKey.socket.ask({ type: 'auth', id: 'r5', refresh: { deviceId: p.deviceId, nonce: wrongKey.challenge, signature: signRefresh(newPhone(), p.target.fp, p.deviceId, wrongKey.challenge) } })).toMatchObject({ code: 'unauthenticated' })
    // Another certificate fingerprint in the signed text.
    const wrongFp = await hello(p.target)
    expect(await wrongFp.socket.ask({ type: 'auth', id: 'r6', refresh: { deviceId: p.deviceId, nonce: wrongFp.challenge, signature: signRefresh(p.phone, 'cd'.repeat(32), p.deviceId, wrongFp.challenge) } })).toMatchObject({ code: 'unauthenticated' })
    // A raw r‖s (IEEE P1363) signature over the right text: not DER, refused.
    const raw = await hello(p.target)
    const { sign } = await import('node:crypto')
    const { refreshSigningInput } = await import('../../shared/remote/protocol')
    const p1363 = sign('sha256', Buffer.from(refreshSigningInput(p.target.fp, p.deviceId, raw.challenge)), { key: p.phone.keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    expect(await raw.socket.ask({ type: 'auth', id: 'r8', refresh: { deviceId: p.deviceId, nonce: raw.challenge, signature: p1363 } })).toMatchObject({ code: 'unauthenticated' })
    // Malformed auth frames.
    const malformed = await hello(p.target)
    expect(await malformed.socket.ask({ type: 'auth', id: 'r7', accessToken: p.accessToken, refresh: { deviceId: p.deviceId, nonce: 'x', signature: 'y' } })).toMatchObject({ code: 'malformed' })
    const failures = new RemoteStore(p.h.db).auditEntries().filter(entry => entry.action === 'auth-failure')
    expect(failures.length).toBeGreaterThanOrEqual(4)
  })

  test('revoking closes the device\'s socket within a second and refuses its token and refresh', async () => {
    const p = await paired()
    const socket = await signedIn(p)
    const started = Date.now()
    p.h.gateway.revoke({ deviceId: p.deviceId })
    expect(await socket.next()).toEqual({ type: 'error', code: 'revoked' })
    const closed = await socket.closed
    expect(closed.at - started).toBeLessThan(1000)
    expect(closed.code).toBe(1008)
    expect(p.h.gateway.devices()).toEqual([])
    expect(p.h.gateway.status().devices).toBe(0)

    const byToken = await hello(p.target)
    expect(await byToken.socket.ask({ type: 'auth', id: 'a', accessToken: p.accessToken })).toEqual({ type: 'error', id: 'a', code: 'revoked' })
    const byRefresh = await hello(p.target)
    expect(await byRefresh.socket.ask({ type: 'auth', id: 'b', refresh: { deviceId: p.deviceId, nonce: byRefresh.challenge, signature: signRefresh(p.phone, p.target.fp, p.deviceId, byRefresh.challenge) } }))
      .toEqual({ type: 'error', id: 'b', code: 'revoked' })
    expect(() => p.h.gateway.revoke({ deviceId: p.deviceId })).toThrow('Unknown device')
    expect(new RemoteStore(p.h.db).auditEntries().some(entry => entry.action === 'revoke' && entry.deviceId === p.deviceId)).toBe(true)
  })

  test('rename, devices and last seen', async () => {
    const p = await paired()
    expect(p.h.gateway.rename({ deviceId: p.deviceId, name: '  Work phone  ' })).toMatchObject({ deviceId: p.deviceId, name: 'Work phone' })
    for (const name of ['', '   ', 'x'.repeat(65), 'bad\u0007name', 42]) expect(() => p.h.gateway.rename({ deviceId: p.deviceId, name })).toThrow()
    p.h.clock += 5 * 60_000
    const socket = await signedIn(p)
    expect(p.h.gateway.devices()[0]).toMatchObject({ name: 'Work phone', connected: true, lastSeenAt: p.h.clock })
    socket.close()
    await socket.closed
    await vi.waitFor(() => expect(p.h.gateway.devices()[0].connected).toBe(false))
  })
})

describe('remote gateway: frames, limits and what the phone may never do', () => {
  test('oversized, malformed, binary, unmasked and invalid UTF-8 frames are refused', async () => {
    const p = await paired()
    const big = await signedIn(p)
    big.sendText(JSON.stringify({ type: 'command', id: 'c', command: 'thread.send', args: { text: 'x'.repeat(REMOTE_LIMITS.maxFrameBytes) } }))
    // `ws` refuses it from the frame header and closes with 1009 ("message too big"); nothing of it is read.
    expect((await big.closed).code).toBe(1009)

    const malformed = await signedIn(p)
    for (const text of ['nope', '[]', 'null', '{"type":"nope"}', '{"type":"event","subscription":"x"}']) {
      malformed.sendText(text)
      expect(await malformed.next(), text).toEqual({ type: 'error', code: 'malformed' })
    }
    malformed.sendText('{not json')
    expect(await malformed.next()).toEqual({ type: 'error', code: 'malformed' })
    malformed.sendText('{"type":"ack","id":"x"}')
    expect(await malformed.next()).toEqual({ type: 'error', id: 'x', code: 'malformed' })
    malformed.send({ type: 'command', id: 'k', command: 'host.exec', args: {} })
    expect(await malformed.next()).toEqual({ type: 'error', id: 'k', code: 'unknown-command' })
    malformed.send({ type: 'subscribe', id: 'q', topic: 'threads', extra: true })
    expect(await malformed.next()).toEqual({ type: 'error', id: 'q', code: 'malformed' })

    for (const [bytes, code] of [
      [maskedFrame(0x2, Buffer.from('{}')), 1003],
      [maskedFrame(0x1, Buffer.from('{}'), { mask: false }), 1002],
      [maskedFrame(0x1, Buffer.from([0x7b, 0xff, 0xfe, 0x7d])), 1007],
      [maskedFrame(0x9, Buffer.alloc(126)), 1002]
    ] as const) {
      const socket = await signedIn(p)
      socket.sendRaw(bytes)
      expect((await socket.closed).code).toBe(code)
    }
  })

  test('upgrades from a browser page, on another path or without the handshake headers are refused', async () => {
    const p = await paired()
    expect(await TestSocket.open(p.target, { headers: { Origin: 'https://evil.example' } })).toBe(403)
    for (const path of ['/', '/ws', '/v1/ws/', '/v1/ws?x=1', '/v2/ws', '/pair']) expect(await TestSocket.open(p.target, { path }), path).toBe(404)
    expect(await TestSocket.open(p.target, { headers: { 'Sec-WebSocket-Version': '7' } })).toBe(400)
    expect(await TestSocket.open(p.target, { headers: { 'Sec-WebSocket-Key': 'short' } })).toBe(400)
  })

  test('without a desktop no command reaches anything; forbidden capabilities are refused; commands are rate-limited per device', async () => {
    const open = vi.fn()
    const p = await paired({ topics: { threads: { open } } })
    const socket = await signedIn(p)
    for (const command of REMOTE_COMMANDS) {
      expect(await socket.ask({ type: 'command', id: `c-${command}`, command, args: { threadId: 't1', text: 'hi' } })).toEqual({ type: 'error', id: `c-${command}`, code: 'forbidden' })
    }
    for (const forbidden of REMOTE_FORBIDDEN) {
      expect(await socket.ask({ type: 'command', id: 'f', command: forbidden, args: {} })).toMatchObject({ code: 'unknown-command' })
      expect(await socket.ask({ type: 'command', id: 'g', command: 'thread.send', args: { nested: [{ action: forbidden }] } })).toMatchObject({ code: 'forbidden' })
      expect(await socket.ask({ type: 'subscribe', id: 'h', topic: forbidden })).toMatchObject({ code: 'forbidden' })
    }
    expect(open).not.toHaveBeenCalled()

    // 60 per minute per device, counted across its connections; an unknown command counts too.
    const used = REMOTE_COMMANDS.length + 2 * REMOTE_FORBIDDEN.length
    for (let index = used; index < REMOTE_LIMITS.commandsPerMinute; index += 1) await socket.ask({ type: 'command', id: `n${index}`, command: 'thread.interrupt', args: {} })
    const second = await signedIn(p)
    const limited = await second.ask({ type: 'command', id: 'over', command: 'thread.interrupt', args: {} })
    expect(limited).toMatchObject({ type: 'error', id: 'over', code: 'rate-limited' })
    expect(limited.retryAfterMs).toBeGreaterThan(0)
    p.h.clock += 60_001
    expect(await second.ask({ type: 'command', id: 'ok', command: 'thread.interrupt', args: {} })).toMatchObject({ code: 'forbidden' })
  })

  test('subscriptions: ack before data, unsubscribe, unknown topics, the per-connection limit, closed with the socket', async () => {
    const closes = vi.fn()
    const threads: RemoteTopicSource = {
      open: (request, emit) => {
        if (request.target === 'missing') return null
        emit({ kind: 'snapshot', seq: 0, schemaVersion: 1, data: { target: request.target ?? null } })
        return { close: closes }
      }
    }
    const p = await paired({ topics: { threads } })
    const socket = await signedIn(p)
    expect(await socket.ask({ type: 'subscribe', id: 's1', topic: 'threads', sinceSeq: 0 })).toEqual({ type: 'ack', id: 's1', subscription: 'sub-1' })
    expect(await socket.next()).toEqual({ type: 'snapshot', subscription: 'sub-1', seq: 0, schemaVersion: 1, data: { target: null } })
    expect(await socket.ask({ type: 'subscribe', id: 's2', topic: 'threads', target: 'missing' })).toEqual({ type: 'error', id: 's2', code: 'not-found' })
    expect(await socket.ask({ type: 'subscribe', id: 's3', topic: 'jobs' })).toEqual({ type: 'error', id: 's3', code: 'not-found' })
    expect(await socket.ask({ type: 'subscribe', id: 's4', topic: 'everything' })).toEqual({ type: 'error', id: 's4', code: 'not-found' })
    expect(await socket.ask({ type: 'subscribe', id: 's5', topic: 'threads', sinceSeq: -1 })).toEqual({ type: 'error', id: 's5', code: 'malformed' })
    expect(await socket.ask({ type: 'unsubscribe', id: 'u1', subscription: 'sub-1' })).toEqual({ type: 'ack', id: 'u1', subscription: 'sub-1' })
    expect(closes).toHaveBeenCalledTimes(1)
    expect(await socket.ask({ type: 'unsubscribe', id: 'u2', subscription: 'sub-1' })).toEqual({ type: 'error', id: 'u2', code: 'not-found' })

    for (let index = 0; index < REMOTE_LIMITS.maxSubscriptions; index += 1) {
      expect(await socket.ask({ type: 'subscribe', id: `m${index}`, topic: 'threads', target: `t${index}` })).toMatchObject({ type: 'ack' })
      await socket.next()
    }
    expect(await socket.ask({ type: 'subscribe', id: 'over', topic: 'threads' })).toEqual({ type: 'error', id: 'over', code: 'too-many-subscriptions' })
    socket.close()
    await socket.closed
    await vi.waitFor(() => expect(closes).toHaveBeenCalledTimes(1 + REMOTE_LIMITS.maxSubscriptions))
  })

  test('switching it off closes every connection and refuses a pending pairing', async () => {
    const p = await paired()
    const socket = await signedIn(p)
    p.h.passAttemptWindow()
    const qr = p.h.offer()
    const prompt = p.h.nextPrompt()
    const { request } = await import('../helpers/remote-client')
    const pending = request(qr, { body: JSON.stringify({ code: qr.code, deviceName: 'Late', publicKey: newPhone().publicKey }) }).catch(error => error as Error)
    await prompt
    await p.h.gateway.setEnabled({ enabled: false })
    expect(p.h.changes.some(change => change.pairing === null)).toBe(true)
    // The phone's request ends without a device: refused, or cut off with the connection.
    const outcome = await pending
    if (!(outcome instanceof Error)) expect(outcome.body).toEqual({ code: 'pairing-refused' })
    expect(p.h.gateway.devices().map(device => device.name)).toEqual(['Pixel 8'])
    const closed = await socket.closed
    expect([1001, 1008, null]).toContain(closed.code)
    expect(p.h.gateway.devices()[0].connected).toBe(false)
  })
})

describe('remote gateway: no internal token ever crosses it', () => {
  test('MCP, execution and memory tokens appear in no response, frame or header', async () => {
    received.length = 0
    const p = await paired()
    const mcpToken = randomBytes(32).toString('hex')
    p.h.db.prepare('INSERT OR REPLACE INTO internal_mcp_meta (id, port, token, generated_at, server_row_id) VALUES (?, ?, ?, ?, ?)').run('singleton', 4000, mcpToken, Date.now(), null)
    const execution = new ExecutionRegistry().register({ paneId: 'pane-1', workspaceId: 'ws-1', cwd: process.cwd() })
    const previous = { ...process.env }
    Object.assign(process.env, { OXESPACE_MCP_TOKEN: mcpToken, OXESPACE_EXECUTION_TOKEN: execution.OXESPACE_EXECUTION_TOKEN })
    try {
      // Every surface: hello, both kinds of auth, errors, subscriptions, commands, pairing and its failures, 404s.
      const socket = await signedIn(p)
      const { socket: refreshed, challenge } = await hello(p.target)
      await refreshed.ask({ type: 'auth', id: 'r', refresh: { deviceId: p.deviceId, nonce: challenge, signature: signRefresh(p.phone, p.target.fp, p.deviceId, challenge) } })
      await socket.ask({ type: 'subscribe', id: 's', topic: 'threads' })
      await socket.ask({ type: 'command', id: 'c', command: 'thread.send', args: { text: mcpToken } })
      await socket.ask({ type: 'command', id: 'd', command: 'nope', args: {} })
      p.h.passAttemptWindow()
      await p.h.pair()
      await p.h.pair({ accept: false })
      const { request } = await import('../helpers/remote-client')
      await request(p.target, { method: 'GET', path: '/', body: '' })
      await request(p.target, { body: 'garbage' })
    } finally {
      for (const key of ['OXESPACE_MCP_TOKEN', 'OXESPACE_EXECUTION_TOKEN']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key] }
    }
    const everything = received.join('\n')
    expect(received.length).toBeGreaterThan(15)
    // The phone's own command echo is not something the gateway returns: errors carry only codes.
    for (const secret of [mcpToken, execution.OXESPACE_EXECUTION_TOKEN, Buffer.from(mcpToken, 'hex').toString('base64url')]) expect(everything).not.toContain(secret)
    // Nor the gateway's own secrets.
    const tokenKey = (p.h.gateway as unknown as { tokenKey: Buffer }).tokenKey
    expect(everything).not.toContain('PRIVATE KEY')
    for (const encoding of ['hex', 'base64', 'base64url'] as const) expect(everything).not.toContain(tokenKey.toString(encoding))
    // And nothing in the audit trail is a token or a code.
    const audit = JSON.stringify(new RemoteStore(p.h.db).auditEntries(500))
    expect(audit).not.toContain(p.accessToken)
    expect(audit).not.toContain(mcpToken)
  })

  test('the gateway\'s code imports nothing that holds internal tokens', () => {
    const root = resolve(__dirname, '../../electron/main/services/remote')
    // thread-history: M4's pending-requests topic reads conversations from the database; it holds no token.
    const allowed = [/^shared\//, /^electron\/main\/services\/remote\//, /^electron\/main\/db(\/index)?$/, /^electron\/main\/services\/oxequery\/secret-cipher$/, /^electron\/main\/services\/oxequery\/connection-store$/, /^electron\/main\/services\/conversation\/thread-history$/, /^electron\/main\/ipc\/main-message-error$/]
    const repo = resolve(__dirname, '../..')
    const seen = new Set<string>()
    const visit = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/from '(\.[^']+)'/g)) {
        const target = relative(repo, resolve(dirname(file), match[1])).replace(/\\/g, '/')
        expect(allowed.some(pattern => pattern.test(target)), `${relative(repo, file)} imports ${target}`).toBe(true)
        if (target.startsWith('electron/main/services/remote/')) visit(resolve(repo, `${target}.ts`))
      }
    }
    for (const name of readdirSync(root).filter(name => name.endsWith('.ts'))) visit(join(root, name))
    expect(seen.size).toBeGreaterThan(5)
  })
})

describe('remote gateway: the token signing key lives only in memory', () => {
  test('it is never written to the database; a restart ends access tokens, and refresh by the device key still works', async () => {
    const p = await paired()
    const key = (p.h.gateway as unknown as { tokenKey: Buffer }).tokenKey
    expect(key).toHaveLength(32)
    const columns = (p.h.db.prepare("PRAGMA table_info('remote_gateway')").all() as Array<{ name: string }>).map(column => column.name)
    // listened_before (089, M4/M5) is added after the table was created, so it comes last.
    expect(columns).toEqual(['id', 'port', 'certificate_der', 'certificate_key', 'desktop_name', 'updated_at', 'listened_before'])
    // No cell of any table holds the key, in any encoding.
    const tables = (p.h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name)
    const needles = [key.toString('hex'), key.toString('base64'), key.toString('base64url')]
    for (const table of tables) {
      for (const row of p.h.db.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>) {
        for (const value of Object.values(row)) {
          if (Buffer.isBuffer(value)) expect(value.includes(key), table).toBe(false)
          else if (typeof value === 'string') for (const needle of needles) expect(value.includes(needle), table).toBe(false)
        }
      }
    }

    await p.h.gateway.stop()
    p.h.gateway = p.h.create()
    const target = await p.h.enable()
    const stale = await hello(target)
    expect(await stale.socket.ask({ type: 'auth', id: 'old', accessToken: p.accessToken })).toMatchObject({ type: 'error', code: 'unauthenticated' })
    const fresh = await hello(target)
    expect(await fresh.socket.ask({ type: 'auth', id: 'new', refresh: { deviceId: p.deviceId, nonce: fresh.challenge, signature: signRefresh(p.phone, target.fp, p.deviceId, fresh.challenge) } }))
      .toMatchObject({ type: 'ack', id: 'new' })
  })

  test('random bytes after the handshake never take the gateway down', async () => {
    const p = await paired()
    for (let round = 0; round < 40; round += 1) {
      const socket = await TestSocket.connect(p.target)
      socket.sendRaw(round % 2 ? randomBytes(1 + round * 37) : maskedFrame(round % 16, randomBytes(round * 13)))
      await Promise.race([socket.closed, new Promise(resolve => setTimeout(resolve, 100))])
      socket.socket.destroy()
    }
    expect(p.h.gateway.status().enabled).toBe(true)
    const socket = await signedIn(p)
    expect(await socket.ask({ type: 'subscribe', id: 'alive', topic: 'jobs' })).toEqual({ type: 'error', id: 'alive', code: 'not-found' })
  })
})


describe('remote gateway: connection slots', () => {
  test('connections still to sign in share bounded slots: the oldest makes room, signed-in phones keep theirs', async () => {
    const p = await paired({ limits: { connections: 4, unauthenticatedPerAddress: 10, unauthenticated: 2 } })
    const first = await TestSocket.connect(p.target), second = await TestSocket.connect(p.target)
    // A third still to sign in: the oldest is told and closed, and its slot is free at once.
    const third = await TestSocket.connect(p.target)
    expect((await first.closed).code).toBe(1008)
    expect(first.frames.at(-1)).toEqual({ type: 'error', code: 'unauthenticated' })
    expect(second.closeCode).toBeNull()
    // A phone arriving to sign in takes a waiting slot too, from the oldest waiting; once signed in it holds its own.
    const one = await signedIn(p)
    expect((await second.closed).code).toBe(1008)
    const two = await signedIn(p)
    expect(third.closeCode).toBeNull()
    const fourth = await TestSocket.connect(p.target)
    for (const socket of [third, fourth]) {
      await socket.ask({ type: 'hello', versions: [1] })
      expect(await socket.ask({ type: 'auth', id: 'a', accessToken: p.accessToken })).toMatchObject({ type: 'ack' })
    }
    // Every slot signed in: the next connection is refused, and no phone is evicted for it.
    expect(await TestSocket.open(p.target)).toBe(503)
    for (const socket of [one, two, third, fourth]) expect(socket.closeCode).toBeNull()
  })

  test('one address may hold a few connections still to sign in, no more', async () => {
    const p = await paired({ limits: { unauthenticatedPerAddress: 2 } })
    const a = await TestSocket.connect(p.target), b = await TestSocket.connect(p.target)
    expect(await TestSocket.open(p.target)).toBe(429)
    await a.ask({ type: 'hello', versions: [1] })
    expect(await a.ask({ type: 'auth', id: 'a', accessToken: p.accessToken })).toMatchObject({ type: 'ack' })
    // Signed in, it no longer counts against the address's waiting slots.
    const c = await TestSocket.connect(p.target)
    expect(c.closeCode).toBeNull()
    expect(b.closeCode).toBeNull()
  })
})
