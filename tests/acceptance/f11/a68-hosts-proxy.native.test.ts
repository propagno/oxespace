// Frozen acceptance test for 1.5.0 A68 / H4 (OXE program, phase F11): the outgoing hosts proxy. Off by default; when on,
// a loopback proxy that agents started from then on get through their environment logs only host and port, per
// conversation, tunnels CONNECT bytes untouched (no TLS interception), forwards plain HTTP, and never blocks. A port
// it can't take is a "failed" state with a reason and Try again; agents then run without it.
// Written by the planner; the executor must not edit it. Real loopback sockets and a real, migrated in-memory database.
// CCR: docs/roadmap-1.5/ccr-f11-release.md §A68; DESIGN 1.5.0-f11-design.md U11.3.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f11/a68-hosts-proxy.native.test.ts
import { createServer as createHttpServer } from 'node:http'
import { connect, createServer, type AddressInfo, type Server } from 'node:net'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { HostsProxy } from '../../../electron/main/services/hosts-proxy/hosts-proxy'
import type { ConversationThread } from '../../../shared/types/thread'

vi.setConfig({ testTimeout: 30_000 })
const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) { try { await step() } catch { /* closing */ } } })

const listen = (server: Server | ReturnType<typeof createHttpServer>) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))

function fixture(options: { port?: number } = {}) {
  const db: AppDatabase = openInMemoryDatabase()
  cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'shop', '/work/shop', '1x1', 'builtin-claude')").run()
  db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('project', '/work/shop', '/work/shop', 'shop', 1, 1)").run()
  const thread: ConversationThread = { id: 't-1', workspaceId: 'ws', projectId: 'project', rootPath: '/work/shop', provider: 'claude', title: 'Fix the Pix webhook', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1, generation: 1 }
  db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES ('t-1', 'ws', 'project', ?, '[]')").run(JSON.stringify(thread))
  const proxy = new HostsProxy(db, { ...(options.port === undefined ? {} : { port: options.port }) })
  cleanup.push(() => proxy.stop())
  return { db, proxy }
}

/** The proxy's address and credentials, as an agent's environment carries them. */
function proxyOf(env: Record<string, string>) {
  const url = new URL(env.HTTPS_PROXY)
  return { port: Number(url.port), auth: `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}` }
}

/** Opens a CONNECT tunnel through the proxy, sends `payload`, and returns the status line and what came back. */
function tunnel(proxyPort: number, target: string, payload: string, auth?: string): Promise<{ status: string; echoed: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(proxyPort, '127.0.0.1')
    let buffer = '', status = ''
    socket.on('error', reject)
    socket.on('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`))
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1')
      if (!status && buffer.includes('\r\n\r\n')) {
        status = buffer.slice(0, buffer.indexOf('\r\n'))
        buffer = buffer.slice(buffer.indexOf('\r\n\r\n') + 4)
        if (!/ 200 /.test(status)) { socket.end(); resolve({ status, echoed: '' }); return }
        socket.write(payload)
      }
      if (status && buffer.length >= payload.length) { socket.end(); resolve({ status, echoed: buffer }) }
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
    expect(f.proxy.envFor({ conversationId: 't-1' })).toEqual({})
  })

  test('A68: on, a CONNECT tunnel carries the bytes untouched and logs only the host and port, for the conversation that ran it', async () => {
    const target = await echoServer()
    const f = fixture()
    expect(await f.proxy.setEnabled(true)).toMatchObject({ enabled: true, state: 'running' })
    const env = f.proxy.envFor({ conversationId: 't-1' })
    expect(env).toMatchObject({ HTTPS_PROXY: expect.stringMatching(/^http:\/\/.+@127\.0\.0\.1:\d+$/), HTTP_PROXY: env.HTTPS_PROXY })
    const { port, auth } = proxyOf(env)
    // TLS bytes would be opaque the same way: the proxy only splices the sockets.
    const payload = '\u0016\u0003\u0001 hello, not decrypted'
    expect(await tunnel(port, `127.0.0.1:${target}`, payload, auth)).toEqual({ status: expect.stringMatching(/^HTTP\/1\.[01] 200/), echoed: payload })
    await tunnel(port, `127.0.0.1:${target}`, 'again', auth)
    expect(f.proxy.status().hosts).toEqual([
      { host: '127.0.0.1', port: target, count: 2, lastSeen: expect.any(Number), firstSeen: expect.any(Number), conversationId: 't-1', conversationTitle: 'Fix the Pix webhook' }
    ])
  })

  test('A68: plain HTTP is forwarded, and the path, query, headers and body are never stored', async () => {
    const target = createHttpServer((request, response) => { request.resume(); response.end('ok') })
    cleanup.push(() => new Promise(resolve => target.close(resolve)))
    const targetPort = await listen(target)
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.envFor({ paneId: 'pane-1' }))
    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1')
      let text = ''
      socket.on('error', reject)
      socket.on('data', chunk => { text += chunk.toString(); if (text.includes('ok')) { socket.end(); resolve(text) } })
      socket.write(`POST http://127.0.0.1:${targetPort}/v1/charges?token=abc HTTP/1.1\r\nHost: 127.0.0.1:${targetPort}\r\nProxy-Authorization: ${auth}\r\nX-Secret: s3cret-header\r\nContent-Length: 15\r\nConnection: close\r\n\r\ncard=4111111111`)
    })
    expect(answer).toMatch(/^HTTP\/1\.1 200/)
    // A pane is outside a conversation.
    expect(f.proxy.status().hosts).toEqual([expect.objectContaining({ host: '127.0.0.1', port: targetPort, count: 1 })])
    expect(f.proxy.status().hosts[0].conversationId).toBeUndefined()
    const stored = JSON.stringify(f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => f.db.prepare(`SELECT * FROM "${(row as { name: string }).name}"`).all()))
    for (const secret of ['/v1/charges', 'token=abc', 's3cret-header', '4111111111']) expect(stored, secret).not.toContain(secret)
  })

  test('A68: it never blocks: an unreachable host is still answered and logged, and a connection without credentials is outside a conversation', async () => {
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port } = proxyOf(f.proxy.envFor({ conversationId: 't-1' }))
    // Port 9 on loopback refuses: the proxy reports a gateway error, never a "denied".
    const refused = await tunnel(port, '127.0.0.1:9', 'x')
    expect(refused.status).toMatch(/^HTTP\/1\.[01] 502/)
    expect(f.proxy.status().hosts).toEqual([expect.objectContaining({ host: '127.0.0.1', port: 9, count: 1 })])
    expect(f.proxy.status().hosts[0].conversationId).toBeUndefined()
  })

  test('A68: a port it can\'t take is a failed state with a reason, agents run without it, and Try again starts it', async () => {
    const blocker = createServer()
    const taken = await listen(blocker)
    const f = fixture({ port: taken })
    expect(await f.proxy.setEnabled(true)).toMatchObject({ enabled: true, state: 'failed', reason: { code: 'hostsProxy.portInUse', params: { port: taken } } })
    expect(f.proxy.envFor({ conversationId: 't-1' })).toEqual({})
    await new Promise(resolve => blocker.close(resolve))
    expect(await f.proxy.retry()).toMatchObject({ enabled: true, state: 'running' })
    expect(Object.keys(f.proxy.envFor({ conversationId: 't-1' }))).toContain('HTTPS_PROXY')
  })

  test('A68: clear empties the list, and turning it off stops the proxy and the environment', async () => {
    const target = await echoServer()
    const f = fixture()
    await f.proxy.setEnabled(true)
    const { port, auth } = proxyOf(f.proxy.envFor({ conversationId: 't-1' }))
    await tunnel(port, `127.0.0.1:${target}`, 'x', auth)
    expect(f.proxy.status().hosts).toHaveLength(1)
    f.proxy.clear()
    expect(f.proxy.status().hosts).toEqual([])
    expect(await f.proxy.setEnabled(false)).toMatchObject({ enabled: false, state: 'stopped' })
    expect(f.proxy.envFor({ conversationId: 't-1' })).toEqual({})
    await expect(tunnel(port, `127.0.0.1:${target}`, 'x', auth)).rejects.toThrow()
  })
})
