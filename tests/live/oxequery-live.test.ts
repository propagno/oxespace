/**
 * Live validation of OxeQuery against a real Docker daemon, a real PostgreSQL and
 * a real MongoDB. Skipped unless OXE_LIVE=1. It needs the built worker
 * (`npx electron-vite build`) because the worker bundle is part of what is tested.
 *
 *   OXE_LIVE=1 npm run test:electron -- tests/live/oxequery-live.test.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { LocalExecutionHost } from '../../electron/main/runtime/execution-host'
import { OxeQueryService } from '../../electron/main/services/oxequery/service'
import { OxeQueryWorkerClient } from '../../electron/main/services/oxequery/worker-client'
import type { OxeQueryEvent, OxeQueryOp, OxeQueryOps } from '../../shared/types/oxequery'

/** The server versions under test; CI runs the suite against several (OXE_LIVE_PG_IMAGE / OXE_LIVE_MONGO_IMAGE). */
const PG_IMAGE = process.env.OXE_LIVE_PG_IMAGE ?? 'docker.io/library/postgres:16-alpine'
const MONGO_IMAGE = process.env.OXE_LIVE_MONGO_IMAGE ?? 'docker.io/library/mongo:7'

const live = process.env.OXE_LIVE === '1'
const suffix = Math.random().toString(36).slice(2, 8)
const PG = `oxe-live-pg-${suffix}`, MONGO = `oxe-live-mongo-${suffix}`
const PG_PASSWORD = 'oxe-live-secret-pw', MONGO_PASSWORD = 'oxe-live-mongo-pw'
const workerPath = join(process.cwd(), 'out', 'main', 'oxequery-worker.js')

// The engine under test: Docker by default, Podman with OXE_CONTAINER_ENGINE=podman (CI runs both).
const ENGINE = process.env.OXE_CONTAINER_ENGINE === 'podman' ? 'podman' : 'docker'
const docker = (...args: string[]): string => {
  try { return execFileSync(ENGINE, args, { encoding: 'utf8' }).trim() } catch (error) {
    // A server that exits at start-up only says why in its own log.
    if ((args[0] === 'port' || args[0] === 'exec') && args[1]) {
      try { console.error(`[live] ${args[1]} log:\n${execFileSync(ENGINE, ['logs', '--tail', '40', args[1]], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })}`) } catch { /* container already gone */ }
    }
    throw error
  }
}

describe.skipIf(!live)('OxeQuery against real Docker, PostgreSQL and MongoDB', () => {
  const events: OxeQueryEvent[] = []
  let service: OxeQueryService
  let db: ReturnType<typeof openInMemoryDatabase>

  async function call<K extends OxeQueryOp>(op: K, input: OxeQueryOps[K]['input']): Promise<OxeQueryOps[K]['output']> {
    const response = await service.call(op, input)
    if (!response.ok) throw Object.assign(Error(`${op}: ${response.error.code}: ${response.error.message}`), { info: response.error })
    return response.value
  }
  async function failure<K extends OxeQueryOp>(op: K, input: OxeQueryOps[K]['input']) {
    const response = await service.call(op, input)
    if (response.ok) throw Error(`Expected ${op} to fail`)
    return response.error
  }
  let lastAnswer = ''
  const until = async (label: string, check: () => Promise<boolean> | boolean, timeoutMs = 90_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 1000)) }
    // What the engine says about its containers is the first thing anyone debugging this needs.
    const peek = (run: () => string): string => { try { return run() } catch (error) { return `(${error instanceof Error ? error.message.slice(0, 200) : 'failed'})` } }
    throw Error(`Timed out: ${label} (last answer: ${lastAnswer})
${peek(() => docker('ps', '-a', '--format', '{{.Names}} {{.Status}}'))}
${peek(() => docker('logs', '--tail', '15', PG))}`)
  }

  beforeAll(async () => {
    expect(existsSync(workerPath), 'run `npx electron-vite build` first').toBe(true)
    db = openInMemoryDatabase()
    service = new OxeQueryService({
      db, host: new LocalExecutionHost(), emit: event => events.push(event),
      cipher: { available: () => true, encrypt: value => Buffer.from(`enc:${value}`), decrypt: value => value.toString().replace(/^enc:/, '') },
      worker: new OxeQueryWorkerClient(workerPath), preferredEngine: () => ENGINE
    })
    docker('run', '-d', '--name', PG, '-e', 'POSTGRES_USER=oxe', '-e', 'POSTGRES_DB=appdb', '-e', `POSTGRES_PASSWORD=${PG_PASSWORD}`, '-p', '127.0.0.1::5432', PG_IMAGE)
    docker('run', '-d', '--name', MONGO, '-e', 'MONGO_INITDB_ROOT_USERNAME=root', '-e', `MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}`, '-p', '127.0.0.1::27017', MONGO_IMAGE)
    await until('postgres ready', async () => {
      const answer = await call('containers.exec', { id: PG, argv: ['pg_isready', '-U', 'oxe', '-d', 'appdb'] })
      lastAnswer = JSON.stringify(answer).slice(0, 400)
      return answer.exitCode === 0
    })
    await until('mongo ready', async () => (await call('containers.exec', { id: MONGO, argv: ['mongosh', '--quiet', '-u', 'root', '-p', MONGO_PASSWORD, '--authenticationDatabase', 'admin', '--eval', 'db.runCommand({ ping: 1 }).ok'] })).stdout.trim().endsWith('1'))
  }, 240_000)

  afterAll(async () => {
    await service?.dispose().catch(() => undefined)
    for (const name of [PG, MONGO]) { try { docker('rm', '-f', name) } catch { /* already gone */ } }
    db?.close()
  }, 60_000)

  it('the packaged worker answers and has both drivers', async () => {
    expect(await call('system.ping', {})).toMatchObject({ ok: true, drivers: { postgres: true, mongodb: true, ssh: true } })
  })

  it('lists the containers with their published ports and inspects one without exposing secrets', async () => {
    const engines = await call('containers.engines', {})
    expect(engines.find(engine => engine.engine === ENGINE)).toMatchObject({ available: true })
    const { engine, containers } = await call('containers.list', {})
    expect(engine).toBe(ENGINE)
    const pg = containers.find(container => container.name === PG)!
    expect(pg).toMatchObject({ state: 'running', image: expect.stringContaining(PG_IMAGE.replace("docker.io/library/", "")) })
    expect(pg.ports.some(port => port.containerPort === 5432 && port.hostPort)).toBe(true)
    const inspected = await call('containers.inspect', { id: PG })
    expect(inspected.envNames).toContain('POSTGRES_PASSWORD')
    expect(JSON.stringify(inspected)).not.toContain(PG_PASSWORD)
  })

  it('runs an allowed command in a container and refuses an argument that is not a container', async () => {
    const result = await call('containers.exec', { id: PG, argv: ['sh', '-c', 'echo oxe-$((6*7))'] })
    expect(result).toMatchObject({ exitCode: 0, timedOut: false })
    expect(result.stdout.trim()).toBe('oxe-42')
    expect((await failure('containers.exec', { id: '--privileged', argv: ['ls'] })).code).toBe('invalid')
  })

  it('stops, starts and restarts a container and reports the state change', async () => {
    await call('containers.action', { id: PG, action: 'stop' })
    // The listing can trail the stop on a busy runner; wait for it rather than read it once.
    await until('postgres listed as exited', async () => (await call('containers.list', {})).containers.find(container => container.name === PG)?.state === 'exited', 20_000)
    await call('containers.action', { id: PG, action: 'start' })
    await until('postgres back', async () => (await call('containers.exec', { id: PG, argv: ['pg_isready', '-U', 'oxe'] })).exitCode === 0)
    expect(events.some(event => event.type === 'containers-changed')).toBe(true)
  }, 120_000)

  it('streams container logs and stops the stream', async () => {
    const { streamId } = await call('containers.logsStart', { id: PG, tail: 20 })
    await until('log lines', () => events.some(event => event.type === 'container-log' && event.streamId === streamId && event.lines.length > 0), 20_000)
    await call('containers.logsStop', { streamId })
    await until('log end', () => events.some(event => event.type === 'container-log-end' && event.streamId === streamId), 10_000)
  })

  it('builds a Postgres connection from the container without returning its password', async () => {
    const connection = await call('connections.fromContainer', { id: PG })
    expect(connection).toMatchObject({ engine: 'postgres', host: '127.0.0.1', database: 'appdb', username: 'oxe', hasPassword: true, readOnly: true, containerRef: PG })
    expect(JSON.stringify(connection)).not.toContain(PG_PASSWORD)
    const stored = db.prepare('SELECT payload FROM secure_credentials WHERE provider = ?').get(`oxequery:${connection.id}`) as { payload: Buffer }
    expect(stored.payload.toString()).toContain('enc:')
    expect(await call('connections.test', { id: connection.id })).toMatchObject({ ok: true })
  })

  it('PostgreSQL: introspects, queries, pages, cancels and respects read-only', async () => {
    const [connection] = (await call('connections.list', {})).filter(item => item.engine === 'postgres')
    const id = connection.id
    // Writes need the connection to be writable first.
    expect((await failure('sql.run', { connectionId: id, sql: 'CREATE TABLE people (id serial primary key, name text, born date)' })).code).toBe('read-only')
    await call('connections.save', { ...connection, readOnly: false, password: undefined })
    await call('sql.run', { connectionId: id, sql: 'CREATE TABLE people (id serial primary key, name text not null, born date)' })
    await call('sql.run', { connectionId: id, sql: "INSERT INTO people (name, born) SELECT 'person ' || n, DATE '2000-01-01' + n FROM generate_series(1, 1200) n" })

    expect(await call('sql.schemas', { connectionId: id })).toContain('public')
    const { tables, total } = await call('sql.tables', { connectionId: id, schema: 'public' })
    expect(total).toBe(tables.length)
    expect(tables.find(table => table.name === 'people')).toMatchObject({ kind: 'table' })
    const details = await call('sql.table', { connectionId: id, schema: 'public', table: 'people' })
    expect(details.columns.map(column => column.name)).toEqual(['id', 'name', 'born'])
    expect(details.columns[0]).toMatchObject({ primaryKey: true, type: 'integer' })
    expect(details.columns[1]).toMatchObject({ nullable: false })
    expect(details.indexes.some(index => index.primary)).toBe(true)

    const result = await call('sql.run', { connectionId: id, sql: 'SELECT id, name, born FROM people ORDER BY id', maxRows: 100 })
    expect(result).toMatchObject({ rowCount: 100, truncated: true })
    expect(result.columns.map(column => column.type)).toEqual(['int4', 'text', 'date'])
    expect(result.rows[0][1]).toBe('person 1')

    const page = await call('sql.browse', { connectionId: id, schema: 'public', table: 'people', limit: 50, offset: 100, orderBy: { column: 'id', direction: 'desc' } })
    expect(page.rows).toHaveLength(50)
    expect(page.rows[0][0]).toBe(1100)
    // Identifiers cannot break out of their quoting.
    const hostile = await failure('sql.browse', { connectionId: id, schema: 'public', table: 'people"; DROP TABLE people; --', limit: 1 })
    expect(hostile.code).toBe('query')
    // Load more: the cursor stays open across requests, the tree reads the catalog meanwhile, and the rows continue in order.
    const first = await call('sql.run', { connectionId: id, sql: 'SELECT id FROM people ORDER BY id', maxRows: 500, paged: true })
    expect(first.pageId).toBeTruthy()
    expect((await call('sql.tables', { connectionId: id, schema: 'public' })).tables.some(table => table.name === 'people')).toBe(true)
    const second = await call('sql.more', { connectionId: id, pageId: first.pageId!, maxRows: 500 })
    expect([second.rows[0][0], second.rows[second.rows.length - 1][0]]).toEqual([501, 1000])
    const last = await call('sql.more', { connectionId: id, pageId: first.pageId!, maxRows: 500 })
    expect(last).toMatchObject({ rowCount: 200, truncated: false })
    expect(last.pageId).toBeUndefined()
    // Anything else run on the connection closes an open page.
    const again = await call('sql.run', { connectionId: id, sql: 'SELECT id FROM people ORDER BY id', maxRows: 500, paged: true })
    await call('sql.run', { connectionId: id, sql: 'SELECT 1' })
    expect((await failure('sql.more', { connectionId: id, pageId: again.pageId!, maxRows: 500 })).message).toMatch(/no longer open/)
    expect((await call('sql.run', { connectionId: id, sql: 'SELECT count(*)::int FROM people' })).rows[0][0]).toBe(1200)

    // A destructive statement needs explicit confirmation, then runs.
    const guarded = await failure('sql.run', { connectionId: id, sql: 'DELETE FROM people' })
    expect(guarded.code).toBe('confirm')
    expect(guarded.reasons?.[0]).toMatch(/WHERE/)
    expect((await call('sql.run', { connectionId: id, sql: 'DELETE FROM people WHERE id > 1000' })).affectedRows).toBe(200)

    // Cancel a long statement from a second request.
    const running = service.call('sql.run', { connectionId: id, sql: 'SELECT pg_sleep(30)' })
    await new Promise(resolve => setTimeout(resolve, 800))
    expect(await call('sql.cancel', { connectionId: id })).toEqual({ cancelled: true })
    const cancelled = await running
    expect(cancelled.ok).toBe(false)
    if (!cancelled.ok) expect(cancelled.error.code).toBe('cancelled')
    // The session is reusable afterwards.
    expect((await call('sql.run', { connectionId: id, sql: 'SELECT 1' })).rows[0][0]).toBe(1)

    // Back to read-only: even a function-hidden write is stopped by the server.
    await call('connections.save', { ...(await call('connections.list', {})).find(item => item.id === id)!, readOnly: true })
    const sneaky = await failure('sql.run', { connectionId: id, sql: "SELECT * FROM (SELECT 1) a; /* looks harmless */" }).catch(() => null)
    expect(sneaky).toBeNull()
    expect((await failure('sql.run', { connectionId: id, sql: 'UPDATE people SET name = $$x$$ WHERE id = 1' })).code).toBe('read-only')
  }, 120_000)

  it('PostgreSQL: a wrong password is reported without leaking it', async () => {
    const created = await call('connections.save', { name: 'bad', engine: 'postgres', host: '127.0.0.1', port: (await call('connections.list', {}))[0].port, database: 'appdb', username: 'oxe', password: 'definitely-wrong-pw' })
    const tested = await call('connections.test', { id: created.id })
    expect(tested.ok).toBe(false)
    expect(tested.message).not.toContain('definitely-wrong-pw')
  })

  it('MongoDB: connects from the container, lists, finds, aggregates and blocks unsafe input', async () => {
    const connection = await call('connections.fromContainer', { id: MONGO })
    expect(connection).toMatchObject({ engine: 'mongodb', username: 'root', hasPassword: true })
    const id = connection.id
    expect(await call('connections.test', { id })).toMatchObject({ ok: true })

    // Seed through the container's own shell, so no write path is needed in OxeQuery.
    const seed = await call('containers.exec', { id: MONGO, argv: ['mongosh', '--quiet', '-u', 'root', '-p', MONGO_PASSWORD, '--authenticationDatabase', 'admin', '--eval',
      'db = db.getSiblingDB("shop"); db.items.insertMany(Array.from({length: 120}, (_, i) => ({ sku: "sku-" + i, qty: i, tags: i % 2 ? ["odd"] : ["even"], added: new Date(0) })))'] })
    expect(seed.exitCode).toBe(0)

    expect((await call('mongo.databases', { connectionId: id })).map(database => database.name)).toContain('shop')
    expect((await call('mongo.collections', { connectionId: id, database: 'shop' })).map(item => item.name)).toContain('items')

    const found = await call('mongo.find', { connectionId: id, database: 'shop', collection: 'items', filter: '{ "qty": { "$gte": 100 } }', sort: '{ "qty": -1 }', limit: 5 })
    expect(found.documents).toHaveLength(5)
    expect(found.total).toBe(20)
    expect(JSON.parse(found.documents[0])).toMatchObject({ sku: 'sku-119', qty: 119 })
    expect(found.documents[0]).toContain('"_id":{"$oid"')

    const aggregated = await call('mongo.aggregate', { connectionId: id, database: 'shop', collection: 'items', pipeline: '[{ "$group": { "_id": { "$arrayElemAt": ["$tags", 0] }, "n": { "$sum": 1 } } }, { "$sort": { "_id": 1 } }]' })
    expect(aggregated.documents.map(text => JSON.parse(text))).toEqual([{ _id: 'even', n: 60 }, { _id: 'odd', n: 60 }])

    expect((await call('mongo.indexes', { connectionId: id, database: 'shop', collection: 'items' })).map(index => index.name)).toContain('_id_')

    expect((await failure('mongo.find', { connectionId: id, database: 'shop', collection: 'items', filter: '{ "$where": "sleep(5000)" }' })).code).toBe('invalid')
    expect((await failure('mongo.aggregate', { connectionId: id, database: 'shop', collection: 'items', pipeline: '[{ "$out": "copy" }]' })).message).toMatch(/read-only/)
    expect((await failure('mongo.find', { connectionId: id, database: 'shop', collection: 'items', filter: '{ broken' })).code).toBe('invalid')
    // A SQL operation on a MongoDB connection is refused, not forwarded.
    expect((await failure('sql.run', { connectionId: id, sql: 'SELECT 1' })).code).toBe('invalid')
  }, 120_000)

  it('opens an interactive shell registration only for a validated container', async () => {
    const { paneId } = await call('containers.shell', { id: PG })
    expect(paneId).toMatch(/^oxequery-shell:[0-9a-f-]{36}$/)
    expect(service.shellFor(paneId)).toEqual({ file: ENGINE, args: ['exec', '-it', PG, 'sh'] })
    expect(service.shellFor('oxequery-shell:00000000-0000-0000-0000-000000000000')).toBeUndefined()
    expect((await failure('containers.shell', { id: 'bad id; rm -rf /' })).code).toBe('invalid')
  })
})
