/**
 * Live checks for OxeQuery connectivity against real servers: verified TLS and an
 * SSH tunnel to a database that is NOT published on the host. Skipped unless
 * OXE_LIVE=1. Needs Docker and the built worker (`npx electron-vite build`).
 *
 *   OXE_LIVE=1 npm run test:electron -- tests/live/oxequery-connectivity-live.test.ts
 */
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OxeQueryCore } from '../../electron/main/services/oxequery/oxequery-core'
import { probeHostKey } from '../../electron/main/services/oxequery/ssh-tunnel'
import type { ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

/** The server versions under test; CI runs the suite against several (OXE_LIVE_PG_IMAGE / OXE_LIVE_MONGO_IMAGE). */
const PG_IMAGE = process.env.OXE_LIVE_PG_IMAGE ?? 'docker.io/library/postgres:16-alpine'
const MONGO_IMAGE = process.env.OXE_LIVE_MONGO_IMAGE ?? 'docker.io/library/mongo:7'

const live = process.env.OXE_LIVE === '1'
const suffix = Math.random().toString(36).slice(2, 8)
const NETWORK = `oxe-conn-${suffix}`
const PG = `oxe-conn-pg-${suffix}`
const PG_TLS = `oxe-conn-pgtls-${suffix}`
const SSHD = `oxe-conn-ssh-${suffix}`
const MONGO = `oxe-conn-mongo-${suffix}`
const MONGO_PASSWORD = 'oxe-mongo-root-pw'
const VOLUME = `oxe-conn-certs-${suffix}`
const PASSWORD = 'oxe-conn-pw'
const SSH_PASSWORD = 'oxe-ssh-pw'

// The engine under test: Docker by default, Podman with OXE_CONTAINER_ENGINE=podman (CI runs both).
const ENGINE = process.env.OXE_CONTAINER_ENGINE === 'podman' ? 'podman' : 'docker'
const docker = (...args: string[]): string => execFileSync(ENGINE, args, { encoding: 'utf8' }).trim()
const hostPort = (name: string, inner: number): number => Number(docker('port', name, String(inner)).split('\n')[0].split(':').pop())

async function freePort(): Promise<number> {
  return new Promise(resolve => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => { const { port } = server.address() as { port: number }; server.close(() => resolve(port)) })
  })
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
async function until(label: string, check: () => boolean | Promise<boolean>, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { try { if (await check()) return } catch { /* not yet */ } await sleep(1000) }
  throw Error(`Timed out: ${label}`)
}

describe.skipIf(!live)('OxeQuery connectivity against real servers', () => {
  const core = new OxeQueryCore()
  let serverCert = ''
  let tlsPort = 0
  let sshPort = 0

  const connection = (change: Partial<ResolvedConnection>): ResolvedConnection => ({
    id: `c-${Math.random().toString(36).slice(2, 8)}`, engine: 'postgres', host: '127.0.0.1', port: tlsPort, database: 'appdb', username: 'oxe', password: PASSWORD,
    sslMode: 'disable', readOnly: true, ...change
  })

  beforeAll(async () => {
    docker('network', 'create', NETWORK)
    docker('volume', 'create', VOLUME)
    // A self-signed server certificate valid for 127.0.0.1 and localhost.
    docker('run', '--rm', '-v', `${VOLUME}:/certs`, 'docker.io/library/alpine:3.20', 'sh', '-c',
      'apk add --no-cache openssl >/dev/null && openssl req -new -x509 -days 2 -nodes -subj "/CN=oxe-test" -addext "subjectAltName=DNS:localhost" -keyout /certs/server.key -out /certs/server.crt && chmod 600 /certs/server.key && chown 70:70 /certs/server.key /certs/server.crt')
    serverCert = docker('run', '--rm', '-v', `${VOLUME}:/certs`, 'docker.io/library/alpine:3.20', 'cat', '/certs/server.crt')

    docker('run', '-d', '--name', PG_TLS, '-v', `${VOLUME}:/certs`, '-e', 'POSTGRES_USER=oxe', '-e', 'POSTGRES_DB=appdb', '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
      '-p', '127.0.0.1::5432', PG_IMAGE, '-c', 'ssl=on', '-c', 'ssl_cert_file=/certs/server.crt', '-c', 'ssl_key_file=/certs/server.key')
    docker('run', '-d', '--name', PG, '--network', NETWORK, '-e', 'POSTGRES_USER=oxe', '-e', 'POSTGRES_DB=appdb', '-e', `POSTGRES_PASSWORD=${PASSWORD}`, PG_IMAGE)
    docker('run', '-d', '--name', MONGO, '--network', NETWORK, '-e', 'MONGO_INITDB_ROOT_USERNAME=root', '-e', `MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}`, MONGO_IMAGE)
    docker('run', '-d', '--name', SSHD, '--network', NETWORK, '-p', '127.0.0.1::22', 'docker.io/library/alpine:3.20', 'sh', '-c',
      `apk add --no-cache openssh >/dev/null && ssh-keygen -A && adduser -D oxe && echo 'oxe:${SSH_PASSWORD}' | chpasswd && exec /usr/sbin/sshd -D -e -o AllowTcpForwarding=yes -o PasswordAuthentication=yes -o UsePAM=no`)

    await until('tls postgres ready', () => docker('exec', PG_TLS, 'pg_isready', '-U', 'oxe', '-d', 'appdb').includes('accepting'))
    await until('plain postgres ready', () => docker('exec', PG, 'pg_isready', '-U', 'oxe', '-d', 'appdb').includes('accepting'))
    await until('mongo ready', () => docker('exec', MONGO, 'mongosh', '--quiet', '-u', 'root', '-p', MONGO_PASSWORD, '--authenticationDatabase', 'admin', '--eval', 'db.runCommand({ ping: 1 }).ok').trim().endsWith('1'))
    // A user that lives in the "shop" database, not in "admin".
    // The image answers ping from a temporary server during its init, then restarts: seed with a script that
    // can be repeated until the real server is up.
    await until('mongo seeded', () => {
      docker('exec', MONGO, 'mongosh', '--quiet', '-u', 'root', '-p', MONGO_PASSWORD, '--authenticationDatabase', 'admin', '--eval',
        'const shop = db.getSiblingDB("shop"); if (!shop.getUser("shopper")) shop.createUser({ user: "shopper", pwd: "shop-pw", roles: [{ role: "readWrite", db: "shop" }] }); shop.items.updateOne({ sku: "a" }, { $set: { sku: "a" } }, { upsert: true })')
      return true
    })
    tlsPort = hostPort(PG_TLS, 5432)
    await until('sshd ready', async () => { sshPort = hostPort(SSHD, 22); return (await probeHostKey({ host: '127.0.0.1', port: sshPort })).startsWith('SHA256:') }, 120_000)
  }, 300_000)

  afterAll(async () => {
    await core.closeAll()
    for (const name of [PG, PG_TLS, SSHD, MONGO]) { try { docker('rm', '-f', name) } catch { /* gone */ } }
    try { docker('volume', 'rm', '-f', VOLUME) } catch { /* gone */ }
    try { docker('network', 'rm', NETWORK) } catch { /* gone */ }
  }, 60_000)

  describe('TLS', () => {
    it('encrypts without verifying in require mode', async () => {
      const result = await core.test(connection({ sslMode: 'require' }))
      expect(result).toMatchObject({ ok: true })
      const ssl = await core.sqlRun(connection({ sslMode: 'require' }), 'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()')
      expect(ssl.rows[0][0]).toBe(true)
    })

    it('verify-full accepts the right CA and the right host name', async () => {
      const result = await core.test(connection({ host: 'localhost', sslMode: 'verify-full', tls: { ca: serverCert } }))
      expect(result).toMatchObject({ ok: true })
    })

    it('verify-full and verify-ca refuse a server whose certificate is not trusted', async () => {
      const untrusted = await core.test(connection({ sslMode: 'verify-full' }))
      expect(untrusted.ok).toBe(false)
      expect(untrusted.message).toMatch(/self.signed|unable to verify|certificate/i)
      const wrong = await core.test(connection({ sslMode: 'verify-ca', tls: { ca: serverCert.replace(/[A-Za-z0-9+/]{16}/, 'AAAAAAAAAAAAAAAA') } }))
      expect(wrong.ok).toBe(false)
    })

    it('verify-full also checks the host name, verify-ca does not', async () => {
      // The certificate only names "localhost"; the address 127.0.0.1 is not covered.
      const byAddress = { host: '127.0.0.1', tls: { ca: serverCert } } as const
      const strict = await core.test(connection({ ...byAddress, sslMode: 'verify-full' }))
      expect(strict.ok).toBe(false)
      expect(strict.message).toMatch(/altnames|hostname|IP|not in the cert/i)
      expect(await core.test(connection({ ...byAddress, sslMode: 'verify-ca' }))).toMatchObject({ ok: true })
    })

    it('never leaks the password in a failed TLS attempt', async () => {
      const failed = await core.test(connection({ sslMode: 'verify-full', password: 'a-very-secret-pw' }))
      expect(failed.ok).toBe(false)
      expect(failed.message).not.toContain('a-very-secret-pw')
    })
  })

  describe('SSH tunnel', () => {
    const ssh = (change: Record<string, unknown> = {}) => ({ host: '127.0.0.1', port: sshPort, user: 'oxe', password: SSH_PASSWORD, ...change })

    it('asks for the host key before sending the password', async () => {
      const result = await core.test(connection({ host: PG, port: 5432, ssh: ssh() }))
      expect(result).toMatchObject({ ok: false, code: 'host-key-unknown' })
      expect(result.reasons?.[0]).toMatch(/^SHA256:/)
    })

    it('reaches a database that is not published on the host, once the key is trusted', async () => {
      const fingerprint = await probeHostKey({ host: '127.0.0.1', port: sshPort })
      const tunneled = connection({ host: PG, port: 5432, ssh: ssh({ pinnedFingerprint: fingerprint }) })
      const result = await core.test(tunneled)
      expect(result).toMatchObject({ ok: true })
      const rows = await core.sqlRun(tunneled, 'SELECT current_database(), inet_server_addr()::text')
      expect(rows.rows[0][0]).toBe('appdb')
      // The same host name is unreachable without the tunnel.
      expect((await core.test(connection({ host: PG, port: 5432 }))).ok).toBe(false)
    })

    it('refuses a changed host key and a wrong SSH password', async () => {
      const changed = await core.test(connection({ host: PG, port: 5432, ssh: ssh({ pinnedFingerprint: `SHA256:${'A'.repeat(43)}` }) }))
      expect(changed).toMatchObject({ ok: false, code: 'host-key-changed' })
      const fingerprint = await probeHostKey({ host: '127.0.0.1', port: sshPort })
      const wrong = await core.test(connection({ host: PG, port: 5432, ssh: ssh({ pinnedFingerprint: fingerprint, password: 'nope' }) }))
      expect(wrong).toMatchObject({ ok: false, code: 'tunnel' })
      expect(wrong.message).not.toContain('nope')
    })

    it('closes the tunnel with the session', async () => {
      const fingerprint = await probeHostKey({ host: '127.0.0.1', port: sshPort })
      const tunneled = connection({ host: PG, port: 5432, ssh: ssh({ pinnedFingerprint: fingerprint }) })
      await core.sqlRun(tunneled, 'SELECT 1')
      await core.closeConnection(tunneled.id)
      // A fresh request builds a new tunnel and still works.
      expect((await core.sqlRun(tunneled, 'SELECT 2')).rows[0][0]).toBe(2)
      await core.closeConnection(tunneled.id)
    })
  })

  describe('MongoDB', () => {
    const mongo = (change: Partial<ResolvedConnection>): ResolvedConnection => ({
      id: `m-${Math.random().toString(36).slice(2, 8)}`, engine: 'mongodb', host: MONGO, port: 27017, database: '', username: 'root', password: MONGO_PASSWORD,
      sslMode: 'disable', readOnly: true, mongo: { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [] }, ...change
    })
    const throughSsh = async (change: Partial<ResolvedConnection>): Promise<ResolvedConnection> => {
      const fingerprint = await probeHostKey({ host: '127.0.0.1', port: sshPort })
      return mongo({ ssh: { host: '127.0.0.1', port: sshPort, user: 'oxe', password: SSH_PASSWORD, pinnedFingerprint: fingerprint }, ...change })
    }

    it('reaches a MongoDB that is not published, through the tunnel', async () => {
      const connection = await throughSsh({})
      expect(await core.test(connection)).toMatchObject({ ok: true })
      expect((await core.mongoDatabases(connection)).map(item => item.name)).toContain('shop')
      expect((await core.mongoFind(connection, { connectionId: connection.id, database: 'shop', collection: 'items' })).documents).toHaveLength(1)
      await core.closeConnection(connection.id)
    })

    it('authenticates against the database the user was created in', async () => {
      const wrongSource = await throughSsh({ username: 'shopper', password: 'shop-pw' })
      const rejected = await core.test(wrongSource)
      expect(rejected.ok).toBe(false)
      expect(rejected.message).not.toContain('shop-pw')
      await core.closeConnection(wrongSource.id)

      const right = await throughSsh({ username: 'shopper', password: 'shop-pw', database: 'shop', mongo: { authSource: 'shop', replicaSet: '', directConnection: true, srv: false, extraHosts: [] } })
      expect((await core.mongoCollections(right, 'shop')).map(item => item.name)).toContain('items')
      await core.closeConnection(right.id)
    })
  })

  it('has free ports to spare', async () => { expect(await freePort()).toBeGreaterThan(0) })
})
