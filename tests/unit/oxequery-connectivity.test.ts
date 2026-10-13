import { createHash } from 'node:crypto'
import { createServer as createTcpServer, connect, type Server as TcpServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Server as SshServer, utils } from 'ssh2'
import { mongoTlsOptions, mongoUri, pgSsl } from '../../electron/main/services/oxequery/connection-options'
import { fingerprintOf, openTunnel, probeHostKey } from '../../electron/main/services/oxequery/ssh-tunnel'
import type { ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

/**
 * ssh2's ed25519 key generator now and then produces a key its own parser refuses
 * ("Malformed OpenSSH private key"). The tests need a key that parses, so draw again.
 */
function freshKeyPair(): { private: string; public: string } {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pair = utils.generateKeyPairSync('ed25519')
    const parsed = utils.parseKey(pair.private)
    if (!(parsed instanceof Error)) return pair
  }
  throw new Error('Could not generate a parseable ed25519 key')
}

const base = (change: Partial<ResolvedConnection> = {}): ResolvedConnection => ({ id: 'c', engine: 'postgres', host: 'db.example.com', port: 5432, database: 'app', username: 'me', sslMode: 'disable', readOnly: true, ...change })

describe('TLS options', () => {
  it('maps each mode to what it actually verifies', () => {
    expect(pgSsl(base({ sslMode: 'disable' }))).toBe(false)
    expect(pgSsl(base({ sslMode: 'prefer' }))).toBe(false)
    expect(pgSsl(base({ sslMode: 'require' }))).toMatchObject({ rejectUnauthorized: false })
    const ca = pgSsl(base({ sslMode: 'verify-ca', tls: { ca: 'CA' } }))
    expect(ca).toMatchObject({ rejectUnauthorized: true, ca: 'CA' })
    expect((ca as { checkServerIdentity: () => unknown }).checkServerIdentity()).toBeUndefined()
    expect(pgSsl(base({ sslMode: 'verify-full', tls: { ca: 'CA', cert: 'C', key: 'K' } }))).toMatchObject({ rejectUnauthorized: true, servername: 'db.example.com', ca: 'CA', cert: 'C', key: 'K' })
  })

  it('does the same for MongoDB without putting key material in the URI', () => {
    expect(mongoTlsOptions(base({ engine: 'mongodb', sslMode: 'disable' }))).toEqual({})
    expect(mongoTlsOptions(base({ engine: 'mongodb', sslMode: 'require' }))).toMatchObject({ tls: true, tlsAllowInvalidCertificates: true })
    expect(mongoTlsOptions(base({ engine: 'mongodb', sslMode: 'verify-full', tls: { ca: 'CA' } }))).toMatchObject({ tls: true, servername: 'db.example.com', ca: 'CA' })
    const uri = mongoUri(base({ engine: 'mongodb', sslMode: 'verify-full', tls: { ca: 'PRIVATE-CA', key: 'PRIVATE-KEY', cert: 'x' } }))
    expect(uri).not.toContain('PRIVATE')
  })
})

describe('MongoDB connection string', () => {
  const mongo = (options: Partial<NonNullable<ResolvedConnection['mongo']>> = {}, change: Partial<ResolvedConnection> = {}) =>
    base({ engine: 'mongodb', port: 27017, username: 'root', password: 'p@ss/w:rd', mongo: { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [], ...options }, ...change })

  it('encodes credentials, defaults the auth source and goes direct for one host', () => {
    expect(mongoUri(mongo())).toBe('mongodb://root:p%40ss%2Fw%3Ard@db.example.com:27017/?appName=OxeQuery&authSource=admin&directConnection=true')
  })

  it('supports an auth source, a replica set and several hosts', () => {
    const uri = mongoUri(mongo({ authSource: 'users', replicaSet: 'rs0', directConnection: false, extraHosts: ['b.example.com:27017', 'c.example.com:27018'] }))
    expect(uri).toBe('mongodb://root:p%40ss%2Fw%3Ard@db.example.com:27017,b.example.com:27017,c.example.com:27018/?appName=OxeQuery&authSource=users&replicaSet=rs0')
  })

  it('uses SRV for a seed list and falls back to a single direct host through a tunnel', () => {
    expect(mongoUri(mongo({ srv: true }, { host: 'cluster0.abc.mongodb.net' }))).toMatch(/^mongodb\+srv:\/\/root:.*@cluster0\.abc\.mongodb\.net\/\?/)
    const tunneled = mongoUri(mongo({ srv: true, replicaSet: 'rs0', extraHosts: ['x:1'] }), { host: '127.0.0.1', port: 40000 })
    expect(tunneled).toContain('@127.0.0.1:40000/')
    expect(tunneled).toContain('directConnection=true')
    expect(tunneled).not.toContain('x:1')
  })

  it('brackets an IPv6 literal', () => {
    expect(mongoUri(mongo({}, { host: '::1' }))).toContain('@[::1]:27017/')
  })
})

describe('SSH tunnel', () => {
  const cleanup: (() => Promise<void> | void)[] = []
  afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })

  /** A real SSH server on loopback that accepts one key or password and forwards channels to an echo service. */
  async function sshServer(options: { password?: string; clientPublicKey?: string } = {}) {
    const hostKey = freshKeyPair().private
    const echo: TcpServer = createTcpServer(socket => socket.on('data', chunk => socket.write(`echo:${chunk.toString()}`)))
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve))
    const echoPort = (echo.address() as { port: number }).port
    const forwarded: string[] = []
    const server = new SshServer({ hostKeys: [hostKey] }, client => {
      client.on('authentication', context => {
        if (context.method === 'password' && options.password !== undefined && context.password === options.password) return context.accept()
        if (context.method === 'publickey' && options.clientPublicKey) {
          const parsed = utils.parseKey(options.clientPublicKey)
          const key = Array.isArray(parsed) ? parsed[0] : parsed
          if (!(key instanceof Error) && context.key.algo === key.type && Buffer.compare(context.key.data, key.getPublicSSH()) === 0) {
            if (!context.signature || key.verify(context.blob!, context.signature, context.hashAlgo)) return context.accept()
          }
        }
        context.reject()
      })
      client.on('ready', () => {
        client.on('tcpip', (accept, _reject, info) => {
          forwarded.push(`${info.destIP}:${info.destPort}`)
          const channel = accept()
          const upstream = connect(info.destPort, '127.0.0.1')
          channel.pipe(upstream).pipe(channel)
          upstream.on('error', () => channel.close())
        })
      })
      client.on('error', () => undefined)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanup.push(() => new Promise<void>(resolve => { echo.close(() => resolve()); server.close() }))
    // The fingerprint a client computes is the SHA-256 of the host key blob.
    const parsed = utils.parseKey(hostKey)
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (key instanceof Error) throw key
    const fingerprint = `SHA256:${createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/, '')}`
    return { port: (server.address() as { port: number }).port, echoPort, fingerprint, forwarded }
  }

  async function roundTrip(port: number, text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(text))
      socket.once('data', chunk => { socket.destroy(); resolve(chunk.toString()) })
      socket.once('error', reject)
    })
  }

  it('forwards through a password login once the host key is trusted', async () => {
    const server = await sshServer({ password: 'hunter2' })
    const tunnel = await openTunnel({ host: '127.0.0.1', port: server.port, user: 'dev', password: 'hunter2', pinnedFingerprint: server.fingerprint }, { host: '127.0.0.1', port: server.echoPort })
    cleanup.push(() => tunnel.close())
    expect(tunnel.fingerprint).toBe(server.fingerprint)
    expect(await roundTrip(tunnel.endpoint.port, 'ping')).toBe('echo:ping')
    expect(server.forwarded).toEqual([`127.0.0.1:${server.echoPort}`])
  })

  it('authenticates with a private key', async () => {
    const pair = freshKeyPair()
    const privatePem = pair.private
    const server = await sshServer({ clientPublicKey: pair.public })
    const tunnel = await openTunnel({ host: '127.0.0.1', port: server.port, user: 'dev', privateKey: privatePem, pinnedFingerprint: server.fingerprint }, { host: '127.0.0.1', port: server.echoPort })
    cleanup.push(() => tunnel.close())
    expect(await roundTrip(tunnel.endpoint.port, 'k')).toBe('echo:k')
  })

  it('refuses an unknown host key before sending a credential and reports its fingerprint', async () => {
    const server = await sshServer({ password: 'hunter2' })
    await expect(openTunnel({ host: '127.0.0.1', port: server.port, user: 'dev', password: 'hunter2' }, { host: '127.0.0.1', port: server.echoPort }))
      .rejects.toMatchObject({ code: 'host-key-unknown', reasons: [server.fingerprint] })
    expect(await probeHostKey({ host: '127.0.0.1', port: server.port })).toBe(server.fingerprint)
  })

  it('treats a changed host key as a hard failure', async () => {
    const server = await sshServer({ password: 'hunter2' })
    const other = fingerprintOf(createHash('sha256').update('another key').digest('hex'))
    await expect(openTunnel({ host: '127.0.0.1', port: server.port, user: 'dev', password: 'hunter2', pinnedFingerprint: other }, { host: '127.0.0.1', port: server.echoPort }))
      .rejects.toMatchObject({ code: 'host-key-changed', reasons: [other, server.fingerprint] })
  })

  it('explains rejected credentials and an unreachable server without leaking the password', async () => {
    const server = await sshServer({ password: 'right' })
    const rejected = await openTunnel({ host: '127.0.0.1', port: server.port, user: 'dev', password: 'wrong-secret', pinnedFingerprint: server.fingerprint }, { host: '127.0.0.1', port: server.echoPort }).catch(error => error as Error)
    expect(rejected).toMatchObject({ code: 'tunnel' })
    expect(rejected.message).toMatch(/rejected the credentials/)
    expect(rejected.message).not.toContain('wrong-secret')
    const dead = createTcpServer(); await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
    const port = (dead.address() as { port: number }).port
    await new Promise<void>(resolve => dead.close(() => resolve()))
    await expect(openTunnel({ host: '127.0.0.1', port, user: 'dev', password: 'x', pinnedFingerprint: 'SHA256:' + 'A'.repeat(43) }, { host: '127.0.0.1', port: 1 })).rejects.toMatchObject({ code: 'tunnel' })
  })

  it('stops listening when closed and tells its owner', async () => {
    const server = await sshServer({ password: 'p' })
    const tunnel = await openTunnel({ host: '127.0.0.1', port: server.port, user: 'dev', password: 'p', pinnedFingerprint: server.fingerprint }, { host: '127.0.0.1', port: server.echoPort })
    let notified = 0
    tunnel.onClose(() => { notified++ })
    await tunnel.close()
    await tunnel.close()
    expect(notified).toBe(1)
    await expect(roundTrip(tunnel.endpoint.port, 'x')).rejects.toBeTruthy()
  })
})
