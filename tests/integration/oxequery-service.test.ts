import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import type { ExecOptions, ExecResult, ExecutionHost } from '../../electron/main/runtime/execution-host'
import { ConnectionStore, normalizeConnectionInput, type SecretCipher } from '../../electron/main/services/oxequery/connection-store'
import { OxeQueryService } from '../../electron/main/services/oxequery/service'
import { OxeQueryError, type ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'
import type { OxeQueryEvent } from '../../shared/types/oxequery'

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
  const service = new OxeQueryService({ db, host, worker, cipher: cipher(options.cipherAvailable ?? true), emit: event => events.push(event) })
  return { db, host, worker, service, events, calls }
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
  it('lists containers through the CLI with an argv, never a shell string', async () => {
    const { service, calls } = fixture()
    const response = await service.call('containers.list', {})
    expect(response).toMatchObject({ ok: true, value: { engine: 'docker', containers: [{ name: 'pg-dev', state: 'running' }] } })
    const ps = calls.find(call => call.args[0] === 'ps')!
    expect(ps.command).toBe('docker')
    expect(ps.args).toEqual(['ps', '--all', '--no-trunc', '--format', '{{json .}}'])
  })

  it('reports an unusable engine with a message a person can act on', async () => {
    const db = openInMemoryDatabase(); databases.push(db)
    const host: ExecutionHost = { id: 'x', kind: 'local', exec: async () => ({ code: -1, stdout: '', stderr: 'spawn ENOENT', timedOut: false }), readTextFile: vi.fn(), writeTextFile: vi.fn() }
    const service = new OxeQueryService({ db, host, cipher: cipher(), emit: () => undefined, worker: { call: vi.fn(), close: vi.fn() } })
    const response = await service.call('containers.list', {})
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toMatchObject({ code: 'engine-missing' })
  })

  it('rejects hostile container identifiers and exec arguments before running anything', async () => {
    const { service, calls } = fixture()
    for (const id of ['--privileged', 'a;b', '$(id)', '../x', '']) {
      const response = await service.call('containers.inspect', { id })
      expect(response.ok).toBe(false)
    }
    const exec = await service.call('containers.exec', { id: 'pg-dev', argv: [] })
    expect(exec.ok).toBe(false)
    expect(calls.some(call => call.args[0] === 'inspect' || call.args[0] === 'exec')).toBe(false)
  })

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

  it('registers a shell only for a validated container and returns an opaque pane id', async () => {
    const { service } = fixture()
    const response = await service.call('containers.shell', { id: 'pg-dev', shell: 'bash' })
    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(service.shellFor(response.value.paneId)).toEqual({ file: 'docker', args: ['exec', '-it', 'pg-dev', 'bash'] })
    expect(service.shellFor('oxequery-shell:not-registered')).toBeUndefined()
    expect((await service.call('containers.shell', { id: '--rm' })).ok).toBe(false)
  })

  it('rejects an unknown operation and a malformed request', async () => {
    const { service } = fixture()
    expect((await service.call('nope' as never, {})).ok).toBe(false)
    expect((await service.call('containers.list', 'text' as never)).ok).toBe(false)
  })

  it('closes the worker session when a connection is edited or deleted', async () => {
    const { service, worker } = fixture()
    const saved = service.connections.save({ name: 'pg', engine: 'postgres', host: 'h', port: 5432 })
    await service.call('connections.save', { id: saved.id, name: 'pg2', engine: 'postgres', host: 'h', port: 5432 })
    await service.call('connections.delete', { id: saved.id })
    expect(worker.call.mock.calls.filter(call => call[0] === 'close')).toHaveLength(2)
  })
})

describe('destructive resource operations', () => {
  it('removes a volume only when the request carries the confirmation', async () => {
    const { service, calls } = fixture()
    await expect(service.call('resources.remove', { kind: 'volume', id: 'pgdata' })).resolves.toMatchObject({ ok: false, error: { code: 'confirm' } })
    expect(calls.some(call => call.args[0] === 'volume' && call.args[1] === 'rm')).toBe(false)
    await expect(service.call('resources.remove', { kind: 'volume', id: 'pgdata', confirmed: true })).resolves.toMatchObject({ ok: true })
    expect(calls.some(call => call.args[0] === 'volume' && call.args.includes('rm'))).toBe(true)
  })

  it('removes a container only when the request carries the confirmation, and keeps its volumes', async () => {
    const { service, calls, events } = fixture()
    const id = 'a'.repeat(64)
    await expect(service.call('containers.remove', { id })).resolves.toMatchObject({ ok: false, error: { code: 'confirm' } })
    expect(calls.some(call => call.args.includes('rm'))).toBe(false)
    await expect(service.call('containers.remove', { id, confirmed: true })).resolves.toEqual({ ok: true, value: { ok: true } })
    const removal = calls.find(call => call.args.includes('rm'))
    expect(removal?.args.slice(-3)).toEqual(['rm', '--force', id])
    expect(removal?.args).not.toContain('--volumes')
    expect(events).toContainEqual({ type: 'containers-changed' })
    await expect(service.call('containers.remove', { id: 'x; rm -rf /', confirmed: true })).resolves.toMatchObject({ ok: false })
  })

  it('cleans up stopped containers or dangling images only when confirmed, and nothing else', async () => {
    const { service, calls } = fixture()
    for (const kind of ['containers', 'images'] as const) {
      await expect(service.call('resources.prune', { kind })).resolves.toMatchObject({ ok: false, error: { code: 'confirm' } })
      expect(calls.some(call => call.args.includes('prune'))).toBe(false)
    }
    await expect(service.call('resources.prune', { kind: 'containers', confirmed: true })).resolves.toMatchObject({ ok: true })
    await expect(service.call('resources.prune', { kind: 'images', confirmed: true })).resolves.toMatchObject({ ok: true })
    expect(calls.filter(call => call.args.includes('prune')).map(call => call.args.slice(-3))).toEqual([['container', 'prune', '--force'], ['image', 'prune', '--force']])
    await expect(service.call('resources.prune', { kind: 'volumes', confirmed: true })).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
  })
})

describe('private keys', () => {
  it('explains how to convert a PuTTY key instead of failing later', async () => {
    const { assertPem } = await import('../../electron/main/services/oxequery/picked-files')
    expect(() => assertPem('PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none', 'The SSH key')).toThrow(/puttygen/)
    expect(() => assertPem('hello', 'The SSH key')).toThrow(/not a PEM/)
  })
})
