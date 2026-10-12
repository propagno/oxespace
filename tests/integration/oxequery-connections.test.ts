import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ConnectionStore, type SecretCipher } from '../../electron/main/services/oxequery/connection-store'
import { PickedFiles } from '../../electron/main/services/oxequery/picked-files'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

const cipher: SecretCipher = {
  available: () => true,
  encrypt: value => Buffer.from(`enc:${[...value].reverse().join('')}`),
  decrypt: value => [...value.toString().replace(/^enc:/, '')].reverse().join('')
}

const pem = (label: string): string => `-----BEGIN ${label}-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END ${label}-----\n`

function setup() {
  const db = openInMemoryDatabase(); databases.push(db)
  const picked = new PickedFiles()
  return { db, picked, store: new ConnectionStore(db, cipher, picked) }
}

const base = { name: 'secure', engine: 'postgres' as const, host: 'db.internal', port: 5432 }

describe('connection store: TLS material, SSH and agent access', () => {
  it('keeps CA and client certificate material only as secrets and reports flags', () => {
    const { db, picked, store } = setup()
    const saved = store.save({
      ...base, sslMode: 'verify-full',
      caHandle: picked.register('ca', 'ca.pem', pem('CERTIFICATE')),
      clientCertHandle: picked.register('cert', 'c.pem', pem('CERTIFICATE')),
      clientKeyHandle: picked.register('key', 'c.key', pem('PRIVATE KEY'))
    })
    expect(saved).toMatchObject({ sslMode: 'verify-full', hasCa: true, hasClientCert: true })
    expect(JSON.stringify(saved)).not.toContain('BEGIN')
    expect(JSON.stringify(db.prepare('SELECT * FROM oxequery_connections').all())).not.toContain('BEGIN')
    expect(store.resolve(saved.id).tls).toMatchObject({ ca: expect.stringContaining('BEGIN CERTIFICATE'), cert: expect.any(String), key: expect.stringContaining('PRIVATE KEY') })
    store.save({ ...base, id: saved.id, sslMode: 'verify-full', clearCa: true, clearClientCert: true })
    expect(store.resolve(saved.id).tls).toBeUndefined()
  })

  it('refuses a handle that expired, was already used, or is not a PEM file', () => {
    const { picked, store } = setup()
    expect(() => store.save({ ...base, sslMode: 'verify-ca', caHandle: 'missing' })).toThrow(/expired/)
    const handle = picked.register('ca', 'ca.pem', pem('CERTIFICATE'))
    store.save({ ...base, sslMode: 'verify-ca', caHandle: handle })
    expect(() => store.save({ ...base, name: 'again', sslMode: 'verify-ca', caHandle: handle })).toThrow(/expired/)
    expect(() => store.save({ ...base, name: 'junk', sslMode: 'verify-ca', caHandle: picked.register('ca', 'x.txt', 'not a certificate') })).toThrow(/not a PEM/)
    // A key handle cannot be used where a CA is expected.
    expect(() => store.save({ ...base, name: 'wrong', sslMode: 'verify-ca', caHandle: picked.register('key', 'k', pem('PRIVATE KEY')) })).toThrow(/expired/)
  })

  it('stores SSH credentials as one secret and pins host keys without ever overwriting a different one', () => {
    const { db, picked, store } = setup()
    const saved = store.save({
      ...base,
      ssh: { enabled: true, host: 'Bastion.Example.com', port: 2222, user: 'dev', auth: 'key', keyHandle: picked.register('sshKey', 'id_ed25519', pem('OPENSSH PRIVATE KEY')), passphrase: 'phrase' }
    })
    expect(saved.ssh).toMatchObject({ host: 'Bastion.Example.com', port: 2222, user: 'dev', auth: 'key', hasSecret: true, keyName: 'id_ed25519' })
    expect(JSON.stringify(db.prepare('SELECT * FROM oxequery_connections').all())).not.toContain('phrase')
    expect(store.resolve(saved.id).ssh).toMatchObject({ host: 'Bastion.Example.com', privateKey: expect.stringContaining('OPENSSH'), passphrase: 'phrase' })
    expect(store.resolve(saved.id).ssh?.pinnedFingerprint).toBeUndefined()
    const fingerprint = `SHA256:${'A'.repeat(43)}`
    store.trustHostKey('bastion.example.com', 2222, fingerprint)
    expect(store.resolve(saved.id).ssh?.pinnedFingerprint).toBe(fingerprint)
    expect(() => store.trustHostKey('bastion.example.com', 2222, `SHA256:${'B'.repeat(43)}`)).toThrow(/different host key/)
    expect(() => store.trustHostKey('x', 22, 'MD5:aa:bb')).toThrow(/valid host key/)
    store.forgetHostKey('bastion.example.com', 2222)
    expect(store.knownHosts()).toEqual([])
  })

  it('requires the SSH secret, and drops it when the tunnel is turned off', () => {
    const { db, store } = setup()
    expect(() => store.save({ ...base, ssh: { enabled: true, host: 'b', port: 22, user: 'u', auth: 'key' } })).toThrow(/private key/)
    expect(() => store.save({ ...base, ssh: { enabled: true, host: 'b', port: 22, user: 'u', auth: 'password' } })).toThrow(/SSH password/)
    const saved = store.save({ ...base, ssh: { enabled: true, host: 'b', port: 22, user: 'u', auth: 'password', password: 'pw' } })
    expect(db.prepare('SELECT 1 FROM secure_credentials WHERE provider = ?').get(`oxequery:${saved.id}:ssh`)).toBeTruthy()
    const off = store.save({ ...base, id: saved.id, ssh: { enabled: false } })
    expect(off.ssh).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM secure_credentials WHERE provider = ?').get(`oxequery:${saved.id}:ssh`)).toBeUndefined()
  })

  it('keeps agents away from writing to production and bounds limits', () => {
    const { store } = setup()
    expect(() => store.save({ ...base, environment: 'prod', agentAccess: 'write' })).toThrow(/production/)
    expect(store.save({ ...base, environment: 'prod', agentAccess: 'read' }).agentAccess).toBe('read')
    expect(store.save({ ...base, name: 'dev' }).agentAccess).toBe('off')
    expect(() => store.save({ ...base, name: 'x', statementTimeoutMs: 10 })).toThrow(/timeout/)
    expect(() => store.save({ ...base, name: 'y', maxRows: 0 })).toThrow(/row limit/)
  })

  it('validates MongoDB options', () => {
    const { store } = setup()
    const mongo = { name: 'm', engine: 'mongodb' as const, host: 'mongo.internal', port: 27017 }
    const saved = store.save({ ...mongo, mongo: { authSource: 'users', replicaSet: 'rs0', extraHosts: ['b.internal:27017'], directConnection: false } })
    expect(saved.mongo).toEqual({ authSource: 'users', replicaSet: 'rs0', directConnection: false, srv: false, extraHosts: ['b.internal:27017'] })
    expect(() => store.save({ ...mongo, name: 'a', mongo: { extraHosts: ['no-port'] } })).toThrow(/host:port/)
    expect(() => store.save({ ...mongo, name: 'b', mongo: { authSource: 'a&b=c' } })).toThrow(/plain names/)
    expect(() => store.save({ ...mongo, name: 'c', mongo: { srv: true, extraHosts: ['x:1'] } })).toThrow(/mongodb\+srv/)
    expect(store.save({ ...mongo, name: 'd', host: 'cluster.abc.mongodb.net', mongo: { srv: true } }).mongo.srv).toBe(true)
  })
})

describe('migration 067', () => {
  it('upgrades a version 66 database and keeps its connections', () => {
    const db = new Database(':memory:')
    db.exec(readFileSync(join(process.cwd(), 'electron/main/db/migrations/066_oxequery_connections.sql'), 'utf8'))
    db.prepare("INSERT INTO oxequery_connections (id, name, engine, host, port, database_name, username, ssl_mode, read_only, environment, has_password, created_at, updated_at) VALUES ('old', 'Legacy', 'postgres', 'h', 5432, 'd', 'u', 'require', 0, 'dev', 1, 1, 2)").run()
    expect(db.pragma('user_version', { simple: true })).toBe(66)
    db.exec(readFileSync(join(process.cwd(), 'electron/main/db/migrations/067_oxequery_connectivity.sql'), 'utf8'))
    expect(db.pragma('user_version', { simple: true })).toBe(67)
    expect(db.prepare('SELECT * FROM oxequery_connections').all()).toEqual([expect.objectContaining({
      id: 'old', name: 'Legacy', ssl_mode: 'require', read_only: 0, environment: 'dev', has_password: 1, agent_access: 'off', statement_timeout_ms: 60000, max_rows: 500, ssh_enabled: 0
    })])
    // The new TLS modes are accepted by the rebuilt table, unknown ones are not.
    expect(() => db.prepare("UPDATE oxequery_connections SET ssl_mode = 'verify-full' WHERE id = 'old'").run()).not.toThrow()
    expect(() => db.prepare("UPDATE oxequery_connections SET ssl_mode = 'bogus' WHERE id = 'old'").run()).toThrow()
    db.close()
  })
})
