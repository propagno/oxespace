import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import type { ExecOptions, ExecResult, ExecutionHost } from '../../electron/main/runtime/execution-host'
import { ConnectionStore, normalizeConnectionInput, type SecretCipher } from '../../electron/main/services/oxequery/connection-store'
import { OxeQueryService } from '../../electron/main/services/oxequery/service'
import { OxeQueryError, type ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'
import { OxePodService } from '../../electron/main/services/oxepod/service'
import type { OxeQueryEvent } from '../../shared/types/oxequery'
import type { OxePodEvent } from '../../shared/types/oxepod'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

const cipher = (available = true): SecretCipher => ({
  available: () => available,
  encrypt: value => Buffer.from(`enc:${[...value].reverse().join('')}`),
  decrypt: value => [...value.toString().replace(/^enc:/, '')].reverse().join('')
})

const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '', timedOut: false })

const pgInspect = JSON.stringify([{
  Id: 'a'.repeat(64), Name: '/pg-dev', State: { Status: 'running' },
  Config: { Image: 'postgres:16', Env: ['POSTGRES_USER=app', 'POSTGRES_DB=shop', 'POSTGRES_PASSWORD=s3cret-pw'] },
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55432' }] }, Networks: {} }, HostConfig: {}, Mounts: []
}])

function fixture(options: { cipherAvailable?: boolean; inspect?: string } = {}) {
  const db = openInMemoryDatabase(); databases.push(db)
  const calls: { command: string; args: string[] }[] = []
  const host: ExecutionHost = {
    id: 'fake', kind: 'local',
    exec: vi.fn(async (command: string, args: string[], _options: ExecOptions) => {
      calls.push({ command, args })
      if (args[0] === 'version') return ok(command === 'docker' ? '27.0.0\n' : '')
      if (args[0] === 'info') return command === 'docker' ? ok('27.0.0\n') : { code: -1, stdout: '', stderr: 'not found', timedOut: false }
      if (args[0] === 'context') return ok('default\n')
      if (args[0] === 'ps') return ok(`${JSON.stringify({ ID: 'a'.repeat(64), Names: 'pg-dev', Image: 'postgres:16', State: 'running', Status: 'Up 1 minute', Ports: '0.0.0.0:55432->5432/tcp' })}\n`)
      if (args[0] === 'inspect') return ok(options.inspect ?? pgInspect)
      if (args[0] === 'exec') return { code: 0, stdout: 'hi\n', stderr: '', timedOut: false }
      return ok()
    }),
    readTextFile: vi.fn(), writeTextFile: vi.fn()
  }
  const worker = { call: vi.fn(async (op: string, _connection?: ResolvedConnection, _input?: unknown): Promise<unknown> => ({ op })), close: vi.fn(async () => undefined) }
  const events: OxeQueryEvent[] = []
  const podEvents: OxePodEvent[] = []
  const pod = new OxePodService({ host, emit: event => podEvents.push(event) })
  const service = new OxeQueryService({ db, worker, cipher: cipher(options.cipherAvailable ?? true), emit: event => events.push(event), pod: async () => pod.containers })
  return { db, host, worker, service, pod, events, podEvents, calls }
}

describe('connection store', () => {
  it('stores the password only in secure credentials and never returns it', () => {
    const { db } = fixture()
    const store = new ConnectionStore(db, cipher())
    const saved = store.save({ name: 'Local', engine: 'postgres', host: '127.0.0.1', port: 5432, database: 'app', username: 'me', password: 'hunter2' })
    expect(saved).toMatchObject({ name: 'Local', hasPassword: true, readOnly: true, environment: 'local' })
    expect(JSON.stringify(saved)).not.toContain('hunter2')
    const row = db.prepare('SELECT payload, encrypted FROM secure_credentials WHERE provider = ?').get(`oxequery:${saved.id}`) as { payload: Buffer; encrypted: number }
    expect(row.encrypted).toBe(1)
    expect(row.payload.toString()).not.toContain('hunter2')
    expect(JSON.stringify(db.prepare('SELECT * FROM oxequery_connections').all())).not.toContain('hunter2')
    expect(store.resolve(saved.id).password).toBe('hunter2')
  })

  it('keeps the password on edit, replaces it on request and removes it on clear', () => {
    const { db } = fixture()
    const store = new ConnectionStore(db, cipher())
    const created = store.save({ name: 'A', engine: 'mongodb', host: 'db', port: 27017, password: 'one' })
    store.save({ id: created.id, name: 'A2', engine: 'mongodb', host: 'db', port: 27017 })
    expect(store.resolve(created.id).password).toBe('one')
    store.save({ id: created.id, name: 'A2', engine: 'mongodb', host: 'db', port: 27017, password: 'two' })
    expect(store.resolve(created.id).password).toBe('two')
    expect(store.save({ id: created.id, name: 'A2', engine: 'mongodb', host: 'db', port: 27017, clearPassword: true }).hasPassword).toBe(false)
    expect(db.prepare('SELECT 1 FROM secure_credentials WHERE provider = ?').get(`oxequery:${created.id}`)).toBeUndefined()
  })

  it('refuses to save a password when the OS cannot encrypt it', () => {
    const { db } = fixture()
    const store = new ConnectionStore(db, cipher(false))
    expect(() => store.save({ name: 'X', engine: 'postgres', host: 'h', port: 5432, password: 'p' })).toThrow(/Secure storage/)
    expect(store.list()).toEqual([])
    expect(store.save({ name: 'No password', engine: 'postgres', host: 'h', port: 5432 }).hasPassword).toBe(false)
  })

  it('removes the secret together with the connection', () => {
    const { db } = fixture()
    const store = new ConnectionStore(db, cipher())
    const saved = store.save({ name: 'Tmp', engine: 'postgres', host: 'h', port: 5432, password: 'p' })
    store.delete(saved.id)
    expect(store.list()).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM secure_credentials WHERE provider LIKE ?').get('oxequery:%')).toEqual({ n: 0 })
  })

  it('validates hosts, ports and enums', () => {
    const base = { name: 'n', engine: 'postgres' as const, host: 'h', port: 5432 }
    expect(() => normalizeConnectionInput({ ...base, host: 'a b' })).toThrow(/host/)
    expect(() => normalizeConnectionInput({ ...base, host: 'user@host' })).toThrow(/host/)
    expect(() => normalizeConnectionInput({ ...base, port: 0 })).toThrow(/port/)
    expect(() => normalizeConnectionInput({ ...base, port: 70000 })).toThrow(/port/)
    expect(() => normalizeConnectionInput({ ...base, engine: 'mysql' as never })).toThrow(/PostgreSQL or MongoDB/)
    expect(() => normalizeConnectionInput({ ...base, name: '  ' })).toThrow(/name/)
    expect(() => normalizeConnectionInput({ ...base, containerRef: '--rm' })).toThrow(/container/)
    expect(normalizeConnectionInput(base)).toMatchObject({ readOnly: true, environment: 'local', sslMode: 'disable' })
  })
})

describe('OxeQuery service', () => {
  it('creates a connection from a container and keeps its password out of the result', async () => {
    const { service, db } = fixture()
    const response = await service.call('connections.fromContainer', { id: 'pg-dev' })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.value).toMatchObject({ engine: 'postgres', host: '127.0.0.1', port: 55432, database: 'shop', username: 'app', hasPassword: true, containerRef: 'pg-dev', readOnly: true })
    expect(JSON.stringify(response)).not.toContain('s3cret-pw')
    expect(service.connections.resolve(response.value.id).password).toBe('s3cret-pw')
    expect(db.prepare('SELECT COUNT(*) AS n FROM oxequery_connections').get()).toEqual({ n: 1 })
  })

  it('explains an unpublished database port instead of guessing an address', async () => {
    const inspect = pgInspect.replace('"5432/tcp":[{"HostIp":"0.0.0.0","HostPort":"55432"}]', '"5432/tcp":null')
    const { service } = fixture({ inspect })
    const response = await service.call('connections.fromContainer', { id: 'pg-dev' })
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.message).toMatch(/publish/i)
  })

  it('routes database operations to the worker with the resolved connection and refuses the wrong engine', async () => {
    const { service, worker } = fixture()
    const pg = service.connections.save({ name: 'pg', engine: 'postgres', host: 'h', port: 5432, password: 'pw' })
    const mongo = service.connections.save({ name: 'mg', engine: 'mongodb', host: 'h', port: 27017 })
    await service.call('sql.run', { connectionId: pg.id, sql: 'SELECT 1', maxRows: 10 })
    expect(worker.call).toHaveBeenCalledWith('sql.run', expect.objectContaining({ id: pg.id, password: 'pw', readOnly: true }), { sql: 'SELECT 1', maxRows: 10, confirmed: false, paged: false })
    const wrong = await service.call('sql.run', { connectionId: mongo.id, sql: 'SELECT 1' })
    expect(wrong.ok).toBe(false)
    const wrongMongo = await service.call('mongo.find', { connectionId: pg.id, database: 'd', collection: 'c' })
    expect(wrongMongo.ok).toBe(false)
    expect(worker.call).toHaveBeenCalledTimes(1)
  })

  it('carries a worker error code and its reasons to the caller', async () => {
    const { service, worker } = fixture()
    const pg = service.connections.save({ name: 'pg', engine: 'postgres', host: 'h', port: 5432 })
    worker.call.mockRejectedValueOnce(new OxeQueryError('confirm', 'needs confirmation', ['DELETE without WHERE']))
    const response = await service.call('sql.run', { connectionId: pg.id, sql: 'DELETE FROM t' })
    expect(response).toEqual({ ok: false, error: { code: 'confirm', message: 'needs confirmation', reasons: ['DELETE without WHERE'] } })
  })

  it('classifies SQL without a database round trip', async () => {
    const { service, worker } = fixture()
    const response = await service.call('sql.check', { connectionId: 'ignored', sql: 'DROP TABLE users' })
    expect(response).toMatchObject({ ok: true, value: { kind: 'destructive' } })
    expect(worker.call).not.toHaveBeenCalled()
  })

  it('rejects an unknown operation, a container operation (now OxePod\'s) and a malformed request', async () => {
    const { service, calls } = fixture()
    expect((await service.call('nope' as never, {})).ok).toBe(false)
    for (const op of ['containers.list', 'containers.action', 'resources.prune', 'containers.createDatabase']) {
      await expect(service.call(op as never, { id: 'pg-dev', action: 'stop', kind: 'containers', confirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'invalid', message: 'Unknown OxeQuery operation.' } })
    }
    expect(calls).toEqual([])
    expect((await service.call('connections.list', 'text' as never)).ok).toBe(false)
  })

  it('makes a database container through OxePod and saves it as a connection without returning the password', async () => {
    const { service, pod } = fixture()
    const createDatabase = vi.spyOn(pod.containers, 'createDatabase').mockResolvedValue({ containerId: 'c'.repeat(64), port: 55433, password: 'generated-pw', username: 'oxe', database: 'app' })
    const response = await service.call('connections.createInContainer', { engine: 'postgres', name: 'shop-db', tag: '17' })
    expect(createDatabase).toHaveBeenCalledWith({ engine: 'postgres', name: 'shop-db', tag: '17' }, undefined)
    expect(response).toMatchObject({ ok: true, value: { name: 'shop-db', engine: 'postgres', port: 55433, containerRef: 'shop-db', hasPassword: true } })
    expect(JSON.stringify(response)).not.toContain('generated-pw')
    if (response.ok) expect(service.connections.resolve(response.value.id).password).toBe('generated-pw')
    await expect(service.call('connections.createInContainer', { engine: 'mysql' as never, name: 'x', tag: '1' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(service.call('connections.createInContainer', { engine: 'postgres', name: 'x', tag: '1', engineName: 'lxc' as never })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(createDatabase).toHaveBeenCalledTimes(1)
  })

  it('refuses a container connection when OxePod is not there, and loads OxePod only when one is asked for', async () => {
    const db = openInMemoryDatabase(); databases.push(db)
    const worker = { call: vi.fn(), close: vi.fn(async () => undefined) }
    const lone = new OxeQueryService({ db, worker, cipher: cipher(), emit: () => undefined })
    await expect(lone.call('connections.fromContainer', { id: 'pg-dev' })).resolves.toMatchObject({ ok: false, error: { code: 'failed', message: 'OxePod is not available here.' } })
    const load = vi.fn(async () => { throw new Error('not loaded') })
    const lazy = new OxeQueryService({ db, worker, cipher: cipher(), emit: () => undefined, pod: load })
    await lazy.call('connections.list', {})
    expect(load).not.toHaveBeenCalled()
    await expect(lazy.call('connections.fromContainer', { id: 'pg-dev' })).resolves.toMatchObject({ ok: false, error: { message: 'not loaded' } })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('closes the worker session when a connection is edited or deleted', async () => {
    const { service, worker } = fixture()
    const saved = service.connections.save({ name: 'pg', engine: 'postgres', host: 'h', port: 5432 })
    await service.call('connections.save', { id: saved.id, name: 'pg2', engine: 'postgres', host: 'h', port: 5432 })
    await service.call('connections.delete', { id: saved.id })
    expect(worker.call.mock.calls.filter(call => call[0] === 'close')).toHaveLength(2)
  })
})

describe('private keys', () => {
  it('explains how to convert a PuTTY key instead of failing later', async () => {
    const { assertPem } = await import('../../electron/main/services/oxequery/picked-files')
    expect(() => assertPem('PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none', 'The SSH key')).toThrow(/puttygen/)
    expect(() => assertPem('hello', 'The SSH key')).toThrow(/not a PEM/)
  })
})
