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

const live = process.env.OXE_LIVE === '1'
const suffix = Math.random().toString(36).slice(2, 8)
const PG = `oxe-writes-pg-${suffix}`
const MONGO = `oxe-writes-mongo-${suffix}`
const PASSWORD = 'oxe-writes-pw'

const docker = (...args: string[]): string => execFileSync('docker', args, { encoding: 'utf8' }).trim()
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
    docker('run', '-d', '--name', PG, '-e', 'POSTGRES_USER=oxe', '-e', 'POSTGRES_DB=appdb', '-e', `POSTGRES_PASSWORD=${PASSWORD}`, '-p', '127.0.0.1::5432', 'postgres:16-alpine')
    docker('run', '-d', '--name', MONGO, '-e', 'MONGO_INITDB_ROOT_USERNAME=root', '-e', `MONGO_INITDB_ROOT_PASSWORD=${PASSWORD}`, '-p', '127.0.0.1::27017', 'mongo:7')
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
})
