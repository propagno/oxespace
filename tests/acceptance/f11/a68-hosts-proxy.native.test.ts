// Frozen acceptance test for 1.5.0 A68 / H4 (OXE program, phase F11), SECURITY (TECH LEAD S1–S6): the outgoing hosts
// proxy. Off by default; when on, a proxy bound to loopback on a random port serves only the agents it granted a
// per-start credential (anything else gets 407), logs only host and port per conversation, splices CONNECT bytes
// untouched (no TLS interception), streams plain HTTP without buffering bodies, and never blocks: an unreachable target
// is a 502, a crashed listener comes back on the same port, turning it off keeps serving the agents already running,
// and a person's own proxy is never silently replaced. A port it can't take is a "failed" state with Try again.
// Written by the planner; the executor must not edit it. Real loopback sockets and a real, migrated in-memory database.
// CCR: docs/roadmap-1.5/ccr-f11-release.md §A68; DESIGN 1.5.0-f11-design.md U11.3.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f11/a68-hosts-proxy.native.test.ts
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { connect, createServer, type AddressInfo, type Server } from 'node:net'
import { networkInterfaces } from 'node:os'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { HOSTS_PROXY_IDLE_MS, HostsProxy, type HostsProxyOptions } from '../../../electron/main/services/hosts-proxy/hosts-proxy'
import type { ConversationThread } from '../../../shared/types/thread'

vi.setConfig({ testTimeout: 60_000 })
const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) { try { await step() } catch { /* closing */ } } })
const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const listen = (server: Server | ReturnType<typeof createHttpServer>, port = 0) => new Promise<number>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)) })

function fixture(options: Partial<HostsProxyOptions> = {}) {
  const db: AppDatabase = openInMemoryDatabase()
  cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'shop', '/work/shop', '1x1', 'builtin-claude')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/work/shop', '/work/shop', 'shop', 1, 1)").run()
  const thread: ConversationThread = { id: 't-1', workspaceId: 'ws', projectId: 'project', rootPath: '/work/shop', provider: 'claude', title: 'Fix the Pix webhook', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1, generation: 1 }
  db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES ('t-1', 'ws', 'project', ?, '[]')").run(JSON.stringify(thread))
  let server: Server | undefined
  /** Everything the proxy logs, to prove what is never logged. */
  const lines: string[] = []
  const line = (...parts: unknown[]) => { lines.push(parts.map(part => typeof part === 'string' ? part : JSON.stringify(part, Object.getOwnPropertyNames(part ?? {}))).join(' ')) }
  const proxy = new HostsProxy(db, { env: {}, logger: { info: line, warn: line, error: line, debug: line }, ...options, onListening: listening => { server = listening; options.onListening?.(listening) } })
  cleanup.push(() => proxy.stop())
  /** Every value in every table, to prove what is never stored. */
  const stored = () => JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => db.prepare(`SELECT * FROM "${(row as { name: string }).name}"`).all()))
  return { db, proxy, stored, lines, server: () => server! }
}

/** The proxy's address and credentials, as an agent's environment carries them. */
function proxyOf(env: Record<string, string>) {
  const url = new URL(env.HTTPS_PROXY)
  return { host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username), secret: decodeURIComponent(url.password), auth: `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}` }
}

/** Opens a CONNECT tunnel through the proxy, sends `payload`, and returns the status line and what came back. */
function tunnel(proxyPort: number, target: string, payload: string, auth?: string, address = '127.0.0.1'): Promise<{ status: string; echoed: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, address)
    let buffer = '', status = ''
    socket.setTimeout(10_000, () => { socket.destroy(); reject(new Error('timeout')) })
    socket.on('error', reject)
    socket.on('close', () => { if (status) resolve({ status, echoed: buffer }) })
    socket.on('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`))
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1')
      if (!status && buffer.includes('\r\n\r\n')) {
        status = buffer.slice(0, buffer.indexOf('\r\n'))
        buffer = buffer.slice(buffer.indexOf('\r\n\r\n') + 4)
        if (!/ 200 /.test(status)) { socket.end(); return }
        socket.write(payload)
      }
      if (status && / 200 /.test(status) && buffer.length >= payload.length) socket.end()
    })
  })
}

async function echoServer() {
  const server = createServer(socket => socket.pipe(socket))
  cleanup.push(() => new Promise(resolve => server.close(resolve)))
  return listen(server)
}

describe('A68 · the outgoing hosts proxy', () => {
  test('A68: off by default: no proxy runs and agents get no proxy environment', () => {
    const f = fixture()
    expect(f.proxy.status()).toMatchObject({ enabled: false, state: 'stopped', hosts: [] })
    expect(f.proxy.grant({ conversationId: 't-1' }).env).toEqual({})
  })

  test('A68: a granted agent\'s CONNECT tunnel carries the bytes untouched and logs only host and port, for its conversation', async () => {
    const target = await echoServer()
    const f = fixture()
    expect(await f.proxy.setEnabled(true)).toMatchObject({ enabled: true, state: 'running' })
    const { env } = f.proxy.grant({ conversationId: 't-1' })
    const { port, auth } = proxyOf(env)
    // TLS bytes would be opaque the same way: the proxy only splices the sockets.
    const payload = '\u0016\u0003\u0001 hello, not decrypted'
    expect(await tunnel(port, `127.0.0.1:${target}`, payload, auth)).toEqual({ status: expect.stringMatching(/^HTTP\/1\.[01] 200/), echoed: payload })
    await tunnel(port, `127.0.0.1:${target}`, 'again', auth)
    expect(f.proxy.status().hosts).toEqual([
      { host: '127.0.0.1', port: target, count: 2, lastSeen: expect.any(Number), firstSeen: expect.any(Number), conversationId: 't-1', conversationTitle: 'Fix the Pix webhook' }
    ])
  })

  test('A68: plain HTTP is forwarded as a stream, and the path, query, headers and body are never stored', async () => {
    const seen: Array<{ url?: string; headers: Record<string, unknown>; body: string }> = []
    const target = createHttpServer((request, response) => {
      let body = ''
      request.on('data', chunk => { body += chunk })
      request.on('end', () => { seen.push({ url: request.url, headers: request.headers, body }); response.end('ok') })
    })
    cleanup.push(() => new Promise(resolve => target.close(resolve)))
    const targetPort = await listen(target)
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.grant({ paneId: 'pane-1' }).env)
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1')
      let text = ''
      socket.on('error', reject)
      socket.on('data', chunk => { text += chunk.toString(); if (text.includes('ok')) { socket.end(); resolve(text) } })
      socket.write(`POST http://127.0.0.1:${targetPort}/v1/charges?token=abc HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nProxy-Authorization: ${auth}\r\nX-Secret: s3cret-header\r\nContent-Length: 15\r\nConnection: close\r\n\r\ncard=4111111111`)
    })
    expect(answer).toMatch(/^HTTP\/1\.1 200/)
    // HML 724-1: the target gets the agent's request, but never the proxy's credential.
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ url: '/v1/charges?token=abc', body: 'card=4111111111', headers: expect.objectContaining({ 'x-secret': 's3cret-header' }) })
    expect(Object.keys(seen[0].headers)).not.toContain('proxy-authorization')
    expect(Object.keys(seen[0].headers)).not.toContain('proxy-connection')
    // A pane is outside a conversation.
    expect(f.proxy.status().hosts).toEqual([expect.objectContaining({ host: '127.0.0.1', port: targetPort, count: 1 })])
    expect(f.proxy.status().hosts[0].conversationId).toBeUndefined()
    for (const secret of ['/v1/charges', 'token=abc', 's3cret-header', '4111111111']) expect(f.stored(), secret).not.toContain(secret)
  })

  test('A68: it never blocks a granted agent: an unreachable target is a 502 and is still logged', async () => {
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.grant({ conversationId: 't-1' }).env)
    expect((await tunnel(port, '127.0.0.1:9', 'x', auth)).status).toMatch(/^HTTP\/1\.[01] 502/)
    expect(f.proxy.status().hosts).toEqual([expect.objectContaining({ host: '127.0.0.1', port: 9, count: 1, conversationId: 't-1' })])
  })

  test('A68: clear empties the list', async () => {
    const target = await echoServer()
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.grant({ conversationId: 't-1' }).env)
    await tunnel(port, `127.0.0.1:${target}`, 'x', auth)
    expect(f.proxy.status().hosts).toHaveLength(1)
    f.proxy.clear()
    expect(f.proxy.status().hosts).toEqual([])
  })
})

describe('A68 · SECURITY (TECH LEAD)', () => {
  test('A68 (S1): not an open local proxy: no, a wrong or a revoked credential gets 407 and nothing is forwarded; the credential is random per start and never stored', async () => {
    const target = await echoServer()
    const f = fixture()
    await f.proxy.setEnabled(true)
    const first = f.proxy.grant({ conversationId: 't-1' })
    const second = f.proxy.grant({ conversationId: 't-1' })
    const a = proxyOf(first.env), b = proxyOf(second.env)
    expect(a.secret).not.toBe(b.secret)
    expect(a.secret.length).toBeGreaterThanOrEqual(16)
    // The path is live: the granted credential tunnels.
    expect((await tunnel(a.port, `127.0.0.1:${target}`, 'ok', a.auth)).status).toMatch(/ 200 /)
    const before = f.proxy.status().hosts[0].count
    for (const auth of [undefined, `Basic ${Buffer.from(`${a.user}:wrong`).toString('base64')}`, 'Bearer x']) {
      expect((await tunnel(a.port, `127.0.0.1:${target}`, 'x', auth)).status, String(auth)).toMatch(/^HTTP\/1\.[01] 407/)
    }
    first.revoke()
    expect((await tunnel(a.port, `127.0.0.1:${target}`, 'x', a.auth)).status).toMatch(/^HTTP\/1\.[01] 407/)
    expect((await tunnel(b.port, `127.0.0.1:${target}`, 'ok', b.auth)).status).toMatch(/ 200 /)
    expect(f.proxy.status().hosts[0].count).toBe(before + 1)
    for (const secret of [a.secret, b.secret]) expect(f.stored()).not.toContain(secret)
  })

  test('A68 (S1, HML 724-2): the logs never carry a path, a query, a header value or a credential, on the forward, refused and unreachable paths', async () => {
    const target = createHttpServer((request, response) => { request.resume(); request.on('end', () => response.end('ok')) })
    cleanup.push(() => new Promise(resolve => target.close(resolve)))
    const targetPort = await listen(target)
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port, auth, secret } = proxyOf(f.proxy.grant({ conversationId: 't-1' }).env)
    const send = (raw: string) => new Promise<string>(resolve => {
      const socket = connect(port, '127.0.0.1')
      let text = ''
      socket.on('error', () => resolve(text))
      socket.on('data', chunk => { text += chunk.toString() })
      socket.on('close', () => resolve(text))
      socket.write(raw)
    })
    const request = (to: string, credential?: string) =>
      `GET http://${to}/v1/charges?token=abc HTTP/1.1\r\nHost: ${to}\r\n${credential ? `Proxy-Authorization: ${credential}\r\n` : ''}X-Secret: s3cret-header\r\nConnection: close\r\n\r\n`
    expect(await send(request(`127.0.0.1:${targetPort}`, auth))).toMatch(/^HTTP\/1\.1 200/)
    expect(await send(request('127.0.0.1:9', auth))).toMatch(/^HTTP\/1\.[01] 502/)
    expect(await send(request(`127.0.0.1:${targetPort}`))).toMatch(/^HTTP\/1\.[01] 407/)
    expect(await send('NOT A REQUEST\r\n\r\n')).toMatch(/^HTTP\/1\.[01] 400|^$/)
    const logs = f.lines.join('\n')
    for (const leak of ['/v1/charges', 'token=abc', 's3cret-header', secret, auth.split(' ')[1]]) expect(logs, leak).not.toContain(leak)
  })

  test('A68 (S2): it binds loopback only, on a random port, and a non-loopback interface can\'t connect', async () => {
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { host, port } = proxyOf(f.proxy.grant({ conversationId: 't-1' }).env)
    expect(host).toBe('127.0.0.1')
    // HML 724-3: even with no NO_PROXY of the person's, OXESpace's own loopback servers never go through it.
    const { env } = f.proxy.grant({ conversationId: 't-1' })
    for (const key of ['NO_PROXY', 'no_proxy']) expect(env[key].split(','), key).toEqual(expect.arrayContaining(['localhost', '127.0.0.1', '::1']))
    expect((f.server().address() as AddressInfo).address).toMatch(/^(127\.0\.0\.1|::1)$/)
    const other = fixture()
    await other.proxy.setEnabled(true)
    expect(proxyOf(other.proxy.grant({ conversationId: 't-1' }).env).port).not.toBe(port)
    const external = Object.values(networkInterfaces()).flat().find(entry => entry && entry.family === 'IPv4' && !entry.internal)
    if (external) await expect(tunnel(port, '127.0.0.1:9', 'x', undefined, external.address)).rejects.toThrow()
  })

  test('A68 (S3): a crashed listener comes back on the same port, so agents keep their network; a port taken meanwhile is a failed state with Try again', async () => {
    const target = await echoServer()
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.grant({ conversationId: 't-1' }).env)
    f.server().close()
    f.server().emit('error', new Error('crashed'))
    const end = Date.now() + 5000
    let answer = ''
    while (Date.now() < end) {
      answer = await tunnel(port, `127.0.0.1:${target}`, 'back', auth).then(result => result.status, () => '')
      if (/ 200 /.test(answer)) break
      await settle(100)
    }
    expect(answer).toMatch(/ 200 /)
    // Now crash it and take its port before it can return.
    const blocker = createServer()
    f.server().close(() => { listen(blocker, port).catch(() => undefined) })
    f.server().emit('error', new Error('crashed'))
    const until = Date.now() + 5000
    while (Date.now() < until && f.proxy.status().state !== 'failed') await settle(100)
    expect(f.proxy.status()).toMatchObject({ enabled: true, state: 'failed', reason: { code: 'hostsProxy.portInUse', params: { port } } })
    await new Promise(resolve => blocker.close(resolve))
    expect(await f.proxy.retry()).toMatchObject({ enabled: true, state: 'running' })
    expect((await tunnel(port, `127.0.0.1:${target}`, 'again', auth)).status).toMatch(/ 200 /)
  })

  test('A68 (S3): turning it off keeps serving the agents already running and grants no new ones; it stops when the last one ends', async () => {
    const target = await echoServer()
    const f = fixture()
    await f.proxy.setEnabled(true)
    const running = f.proxy.grant({ conversationId: 't-1' })
    const { port, auth } = proxyOf(running.env)
    expect(await f.proxy.setEnabled(false)).toMatchObject({ enabled: false })
    expect(f.proxy.grant({ conversationId: 't-1' }).env).toEqual({})
    const logged = f.proxy.status().hosts.reduce((n, host) => n + host.count, 0)
    expect((await tunnel(port, `127.0.0.1:${target}`, 'still', auth)).status).toMatch(/ 200 /)
    // HML 724-4: after off it is a silent pass-through: it connects, and nothing more is logged.
    expect(f.proxy.status().hosts.reduce((n, host) => n + host.count, 0)).toBe(logged)
    running.revoke()
    const end = Date.now() + 5000
    while (Date.now() < end && f.proxy.status().state !== 'stopped') await settle(50)
    expect(f.proxy.status().state).toBe('stopped')
    await expect(tunnel(port, `127.0.0.1:${target}`, 'x', auth)).rejects.toThrow()
  })

  test('A68 (S4): both proxy variables in both cases, the person\'s NO_PROXY kept with loopback added, and a person\'s own proxy is never silently replaced', async () => {
    const f = fixture({ env: { NO_PROXY: 'corp.local,.internal' } })
    await f.proxy.setEnabled(true)
    const { env } = f.proxy.grant({ conversationId: 't-1' })
    expect(env.HTTPS_PROXY).toMatch(/^http:\/\/.+@127\.0\.0\.1:\d+$/)
    for (const key of ['HTTP_PROXY', 'http_proxy', 'https_proxy']) expect(env[key], key).toBe(env.HTTPS_PROXY)
    for (const key of ['NO_PROXY', 'no_proxy']) {
      const entries = env[key].split(',')
      expect(entries, key).toEqual(expect.arrayContaining(['corp.local', '.internal', 'localhost', '127.0.0.1', '::1']))
    }
    const corporate = fixture({ env: { HTTPS_PROXY: 'http://proxy.corp:8080', http_proxy: 'http://proxy.corp:8080' } })
    expect(await corporate.proxy.setEnabled(true)).toMatchObject({ enabled: true, state: 'failed', reason: { code: 'hostsProxy.userProxy' } })
    expect(corporate.proxy.grant({ conversationId: 't-1' }).env).toEqual({})
  })

  test('A68 (S5): an idle tunnel is closed, concurrent connections are capped, and a large upload streams without growing memory', async () => {
    const target = await echoServer()
    // HML 724-5: by default a tunnel may stay idle for at least 10 minutes (WebSocket, SSE, streamed responses).
    expect(HOSTS_PROXY_IDLE_MS).toBeGreaterThanOrEqual(10 * 60_000)
    const f = fixture({ idleTimeoutMs: 400, maxConnections: 2 })
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.grant({ conversationId: 't-1' }).env)
    // Idle: a tunnel that sends nothing is closed by the proxy.
    const idleClosed = await new Promise<boolean>(resolve => {
      const socket = connect(port, '127.0.0.1')
      socket.on('connect', () => socket.write(`CONNECT 127.0.0.1:${target} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${auth}\r\n\r\n`))
      socket.on('close', () => resolve(true))
      setTimeout(() => { socket.destroy(); resolve(false) }, 5000)
    })
    expect(idleClosed).toBe(true)
    // The cap: two held tunnels, then a third is refused with 503, never queued forever.
    const held = await Promise.all([0, 1].map(() => new Promise<ReturnType<typeof connect>>(resolve => {
      const socket = connect(port, '127.0.0.1')
      socket.on('connect', () => socket.write(`CONNECT 127.0.0.1:${target} HTTP/1.1\r\nHost: x\r\nProxy-Authorization: ${auth}\r\n\r\n`))
      socket.once('data', () => resolve(socket))
    })))
    cleanup.push(() => held.forEach(socket => socket.destroy()))
    expect((await tunnel(port, `127.0.0.1:${target}`, 'x', auth)).status).toMatch(/^HTTP\/1\.[01] 503/)
    held.forEach(socket => socket.destroy())
    await settle(200)
    // A 64 MiB upload through plain HTTP streams: the process never holds the body.
    const sink = createHttpServer((request, response) => { let bytes = 0; request.on('data', chunk => { bytes += chunk.length }); request.on('end', () => response.end(String(bytes))) })
    cleanup.push(() => new Promise(resolve => sink.close(resolve)))
    const sinkPort = await listen(sink)
    const big = fixture({ idleTimeoutMs: 30_000 })
    await big.proxy.setEnabled(true)
    const p = proxyOf(big.proxy.grant({ conversationId: 't-1' }).env)
    const baseline = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers
    let peak = 0
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers - baseline) }, 20)
    const total = 64 * 1024 * 1024
    const received = await new Promise<string>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port: p.port, method: 'POST', path: `http://127.0.0.1:${sinkPort}/upload`, headers: { 'Proxy-Authorization': p.auth, 'Content-Length': total, Host: `127.0.0.1:${sinkPort}` } }, response => { let text = ''; response.on('data', chunk => { text += chunk }); response.on('end', () => resolve(text)) })
      request.on('error', reject)
      const chunk = Buffer.alloc(64 * 1024, 120)
      let sent = 0
      const pump = () => { while (sent < total) { sent += chunk.length; if (!request.write(chunk)) { request.once('drain', pump); return } } request.end() }
      pump()
    })
    clearInterval(sampler)
    expect(received).toBe(String(total))
    expect(peak).toBeLessThan(32 * 1024 * 1024)
  })

  test('A68 (S6): the list keeps 90 days and at most its row cap; turning it on or off and clearing are audited without content', async () => {
    let now = Date.parse('2026-11-08T12:00:00Z')
    const target = await echoServer()
    const second = await echoServer()
    const third = await echoServer()
    const f = fixture({ now: () => now, maxRows: 2 })
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.grant({ conversationId: 't-1' }).env)
    await tunnel(port, `127.0.0.1:${target}`, 'old', auth)
    now += 91 * 86_400_000
    await tunnel(port, `127.0.0.1:${second}`, 'new', auth)
    expect(f.proxy.status().hosts.map(host => host.port)).toEqual([second])
    await tunnel(port, `127.0.0.1:${third}`, 'newer', auth)
    now += 1000
    await tunnel(port, `127.0.0.1:${target}`, 'newest', auth)
    expect(f.proxy.status().hosts.map(host => host.port)).toEqual([target, third])
    f.proxy.clear()
    await f.proxy.setEnabled(false)
    const rows = f.db.prepare("SELECT actor, action, target, outcome FROM person_action_audit WHERE action LIKE 'hosts-proxy-%' ORDER BY id").all()
    expect(rows).toEqual([
      { actor: 'person', action: 'hosts-proxy-on', target: '', outcome: 'ok' },
      { actor: 'person', action: 'hosts-proxy-clear', target: '', outcome: 'ok' },
      { actor: 'person', action: 'hosts-proxy-off', target: '', outcome: 'ok' }
    ])
  })
})
