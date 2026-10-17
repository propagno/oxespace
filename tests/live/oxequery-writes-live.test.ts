/**
 * Live checks for OxeQuery writes against real servers: staged row edits with a
 * concurrent change, export → import round trips with a checksum, a cancelled
 * export, a dry run that leaves nothing behind, and Mongo document writes.
 * Skipped unless OXE_LIVE=1. Needs Docker.
 *
 *   OXE_LIVE=1 npm run test:electron -- tests/live/oxequery-writes-live.test.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OxeQueryCore } from '../../electron/main/services/oxequery/oxequery-core'
import type { ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'
import { AgentGateway, type GatewayDeps } from '../../electron/main/services/oxequery/agent-gateway'
import { ContainerRuntime } from '../../electron/main/services/oxequery/container-runtime'
import { LocalExecutionHost } from '../../electron/main/runtime/execution-host'
import { ApprovalBroker } from '../../electron/main/services/oxequery/approval-broker'
import { AuditLog } from '../../electron/main/services/oxequery/audit-log'
import { openInMemoryDatabase } from '../../electron/main/db'

/** The server versions under test; CI runs the suite against several (OXE_LIVE_PG_IMAGE / OXE_LIVE_MONGO_IMAGE). */
const PG_IMAGE = process.env.OXE_LIVE_PG_IMAGE ?? 'docker.io/library/postgres:16-alpine'
const MONGO_IMAGE = process.env.OXE_LIVE_MONGO_IMAGE ?? 'docker.io/library/mongo:7'

const live = process.env.OXE_LIVE === '1'
const suffix = Math.random().toString(36).slice(2, 8)
const PG = `oxe-writes-pg-${suffix}`
const MONGO = `oxe-writes-mongo-${suffix}`
const PASSWORD = 'oxe-writes-pw'

// The engine under test: Docker by default, Podman with OXE_CONTAINER_ENGINE=podman (CI runs both).
const ENGINE = process.env.OXE_CONTAINER_ENGINE === 'podman' ? 'podman' : 'docker'
const docker = (...args: string[]): string => execFileSync(ENGINE, args, { encoding: 'utf8' }).trim()
const hostPort = (name: string, inner: number): number => Number(docker('port', name, String(inner)).split('\n')[0].split(':').pop())
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
async function until(label: string, check: () => boolean | Promise<boolean>, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { try { if (await check()) return } catch { /* not yet */ } await sleep(1000) }
  throw Error(`Timed out: ${label}`)
}
const never = { cancelled: () => false, progress: () => undefined }

describe.skipIf(!live)('OxeQuery writes against real servers', () => {
  const core = new OxeQueryCore()
  const dir = mkdtempSync(join(tmpdir(), 'oxe-writes-'))
  let pg: ResolvedConnection
  let mongo: ResolvedConnection

  const scalar = async (sql: string): Promise<string> => String((await core.sqlRun(pg, sql)).rows[0][0])
  const exec = async (sql: string): Promise<void> => { await core.sqlRun(pg, sql, { confirmed: true }) }

  beforeAll(async () => {
    docker('run', '-d', '--name', PG, '-e', 'POSTGRES_USER=oxe', '-e', 'POSTGRES_DB=appdb', '-e', `POSTGRES_PASSWORD=${PASSWORD}`, '-p', '127.0.0.1::5432', PG_IMAGE)
    docker('run', '-d', '--name', MONGO, '-e', 'MONGO_INITDB_ROOT_USERNAME=root', '-e', `MONGO_INITDB_ROOT_PASSWORD=${PASSWORD}`, '-p', '127.0.0.1::27017', MONGO_IMAGE)
    await until('postgres ready', () => docker('exec', PG, 'pg_isready', '-U', 'oxe', '-d', 'appdb').includes('accepting'))
    pg = { id: 'pg', engine: 'postgres', host: '127.0.0.1', port: hostPort(PG, 5432), database: 'appdb', username: 'oxe', password: PASSWORD, sslMode: 'disable', readOnly: false }
    await until('postgres accepts queries', async () => { await exec('SELECT 1'); return true })
    mongo = { id: 'mongo', engine: 'mongodb', host: '127.0.0.1', port: hostPort(MONGO, 27017), database: 'admin', username: 'root', password: PASSWORD, sslMode: 'disable', readOnly: false }
    await until('mongo accepts commands', async () => { await core.mongoFind(mongo, { connectionId: 'mongo', database: 'admin', collection: 'system.version', limit: 1 }); return true })
  }, 240_000)

  afterAll(async () => {
    await core.closeAll()
    for (const name of [PG, MONGO]) { try { docker('rm', '-f', name) } catch { /* gone */ } }
    rmSync(dir, { recursive: true, force: true })
  })

  it('edits rows in one transaction and refuses a stale change without saving anything', async () => {
    await exec('CREATE TABLE people (id serial PRIMARY KEY, name text NOT NULL, age int)')
    await exec(`INSERT INTO people (name, age) VALUES ('Ana', 30), ('Bruno', 40)`)
    const ok = await core.sqlApply(pg, { schema: 'public', table: 'people', changes: [
      { kind: 'update', key: { id: 1 }, set: { age: 31 }, old: { age: 30 } },
      { kind: 'insert', values: { name: 'Caio', age: null } },
      { kind: 'delete', key: { id: 2 }, old: { name: 'Bruno', age: 40 } }
    ] })
    expect(ok.applied).toBe(3)
    expect(await scalar(`SELECT string_agg(name || ':' || coalesce(age::text, '-'), ',' ORDER BY id) FROM people`)).toBe('Ana:31,Caio:-')

    // Someone else changes Ana between "read" and "apply".
    await exec(`UPDATE people SET age = 99 WHERE id = 1`)
    await expect(core.sqlApply(pg, { schema: 'public', table: 'people', changes: [
      { kind: 'insert', values: { name: 'Dora', age: 1 } },
      { kind: 'update', key: { id: 1 }, set: { age: 32 }, old: { age: 31 } }
    ] })).rejects.toMatchObject({ code: 'conflict' })
    // The insert before the stale update was rolled back too.
    expect(await scalar(`SELECT count(*) FROM people WHERE name = 'Dora'`)).toBe('0')
    expect(await scalar(`SELECT age FROM people WHERE id = 1`)).toBe('99')
  })

  it('does not treat a hostile value or identifier as SQL', async () => {
    await core.sqlApply(pg, { schema: 'public', table: 'people', changes: [{ kind: 'insert', values: { name: `x'); DROP TABLE people; --`, age: 1 } }] })
    expect(await scalar(`SELECT count(*) FROM people WHERE name LIKE 'x%DROP%'`)).toBe('1')
    await expect(core.sqlApply(pg, { schema: 'public', table: 'people"; DROP TABLE people; --', changes: [{ kind: 'insert', values: { name: 'a' } }] })).rejects.toBeDefined()
    expect(await scalar(`SELECT count(*) FROM people`)).not.toBe('0')
  })

  it('round-trips 100 000 rows through CSV and NDJSON with the same checksum', async () => {
    await exec(`CREATE TABLE big AS SELECT g AS id, 'name ' || g || ', "quoted"' AS label, (g % 7 = 0) AS flag,
      CASE WHEN g % 11 = 0 THEN NULL ELSE (g * 1.5)::numeric(12,2) END AS amount, ('2024-01-01'::timestamptz + (g || ' minutes')::interval) AS at FROM generate_series(1, 100000) g`)
    await exec('ALTER TABLE big ADD PRIMARY KEY (id)')
    const checksum = (table: string): Promise<string> => scalar(`SELECT md5(string_agg(concat_ws('|', id, label, flag, amount, at), ';' ORDER BY id)) FROM ${table}`)
    const original = await checksum('big')

    for (const [format, extension, importFormat] of [['csv', 'csv', 'csv'], ['ndjson', 'ndjson', 'ndjson']] as const) {
      const path = join(dir, `big.${extension}`)
      const exported = await core.exportRun(pg, { source: { kind: 'table', schema: 'public', table: 'big' }, format, path }, never)
      expect(exported).toMatchObject({ rows: 100000, cancelled: false })
      const copy = `big_${format}`
      await exec(`CREATE TABLE ${copy} (LIKE big INCLUDING ALL)`)
      const imported = await core.importRun(pg, {
        path, format: importFormat, target: { kind: 'table', schema: 'public', table: copy },
        mapping: { id: 'id', label: 'label', flag: 'flag', amount: 'amount', at: 'at' }
      }, never)
      expect(imported).toMatchObject({ inserted: 100000, rejected: 0, cancelled: false })
      expect(await checksum(copy)).toBe(original)
    }
  }, 240_000)

  it('removes the partial file when an export is cancelled', async () => {
    const path = join(dir, 'cancelled.csv')
    let batches = 0
    const outcome = await core.exportRun(pg, { source: { kind: 'sql', sql: 'SELECT g, repeat(\'x\', 100) FROM generate_series(1, 3000000) g' }, format: 'csv', path },
      { cancelled: () => ++batches > 3, progress: () => undefined })
    expect(outcome.cancelled).toBe(true)
    expect(outcome.rows).toBeLessThan(3000000)
    expect(existsSync(path)).toBe(false)
    // The connection is usable again.
    expect(await scalar('SELECT 1')).toBe('1')
  }, 120_000)

  it('refuses to overwrite an existing export file', async () => {
    const path = join(dir, 'exists.csv')
    writeFileSync(path, 'keep me')
    await expect(core.exportRun(pg, { source: { kind: 'sql', sql: 'SELECT 1' }, format: 'csv', path }, never)).rejects.toBeDefined()
    expect(readFileSync(path, 'utf8')).toBe('keep me')
  })

  it('dry run leaves nothing; a violating import is all-or-nothing; bad rows go to a rejects file', async () => {
    await exec('CREATE TABLE contacts (id int PRIMARY KEY, email text NOT NULL)')
    const good = join(dir, 'contacts.csv')
    writeFileSync(good, 'id,email\n1,a@example.com\n2,b@example.com\n3\n4,d@example.com\n')
    const dry = await core.importRun(pg, { path: good, format: 'csv', target: { kind: 'table', schema: 'public', table: 'contacts' }, mapping: { id: 'id', email: 'email' }, dryRun: true }, never)
    expect(dry).toMatchObject({ dryRun: true, inserted: 3, rejected: 1 })
    expect(await scalar('SELECT count(*) FROM contacts')).toBe('0')

    const real = await core.importRun(pg, { path: good, format: 'csv', target: { kind: 'table', schema: 'public', table: 'contacts' }, mapping: { id: 'id', email: 'email' } }, never)
    expect(real).toMatchObject({ inserted: 3, rejected: 1 })
    expect(real.rejectsPath && readFileSync(real.rejectsPath, 'utf8')).toContain('Expected 2 fields')

    const clash = join(dir, 'clash.csv')
    writeFileSync(clash, 'id,email\n10,x@example.com\n1,dup@example.com\n')
    await expect(core.importRun(pg, { path: clash, format: 'csv', target: { kind: 'table', schema: 'public', table: 'contacts' }, mapping: { id: 'id', email: 'email' } }, never)).rejects.toMatchObject({ code: 'query' })
    expect(await scalar('SELECT count(*) FROM contacts WHERE id = 10')).toBe('0')
  })

  it('imports a semicolon file in Windows-1252 without a header, and merges rows by key', async () => {
    await exec('CREATE TABLE people_sync (id int PRIMARY KEY, name text NOT NULL, city text)')
    await exec(`INSERT INTO people_sync VALUES (1, 'Ana', 'Lisboa'), (2, 'Bruno', 'Porto')`)
    const target = { kind: 'table' as const, schema: 'public', table: 'people_sync' }
    const file = join(dir, 'pessoas.csv')
    // "João" and "São Paulo" in Windows-1252 (one byte per accent), semicolons, no header row.
    writeFileSync(file, Buffer.concat([Buffer.from('2;Bruno;Faro\n3;', 'latin1'), Buffer.from('Jo\xe3o;S\xe3o Paulo\n', 'latin1'), Buffer.from('1;Ana;Lisboa\n', 'latin1')]))
    const options = { delimiter: ';' as const, hasHeader: false, encoding: 'windows-1252' as const }
    const preview = await core.importPreview(pg, { path: file, format: 'csv', target, options })
    expect(preview.fields).toEqual(['column_1', 'column_2', 'column_3'])
    expect(preview.sample[1]).toEqual(['3', 'João', 'São Paulo'])
    expect(preview.detected).toEqual({ delimiter: ';', encoding: 'windows-1252' })
    const mapping = { column_1: 'id', column_2: 'name', column_3: 'city' }

    // The default refuses a row whose key exists, and keeps nothing.
    await expect(core.importRun(pg, { path: file, format: 'csv', target, mapping, options }, never)).rejects.toMatchObject({ code: 'query' })
    expect(await scalar('SELECT count(*) FROM people_sync')).toBe('2')
    // Skip leaves the existing rows alone and adds the new one.
    const skipped = await core.importRun(pg, { path: file, format: 'csv', target, mapping, options, conflict: { mode: 'skip', columns: ['id'] } }, never)
    expect(skipped).toMatchObject({ inserted: 1, skipped: 2 })
    expect(await scalar('SELECT city FROM people_sync WHERE id = 2')).toBe('Porto')
    expect(await scalar('SELECT name FROM people_sync WHERE id = 3')).toBe('João')
    // Update changes the rows that exist and reports each kind.
    await exec('DELETE FROM people_sync WHERE id = 3')
    const merged = await core.importRun(pg, { path: file, format: 'csv', target, mapping, options, conflict: { mode: 'update', columns: ['id'] } }, never)
    expect(merged).toMatchObject({ inserted: 1, updated: 2 })
    expect(await scalar('SELECT city FROM people_sync WHERE id = 2')).toBe('Faro')
    // An update needs its key, and the key must be a mapped column.
    await expect(core.importRun(pg, { path: file, format: 'csv', target, mapping, options, conflict: { mode: 'update', columns: [] } }, never)).rejects.toMatchObject({ code: 'invalid' })
    await expect(core.importRun(pg, { path: file, format: 'csv', target, mapping: { column_2: 'name' }, options, conflict: { mode: 'update', columns: ['id'] } }, never)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('exports a table and a query as an Excel workbook, refusing to overwrite', async () => {
    const path = join(dir, 'people.xlsx')
    const result = await core.exportRun(pg, { path, format: 'xlsx', source: { kind: 'table', schema: 'public', table: 'people_sync' } }, never)
    expect(result.rows).toBe(3)
    const zip = readFileSync(path)
    expect(zip.subarray(0, 2).toString()).toBe('PK')
    expect(zip.includes(Buffer.from('xl/worksheets/sheet1.xml'))).toBe(true)
    await expect(core.exportRun(pg, { path, format: 'xlsx', source: { kind: 'sql', sql: 'SELECT 1' } }, never)).rejects.toThrow()
    expect(readFileSync(path).equals(zip)).toBe(true)
  })

  it('explains a statement and rolls back an analyzed write', async () => {
    const estimated = await core.sqlExplain(pg, { sql: 'SELECT * FROM big WHERE id = 5' })
    expect(estimated.analyze).toBe(false)
    expect(estimated.plan.nodeType).toMatch(/Scan/)
    const before = await scalar('SELECT count(*) FROM contacts')
    const analyzed = await core.sqlExplain(pg, { sql: 'DELETE FROM contacts', analyze: true })
    expect(analyzed.analyze).toBe(true)
    expect(analyzed.executionMs).toBeGreaterThanOrEqual(0)
    expect(await scalar('SELECT count(*) FROM contacts')).toBe(before)
    await expect(core.sqlExplain({ ...pg, readOnly: true }, { sql: 'DELETE FROM contacts', analyze: true })).rejects.toMatchObject({ code: 'read-only' })
    await expect(core.sqlExplain(pg, { sql: 'SELECT 1; SELECT 2' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(core.sqlExplain(pg, { sql: 'EXPLAIN SELECT 1' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('reports where a statement failed and its SQLSTATE', async () => {
    const sql = 'SELECT id, nope FROM people'
    const error = await core.sqlRun(pg, sql).catch(cause => cause as { code: string; detail: { position?: number; sqlState?: string } })
    expect(error).toMatchObject({ code: 'query', detail: { sqlState: '42703' } })
    expect(sql.slice((error as { detail: { position: number } }).detail.position - 1, (error as { detail: { position: number } }).detail.position + 3)).toBe('nope')
  })

  it('runs a script statement by statement, binds parameters, filters a table and keeps a transaction open', async () => {
    await exec('CREATE TABLE ledger (id serial primary key, who text, amount numeric, note text)')
    const script = await core.sqlScript(pg, "INSERT INTO ledger (who, amount, note) VALUES ('ana', 10, 'first; one'), ('bo', 25.5, NULL); SELECT count(*) FROM ledger; SELECT * FROM missing_table; SELECT 'never runs'")
    expect(script.statements.map(entry => entry.error ? 'error' : entry.result?.command)).toEqual(['INSERT', 'SELECT', 'error'])
    expect(script.stoppedAt).toBe(2)
    expect(script.statements[1].result?.rows[0][0]).toBe('2')
    expect(script.statements[2].error).toMatchObject({ code: 'query', sqlState: '42P01' })
    // The statements before the failure stay done: each one ran on its own.
    expect(await scalar('SELECT count(*) FROM ledger')).toBe('2')

    const bound = await core.sqlRun(pg, 'SELECT who FROM ledger WHERE amount > $1 AND note IS NOT DISTINCT FROM $2', { params: ['20', null] })
    expect(bound.rows).toEqual([['bo']])
    await expect(core.sqlRun(pg, 'SELECT $1; SELECT $1', { params: ['a'] })).rejects.toMatchObject({ code: 'invalid' })

    const page = await core.sqlBrowse(pg, { connectionId: 'pg', schema: 'public', table: 'ledger', filters: [{ column: 'who', op: 'contains', value: 'A' }, { column: 'amount', op: 'gte', value: '1' }] })
    expect(page.rows.map(row => row[1])).toEqual(['ana'])
    expect(page.totalRows).toBe(1)
    const listed = await core.sqlBrowse(pg, { connectionId: 'pg', schema: 'public', table: 'ledger', filters: [{ column: 'who', op: 'in', value: 'ana, bo, nobody' }], orderBy: { column: 'id', direction: 'desc' } })
    expect(listed.rows.map(row => row[1])).toEqual(['bo', 'ana'])
    await expect(core.sqlBrowse(pg, { connectionId: 'pg', schema: 'public', table: 'ledger', filters: [{ column: 'amount', op: 'eq', value: 'not a number' }] })).rejects.toMatchObject({ code: 'query' })

    expect(core.txState(pg)).toMatchObject({ state: 'none' })
    expect(await core.sqlTx(pg, 'begin')).toMatchObject({ state: 'open' })
    await core.sqlRun(pg, "INSERT INTO ledger (who, amount) VALUES ('cy', 1)")
    expect(core.txState(pg)).toMatchObject({ state: 'open', statements: 1 })
    expect(await scalar('SELECT count(*) FROM ledger')).toBe('3')
    expect(await core.sqlTx(pg, 'rollback')).toMatchObject({ state: 'none' })
    expect(await scalar('SELECT count(*) FROM ledger')).toBe('2')

    await core.sqlTx(pg, 'begin')
    await core.sqlRun(pg, "INSERT INTO ledger (who, amount) VALUES ('di', 2)")
    await expect(core.sqlRun(pg, 'SELECT * FROM nope')).rejects.toMatchObject({ code: 'query' })
    expect(core.txState(pg)).toMatchObject({ state: 'failed' })
    await expect(core.sqlRun(pg, 'SELECT 1')).rejects.toThrow(/Roll it back/)
    await core.sqlTx(pg, 'rollback')
    expect(await scalar('SELECT count(*) FROM ledger')).toBe('2')

    await core.sqlTx(pg, 'begin')
    await core.sqlRun(pg, "INSERT INTO ledger (who, amount) VALUES ('ed', 3)")
    await core.sqlRun(pg, 'COMMIT')
    expect(core.txState(pg)).toMatchObject({ state: 'none' })
    expect(await scalar('SELECT count(*) FROM ledger')).toBe('3')
  })

  it('changes and deletes many MongoDB documents only after counting, and manages collections, validation and plans', async () => {
    const db = 'bulkdb'
    const target = { connectionId: 'mongo', database: db, collection: 'orders' }
    await core.mongoCollectionAction(mongo, { database: db, collection: 'orders', action: { kind: 'create' } })
    for (let index = 1; index <= 30; index++) await core.mongoWrite(mongo, { ...target, op: 'insert', document: JSON.stringify({ _id: index, status: index <= 20 ? 'open' : 'done', qty: index }) })

    // A dry run counts and writes nothing; the real run needs the number that was shown.
    expect(await core.mongoBulk(mongo, { ...target, op: 'updateMany', filter: '{"status":"open"}', update: '{"$set":{"status":"late"}}', dryRun: true })).toEqual({ matched: 20, modified: 0, deleted: 0, dryRun: true })
    await expect(core.mongoBulk(mongo, { ...target, op: 'updateMany', filter: '{"status":"open"}', update: '{"$set":{"status":"late"}}' })).rejects.toMatchObject({ code: 'confirm' })
    await expect(core.mongoBulk(mongo, { ...target, op: 'updateMany', filter: '{"status":"open"}', update: '{"$set":{"status":"late"}}', confirmed: true, expectedCount: 19 })).rejects.toMatchObject({ code: 'conflict' })
    expect((await core.mongoFind(mongo, { ...target, filter: '{"status":"late"}' })).total).toBe(0)
    expect(await core.mongoBulk(mongo, { ...target, op: 'updateMany', filter: '{"status":"open"}', update: '{"$set":{"status":"late"}}', confirmed: true, expectedCount: 20 })).toMatchObject({ matched: 20, modified: 20 })
    // A replacement document would overwrite every match; only update operators are accepted.
    await expect(core.mongoBulk(mongo, { ...target, op: 'updateMany', filter: '{}', update: '{"status":"x"}', dryRun: true })).rejects.toThrow(/update operators/)
    await expect(core.mongoBulk(mongo, { ...target, op: 'updateMany', filter: '{"$where":"1"}', update: '{"$set":{"a":1}}', dryRun: true })).rejects.toThrow(/server-side code/)
    await expect(core.mongoBulk({ ...mongo, readOnly: true }, { ...target, op: 'deleteMany', filter: '{}', confirmed: true, expectedCount: 30 })).rejects.toMatchObject({ code: 'read-only' })
    await expect(core.mongoBulk(mongo, { ...target, op: 'deleteMany', filter: '{}', confirmed: true, expectedCount: 30 }).then(result => result.deleted)).resolves.toBe(30)
    expect((await core.mongoFind(mongo, target)).documents).toHaveLength(0)

    // Collections: create, rename, drop (the drop waits for confirmation).
    await core.mongoCollectionAction(mongo, { database: db, collection: 'capped_log', action: { kind: 'create', capped: true, sizeBytes: 4096, maxDocuments: 5 } })
    expect((await core.mongoStats(mongo, db, 'capped_log')).capped).toBe(true)
    await core.mongoCollectionAction(mongo, { database: db, collection: 'capped_log', action: { kind: 'rename', to: 'log2' } })
    expect((await core.mongoCollections(mongo, db)).map(item => item.name)).toEqual(expect.arrayContaining(['log2', 'orders']))
    await expect(core.mongoCollectionAction(mongo, { database: db, collection: 'log2', action: { kind: 'drop' } })).rejects.toMatchObject({ code: 'confirm' })
    await expect(core.mongoCollectionAction(mongo, { database: db, collection: 'a$b', action: { kind: 'create' } })).rejects.toMatchObject({ code: 'invalid' })
    await core.mongoCollectionAction(mongo, { database: db, collection: 'log2', action: { kind: 'drop' }, confirmed: true })
    expect((await core.mongoCollections(mongo, db)).map(item => item.name)).not.toContain('log2')

    // Validation: read, set a schema, see it refuse a bad document, clear it.
    expect(await core.mongoValidation(mongo, db, 'orders')).toEqual({ validator: null, level: 'strict', action: 'error' })
    const schema = '{"$jsonSchema":{"bsonType":"object","required":["qty"],"properties":{"qty":{"bsonType":"int"}}}}'
    await core.mongoSetValidation(mongo, { database: db, collection: 'orders', validator: schema, level: 'strict', action: 'error' })
    expect((await core.mongoValidation(mongo, db, 'orders')).validator).toContain('"required"')
    await expect(core.mongoWrite(mongo, { ...target, op: 'insert', document: '{"_id": 99, "qty": "many"}' })).rejects.toThrow(/validation/i)
    await core.mongoSetValidation(mongo, { database: db, collection: 'orders', validator: null, level: 'strict', action: 'error' })
    expect((await core.mongoValidation(mongo, db, 'orders')).validator).toBeNull()

    // Plans: a filter on an unindexed field scans; with an index it does not.
    for (let index = 1; index <= 200; index++) await core.mongoWrite(mongo, { ...target, op: 'insert', document: JSON.stringify({ _id: 1000 + index, sku: 's' + index, qty: index }) })
    const scan = await core.mongoExplain(mongo, { ...target, kind: 'find', filter: '{"sku":"s7"}' })
    expect(scan).toMatchObject({ stage: 'COLLSCAN', docsExamined: 200, returned: 1 })
    expect(scan.warnings.join(' ')).toMatch(/no index/)
    await core.mongoCreateIndex(mongo, { database: db, collection: 'orders', keys: '{"sku":1}' })
    const indexed = await core.mongoExplain(mongo, { ...target, kind: 'find', filter: '{"sku":"s7"}' })
    expect(indexed).toMatchObject({ stage: 'IXSCAN', index: 'sku_1', docsExamined: 1 })
    const aggregated = await core.mongoExplain(mongo, { ...target, kind: 'aggregate', pipeline: '[{"$match":{"sku":"s7"}},{"$group":{"_id":null,"n":{"$sum":1}}}]' })
    expect(['IXSCAN', 'COUNT_SCAN']).toContain(aggregated.stage)

    // Aggregate pages with $skip.
    const pageOne = await core.mongoAggregate(mongo, { ...target, pipeline: '[{"$sort":{"_id":1}}]', limit: 50 })
    const pageTwo = await core.mongoAggregate(mongo, { ...target, pipeline: '[{"$sort":{"_id":1}}]', limit: 50, skip: 50 })
    expect(pageOne.documents).toHaveLength(50)
    expect(pageOne.truncated).toBe(true)
    expect(JSON.parse(pageTwo.documents[0]!)._id).toBe(JSON.parse(pageOne.documents[49]!)._id + 1)
  })

  it('stops a long MongoDB query from the outside', async () => {
    const target = { connectionId: 'mongo', database: 'bulkdb', collection: 'orders' }
    // A self-join three levels deep: millions of intermediate documents, many seconds of work.
    const heavy = '[{"$lookup":{"from":"orders","pipeline":[{"$match":{}}],"as":"a"}},{"$unwind":"$a"},{"$lookup":{"from":"orders","pipeline":[{"$match":{}}],"as":"b"}},{"$unwind":"$b"},{"$lookup":{"from":"orders","pipeline":[{"$match":{}}],"as":"c"}},{"$unwind":"$c"},{"$group":{"_id":null,"n":{"$sum":1}}}]'
    const running = core.mongoAggregate(mongo, { ...target, pipeline: heavy })
    const outcome = running.then(() => 'finished', (error: { code?: string }) => error.code ?? 'error')
    let cancelled = false
    for (let attempt = 0; attempt < 20 && !cancelled; attempt++) { await sleep(250); cancelled = await core.mongoCancel(mongo) }
    expect(cancelled).toBe(true)
    expect(await outcome).toBe('cancelled')
    // Nothing is left tagged: a second cancel has nothing to stop.
    expect(await core.mongoCancel(mongo)).toBe(false)
  }, 60_000)

  it('edits a MongoDB document without retyping its numbers, and loads one too large to list', async () => {
    const target = { connectionId: 'mongo', database: 'shop', collection: 'typed' }
    await core.mongoWrite(mongo, { ...target, op: 'insert', document: '{"_id": 1, "count": {"$numberLong": "7"}, "ratio": {"$numberDouble": "2.0"}, "price": {"$numberDecimal": "1.10"}, "label": "a", "blob": "' + 'x'.repeat(70_000) + '"}' })
    const listed = await core.mongoFind(mongo, { ...target, limit: 5 })
    // 70 KB of text does not fit a listing: it is marked, and fetched whole before an edit.
    expect(listed.oversized).toEqual([{ index: 0, id: '1' }])
    const whole = (await core.mongoDocument(mongo, { database: 'shop', collection: 'typed', id: '1' })).text
    expect(JSON.parse(whole)).toMatchObject({ count: { $numberLong: '7' }, ratio: { $numberDouble: '2.0' }, price: { $numberDecimal: '1.10' }, label: 'a' })
    const edited = whole.replace('"label":"a"', '"label":"b"')
    expect(edited).not.toBe(whole)
    await core.mongoWrite(mongo, { ...target, op: 'replace', document: edited, expected: whole })
    const stored = JSON.parse((await core.mongoDocument(mongo, { database: 'shop', collection: 'typed', id: '1' })).text)
    expect(stored).toMatchObject({ count: { $numberLong: '7' }, ratio: { $numberDouble: '2.0' }, price: { $numberDecimal: '1.10' }, label: 'b' })
    // `whole` is stale now: neither a replace nor a delete may go through, and nothing is changed.
    await expect(core.mongoWrite(mongo, { ...target, op: 'delete', expected: whole })).rejects.toMatchObject({ code: 'conflict' })
    expect(JSON.parse((await core.mongoDocument(mongo, { database: 'shop', collection: 'typed', id: '1' })).text).label).toBe('b')
  })

  it('writes MongoDB documents with a conflict check, and imports with ordered:false', async () => {
    const target = { connectionId: 'mongo', database: 'shop', collection: 'items' }
    const inserted = await core.mongoWrite(mongo, { ...target, op: 'insert', document: '{"_id": 1, "name": "pen", "stock": 5}' })
    expect(inserted.insertedId).toBe('1')
    const original = '{"_id": 1, "name": "pen", "stock": 5}'
    const replaced = await core.mongoWrite(mongo, { ...target, op: 'replace', document: '{"name": "pen", "stock": 4}', expected: original })
    expect(replaced).toMatchObject({ matched: 1, modified: 1 })
    // `original` is now stale.
    await expect(core.mongoWrite(mongo, { ...target, op: 'replace', document: '{"name": "pen", "stock": 0}', expected: original })).rejects.toMatchObject({ code: 'conflict' })
    await expect(core.mongoWrite(mongo, { ...target, op: 'delete', expected: original })).rejects.toMatchObject({ code: 'conflict' })
    await expect(core.mongoWrite(mongo, { ...target, op: 'replace', document: '{"_id": 2, "name": "x"}', expected: '{"_id": 1, "name": "pen", "stock": 4}' })).rejects.toMatchObject({ code: 'invalid' })

    const path = join(dir, 'items.ndjson')
    writeFileSync(path, ['{"_id": 1, "name": "dup"}', '{"_id": 2, "name": "ink"}', '{"_id": 3, "name": "pad"}'].join('\n'))
    const outcome = await core.importRun(mongo, { path, format: 'ndjson', target: { kind: 'collection', database: 'shop', collection: 'items' }, mapping: { _id: '_id', name: 'name' } }, never)
    expect(outcome.inserted).toBe(2)
    expect(outcome.rejected).toBe(1)
    const found = await core.mongoFind(mongo, { ...target, sort: '{"_id": 1}' })
    expect(found.documents).toHaveLength(3)
  })
  it('creates, alters, duplicates and drops a table, all or nothing', async () => {
    const create = { kind: 'create' as const, table: {
      columns: [
        { name: 'id', type: 'bigint', nullable: false, identity: 'always' as const },
        { name: 'sku', type: 'text', nullable: false },
        { name: 'price', type: 'numeric(10,2)', nullable: true, default: '0' },
        { name: 'total', type: 'numeric', nullable: true, generated: 'price * 2' }
      ],
      constraints: [{ kind: 'primary' as const, columns: ['id'] }, { kind: 'unique' as const, name: 'items_sku_key', columns: ['sku'] }, { kind: 'check' as const, name: 'price_ok', expression: 'price >= 0' }],
      indexes: [{ name: 'items_price', columns: ['price'], where: 'price > 0' }],
      comment: 'catalog'
    } }
    const preview = core.structurePreview(pg, { schema: 'public', table: 'items', action: create })
    expect(preview.statements[0]).toMatch(/^CREATE TABLE "public"."items"/)
    await core.structureApply(pg, { schema: 'public', table: 'items', action: create })
    await exec(`INSERT INTO items (sku, price) VALUES ('a', 5)`)
    expect(await scalar(`SELECT total FROM items WHERE sku = 'a'`)).toBe('10.00')
    expect(await scalar(`SELECT obj_description('public.items'::regclass)`)).toBe('catalog')

    // The second change fails, so the first must not stay.
    await expect(core.structureApply(pg, { schema: 'public', table: 'items', action: { kind: 'alter', changes: [
      { op: 'addColumn', column: { name: 'note', type: 'text', nullable: true } },
      { op: 'addConstraint', constraint: { kind: 'check', name: 'bad', expression: 'price < 0' } }
    ] } })).rejects.toMatchObject({ code: 'query', detail: { sqlState: '23514' } })
    expect(await scalar(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'note'`)).toBe('0')

    await core.structureApply(pg, { schema: 'public', table: 'items', action: { kind: 'alter', changes: [
      { op: 'addColumn', column: { name: 'note', type: 'text', nullable: true } },
      { op: 'renameColumn', from: 'note', to: 'remark' },
      { op: 'alterColumn', name: 'sku', type: 'varchar(40)' },
      { op: 'addIndex', index: { name: 'items_remark', columns: ['remark'] } }
    ] }, confirmed: true })
    expect(await scalar(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'remark'`)).toBe('1')

    await core.structureApply(pg, { schema: 'public', table: 'items', action: { kind: 'duplicate', to: 'items_copy', withData: true } })
    expect(await scalar('SELECT count(*) FROM items_copy')).toBe('1')

    // Destructive actions wait for confirmation; a read-only connection refuses all of them.
    await expect(core.structureApply(pg, { schema: 'public', table: 'items_copy', action: { kind: 'drop' } })).rejects.toMatchObject({ code: 'confirm' })
    await expect(core.structureApply({ ...pg, readOnly: true }, { schema: 'public', table: 'items_copy', action: { kind: 'drop' }, confirmed: true })).rejects.toMatchObject({ code: 'read-only' })
    await core.structureApply(pg, { schema: 'public', table: 'items_copy', action: { kind: 'truncate' }, confirmed: true })
    expect(await scalar('SELECT count(*) FROM items_copy')).toBe('0')
    await core.structureApply(pg, { schema: 'public', table: 'items_copy', action: { kind: 'drop' }, confirmed: true })
    expect(await scalar(`SELECT to_regclass('public.items_copy') IS NULL`)).toBe('true')

    await core.maintenance(pg, { schema: 'public', table: 'items', action: 'vacuum-analyze' })
    await expect(core.maintenance(pg, { schema: 'public', table: 'items', action: 'reindex' })).rejects.toMatchObject({ code: 'confirm' })
    await core.maintenance(pg, { schema: 'public', table: 'items', action: 'reindex', confirmed: true })
  })

  it('shows what depends on a table and who may use it, and lists, creates and drops databases and roles', async () => {
    await exec('CREATE TABLE parents (id int PRIMARY KEY)')
    await exec('CREATE TABLE kids (id int, parent int REFERENCES parents (id))')
    await exec('CREATE VIEW parent_ids AS SELECT id FROM parents')
    await exec('CREATE ROLE reader_x NOLOGIN')
    await exec('GRANT SELECT ON parents TO reader_x')
    const details = await core.sqlTable(pg, 'public', 'parents')
    expect(details.dependents).toEqual([{ kind: 'foreign key', schema: 'public', name: 'kids' }, { kind: 'view', schema: 'public', name: 'parent_ids' }])
    expect(details.privileges).toContainEqual({ grantee: 'reader_x', privilege: 'SELECT', grantable: false })
    expect(details.privileges.some(item => item.grantee === 'oxe' && item.privilege === 'DELETE')).toBe(true)

    const roles = await core.sqlRoles(pg)
    expect(roles.find(role => role.name === 'oxe')).toMatchObject({ superuser: true, login: true })
    expect(roles.find(role => role.name === 'reader_x')).toMatchObject({ login: false, superuser: false })
    expect(roles.some(role => role.name.startsWith('pg_'))).toBe(false)

    await core.sqlCreateDatabase(pg, { name: 'scratch db', encoding: 'UTF8', template: 'template0' })
    const databases = await core.sqlDatabases(pg)
    expect(databases.find(item => item.name === 'scratch db')).toMatchObject({ current: false, encoding: 'UTF8' })
    expect(databases.find(item => item.name === 'appdb')?.current).toBe(true)
    await expect(core.sqlCreateDatabase(pg, { name: 'bad', encoding: 'EBCDIC' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(core.sqlCreateDatabase({ ...pg, readOnly: true }, { name: 'nope' })).rejects.toMatchObject({ code: 'read-only' })
    await expect(core.sqlDropDatabase(pg, { name: 'scratch db' })).rejects.toMatchObject({ code: 'confirm' })
    await expect(core.sqlDropDatabase(pg, { name: 'appdb', confirmed: true })).rejects.toMatchObject({ code: 'invalid' })
    await core.sqlDropDatabase(pg, { name: 'scratch db', confirmed: true })
    expect((await core.sqlDatabases(pg)).some(item => item.name === 'scratch db')).toBe(false)
  })

  it('lists sequences, types, triggers and extensions, finds objects by name and re-creates their definitions', async () => {
    await exec(`CREATE TYPE mood AS ENUM ('sad', 'it''s ok', 'happy')`)
    await exec('CREATE TYPE pair AS (a int, b text)')
    await exec('CREATE DOMAIN positive AS int CHECK (VALUE > 0)')
    await exec('CREATE SEQUENCE ticket_seq START 100 INCREMENT 5')
    await exec('CREATE TABLE audited (id int)')
    await exec(`CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`)
    await exec('CREATE TRIGGER audited_touch BEFORE INSERT ON audited FOR EACH ROW EXECUTE FUNCTION touch()')
    await exec('CREATE EXTENSION IF NOT EXISTS pgcrypto')

    const objects = await core.sqlObjects(pg, 'public')
    expect(objects.sequences.map(item => item.name)).toContain('ticket_seq')
    expect(objects.types.find(item => item.name === 'mood')).toMatchObject({ kind: 'enum', values: ['sad', "it's ok", 'happy'] })
    expect(objects.types.find(item => item.name === 'pair')?.kind).toBe('composite')
    expect(objects.types.find(item => item.name === 'positive')?.kind).toBe('domain')
    // A table's row type is not a user type.
    expect(objects.types.map(item => item.name)).not.toContain('audited')
    const trigger = objects.triggers.find(item => item.name === 'audited_touch')!
    expect(trigger).toMatchObject({ table: 'audited', enabled: true })

    expect((await core.sqlExtensions(pg)).map(item => item.name)).toContain('pgcrypto')

    expect((await core.sqlSearch(pg, 'MOO')).hits).toEqual([{ kind: 'type', schema: 'public', name: 'mood', oid: expect.any(Number) }])
    // LIKE wildcards in the search are text, not patterns.
    expect((await core.sqlSearch(pg, '%')).hits).toEqual([])
    expect((await core.sqlSearch(pg, 'audited')).hits.map(item => `${item.kind}:${item.name}`)).toEqual(['table:audited'])

    const typeOf = (name: string) => objects.types.find(item => item.name === name)!.oid
    expect((await core.sqlDefinition(pg, { kind: 'type', oid: typeOf('mood') })).text).toBe(`CREATE TYPE "public"."mood" AS ENUM ('sad', 'it''s ok', 'happy');`)
    expect((await core.sqlDefinition(pg, { kind: 'type', oid: typeOf('pair') })).text).toMatch(/"a" integer,\n {2}"b" text/)
    expect((await core.sqlDefinition(pg, { kind: 'type', oid: typeOf('positive') })).text).toBe('CREATE DOMAIN "public"."positive" AS integer;')
    expect((await core.sqlDefinition(pg, { kind: 'sequence', schema: 'public', name: 'ticket_seq' })).text).toMatch(/START 100 INCREMENT 5/)
    expect((await core.sqlDefinition(pg, { kind: 'trigger', oid: trigger.oid })).text).toMatch(/CREATE TRIGGER audited_touch BEFORE INSERT ON (public\.)?audited/)
  })

  it('re-creates a table, a view and a function from the catalog', async () => {
    await exec('CREATE VIEW adults AS SELECT id, name FROM people WHERE age >= 18')
    await exec(`CREATE FUNCTION add_one(i int) RETURNS int LANGUAGE sql AS 'SELECT i + 1'`)
    const table = await core.sqlDefinition(pg, { kind: 'table', schema: 'public', name: 'people' })
    expect(table.text).toMatch(/CREATE TABLE "public"."people"/)
    expect(table.text).toMatch(/PRIMARY KEY/)
    expect((await core.sqlDefinition(pg, { kind: 'view', schema: 'public', name: 'adults' })).text).toMatch(/CREATE VIEW "public"."adults" AS/)
    const functions = await core.sqlFunctions(pg, 'public')
    const fn = functions.find(item => item.name === 'add_one')!
    expect(fn.args).toBe('i integer')
    expect((await core.sqlDefinition(pg, { kind: 'function', oid: fn.oid })).text).toMatch(/FUNCTION public.add_one/)
  })

  it('infers a MongoDB schema and manages indexes', async () => {
    const schema = await core.mongoSchema(mongo, 'shop', 'items')
    expect(schema.sampled).toBeGreaterThan(0)
    expect(schema.fields.map(field => field.path)).toContain('name')
    const created = await core.mongoCreateIndex(mongo, { database: 'shop', collection: 'items', keys: '{"name": 1}', unique: true })
    expect(created.name).toBe('name_1')
    expect((await core.mongoIndexes(mongo, 'shop', 'items')).some(index => index.name === 'name_1' && index.unique)).toBe(true)
    await expect(core.mongoCreateIndex(mongo, { database: 'shop', collection: 'items', keys: '{"$bad": 1}' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(core.mongoDropIndex(mongo, { database: 'shop', collection: 'items', name: '_id_' })).rejects.toMatchObject({ code: 'invalid' })
    await core.mongoDropIndex(mongo, { database: 'shop', collection: 'items', name: 'name_1' })
    expect((await core.mongoIndexes(mongo, 'shop', 'items')).some(index => index.name === 'name_1')).toBe(false)
  })

  it('lets an approved agent read masked rows and refuses a sequence call before it reaches the server', async () => {
    await exec('CREATE TABLE accounts (id serial PRIMARY KEY, email text, password_hash text)')
    await exec(`INSERT INTO accounts (email, password_hash) VALUES ('a@example.com', 'pbkdf2$abcdef')`)
    await exec('CREATE SEQUENCE agent_seq')
    const db = openInMemoryDatabase()
    const prompts: string[] = []
    const deps: GatewayDeps = {
      list: () => [{ id: 'pg', name: 'live', engine: 'postgres', environment: 'dev', readOnly: false, agentAccess: 'write' } as never],
      resolve: () => pg,
      call: async (op, connection, input) => {
        const value = input as { sql: string; maxRows?: number }
        if (op === 'sql.run') return core.sqlRun(connection!, value.sql, { maxRows: value.maxRows, confirmed: (input as { confirmed?: boolean }).confirmed }) as never
        return {} as never
      },
      containers: { list: async () => ({ containers: [] }), logsTail: async () => '', action: async () => undefined },
      broker: new ApprovalBroker({ ask: async request => { prompts.push(request.text); return 'allow-once' } }),
      audit: new AuditLog(db)
    }
    const gateway = new AgentGateway(deps)
    const actor = { key: 'e1', label: 'thread:live' }
    const read = await gateway.handle('oxespace_db_query', { connection: 'live', sql: 'SELECT id, email, password_hash FROM accounts' }, actor) as { rows: unknown[][]; masked: string[] }
    expect(read.rows[0]).toEqual([1, 'a@example.com', '«masked»'])
    expect(read.masked).toEqual(['password_hash'])
    // A statement that looks like a read but writes is stopped by the READ ONLY transaction, not by a guess.
    await expect(gateway.handle('oxespace_db_query', { connection: 'live', sql: `SELECT nextval('agent_seq')` }, actor)).rejects.toMatchObject({ code: 'not-read' })
    expect(await scalar(`SELECT is_called FROM agent_seq`)).toBe('false')
    expect(prompts).toHaveLength(1)
    db.close()
  })

  it('creates a database container, lists resources and refuses to remove what is in use', async () => {
    const runtime = new ContainerRuntime({ host: new LocalExecutionHost(), emit: () => undefined, preferred: () => ENGINE })
    const name = `oxe-new-${suffix}`
    try {
      const created = await runtime.createDatabase({ engine: 'postgres', name, tag: '16-alpine' })
      expect(created.port).toBeGreaterThan(1023)
      expect(created.password.length).toBeGreaterThanOrEqual(20)
      // The password reached the server through the environment: the login works.
      const fresh: ResolvedConnection = { id: 'fresh', engine: 'postgres', host: '127.0.0.1', port: created.port, database: created.database, username: created.username, password: created.password, sslMode: 'disable', readOnly: true }
      await until('new database accepts logins', async () => { await core.sqlRun(fresh, 'SELECT 1'); return true })
      const stats = await runtime.stats()
      expect(stats.some(item => item.name === name)).toBe(true)
      expect((await runtime.volumes()).some(item => item.name === `${name}-data`)).toBe(true)
      expect((await runtime.images()).some(item => item.repository.includes('postgres'))).toBe(true)
      expect((await runtime.networks()).some(item => item.name === (ENGINE === 'podman' ? 'podman' : 'bridge'))).toBe(true)
      expect((await runtime.usage()).length).toBeGreaterThan(0)
      await expect(runtime.removeResource('volume', `${name}-data`)).rejects.toThrow()
      await expect(runtime.createDatabase({ engine: 'postgres', name, tag: '16-alpine' })).rejects.toThrow(/already exists/)
      await expect(runtime.createDatabase({ engine: 'postgres', name: 'Bad Name', tag: '16' })).rejects.toThrow(/lowercase/)
      await expect(runtime.createDatabase({ engine: 'postgres', name: 'x1', tag: '16; rm -rf /' })).rejects.toThrow(/tag/)
      await core.closeConnection('fresh')
      docker('rm', '-f', name)
      // An engine may take a moment to release a removed container's volume.
      await until('volume released', async () => { try { await runtime.removeResource('volume', `${name}-data`); return true } catch { return false } }, 20_000)
      expect((await runtime.volumes()).some(item => item.name === `${name}-data`)).toBe(false)
    } finally {
      try { docker('rm', '-f', name) } catch { /* gone */ }
      try { docker('volume', 'rm', '-f', `${name}-data`) } catch { /* gone */ }
    }
  }, 240_000)

  it('the server, not the guard, keeps a READ ONLY transaction read-only', async () => {
    const { Client } = await import('pg')
    const client = new Client({ host: pg.host, port: pg.port, user: pg.username, password: pg.password, database: pg.database })
    await client.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query('SELECT 1')
      // A statement the guard would let through still cannot lift the mode.
      await expect(client.query(`SELECT set_config('transaction_read_only', 'off', false)`)).rejects.toThrow(/read-write|read-only/)
      await client.query('ROLLBACK')
      await client.query('BEGIN READ ONLY')
      await client.query('SELECT 1')
      await expect(client.query(`INSERT INTO people (name) VALUES ('sneaky')`)).rejects.toThrow(/read-only transaction/)
    } finally { await client.query('ROLLBACK').catch(() => undefined); await client.end() }
    expect(await scalar(`SELECT count(*) FROM people WHERE name = 'sneaky'`)).toBe('0')
  })

})
