import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import type { ExecutionHost } from '../../electron/main/runtime/execution-host'
import { OxeQueryService } from '../../electron/main/services/oxequery/service'
import type { SecretCipher } from '../../electron/main/services/oxequery/connection-store'
import type { ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'
import { setPolicyStore } from '../../electron/main/services/policy'
import { PolicyStore } from '../../electron/main/services/policy/policy-store'
import type { ConnectionSafety, OxeQueryConnection, OxeQueryConnectionInput, OxeQueryErrorInfo } from '../../shared/types/oxequery'

/**
 * Safe production through the service: the worker is a recorder, so what the person is allowed to do is decided,
 * and what reaches the database is observed, without a server. Live behaviour of the same checks against
 * PostgreSQL is in tests/live/oxequery-live.test.ts.
 */
const databases: AppDatabase[] = []
const directories: string[] = []
afterEach(() => {
  setPolicyStore(undefined as unknown as null)
  for (const db of databases.splice(0)) db.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const cipher: SecretCipher = { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() }
const host = { id: 'fake', kind: 'local', exec: vi.fn(), readTextFile: vi.fn(), writeTextFile: vi.fn() } as unknown as ExecutionHost

function fixture(rules: Array<{ effect: 'allow' | 'deny'; action: 'db.write'; resource: string }> = []) {
  const db = openInMemoryDatabase(); databases.push(db)
  const userData = mkdtempSync(join(tmpdir(), 'oxe-safety-')); directories.push(userData)
  if (rules.length) writeFileSync(join(userData, 'policy.json'), JSON.stringify({ organization: 'Acme', rules }))
  setPolicyStore(new PolicyStore({ userData, managed: join(userData, 'no-managed.json') }))
  const worker = { call: vi.fn(async (op: string, _connection?: ResolvedConnection, _input?: unknown): Promise<unknown> => (op === 'sql.run'
    ? { columns: [], rows: [], rowCount: 0, truncated: false, durationMs: 1, command: 'UPDATE', affectedRows: 1 }
    : op === 'sql.script' ? { statements: [] } : { op })), close: vi.fn(async () => undefined) }
  const service = new OxeQueryService({ db, host, worker, cipher, emit: () => undefined })
  const save = async (input: Partial<OxeQueryConnectionInput> = {}): Promise<OxeQueryConnection> => {
    const response = await service.call('connections.save', { name: 'Shop prod', engine: 'postgres', host: 'db', port: 5432, database: 'shop', username: 'me', readOnly: false, environment: 'prod', ...input })
    if (!response.ok) throw Error(response.error.message)
    return response.value as OxeQueryConnection
  }
  const runs = (): Array<{ connection: ResolvedConnection; input: Record<string, unknown> }> => worker.call.mock.calls.filter(call => call[0] === 'sql.run').map(call => ({ connection: call[1] as ResolvedConnection, input: call[2] as Record<string, unknown> }))
  return { service, worker, save, runs }
}

const failure = async (promise: Promise<{ ok: boolean; error?: OxeQueryErrorInfo }>): Promise<OxeQueryErrorInfo> => {
  const response = await promise
  if (response.ok) throw Error('expected a refusal')
  return response.error!
}

describe('production asks for the connection name', () => {
  it('refuses a write without the name before the worker is reached, and runs it with the name', async () => {
    const { service, save, runs } = fixture()
    const connection = await save()
    const sql = "UPDATE users SET name = 'x' WHERE id = 1"
    const refused = await failure(service.call('sql.run', { connectionId: connection.id, sql }))
    expect(refused.code).toBe('confirm-name')
    expect(runs()).toHaveLength(0)
    expect((await failure(service.call('sql.run', { connectionId: connection.id, sql, confirmName: 'shop prod' }))).code).toBe('confirm-name')
    expect(runs()).toHaveLength(0)
    expect((await service.call('sql.run', { connectionId: connection.id, sql, confirmName: '  Shop prod ' })).ok).toBe(true)
    expect(runs()).toHaveLength(1)
  })

  it('applies to DDL, to scripts and to ANALYZE of a write, and not to reads', async () => {
    const { service, save, runs, worker } = fixture()
    const connection = await save()
    for (const sql of ['CREATE TABLE t (id int)', 'DROP TABLE t', 'TRUNCATE t', 'INSERT INTO t VALUES (1)']) {
      expect((await failure(service.call('sql.run', { connectionId: connection.id, sql, confirmed: true }))).code, sql).toBe('confirm-name')
    }
    expect((await failure(service.call('sql.script', { connectionId: connection.id, sql: 'SELECT 1; DELETE FROM t WHERE id = 1' }))).code).toBe('confirm-name')
    expect((await failure(service.call('sql.explain', { connectionId: connection.id, sql: 'DELETE FROM t WHERE id = 1', analyze: true, confirmed: true }))).code).toBe('confirm-name')
    expect(worker.call).not.toHaveBeenCalledWith('sql.script', expect.anything(), expect.anything())
    expect(worker.call).not.toHaveBeenCalledWith('sql.explain', expect.anything(), expect.anything())
    expect(runs()).toHaveLength(0)

    for (const sql of ['SELECT * FROM users', 'EXPLAIN SELECT 1', 'SHOW search_path', 'WITH a AS (SELECT 1) SELECT * FROM a']) {
      expect((await service.call('sql.run', { connectionId: connection.id, sql })).ok, sql).toBe(true)
    }
    expect((await service.call('sql.explain', { connectionId: connection.id, sql: 'SELECT 1', analyze: true })).ok).toBe(true)
    expect(runs()).toHaveLength(4)
  })

  it('lets a script through with the name and still holds the destructive confirmation', async () => {
    const { service, save, worker } = fixture()
    const connection = await save()
    const sql = 'DELETE FROM t WHERE id = 1; UPDATE t SET a = 1 WHERE id = 2'
    expect((await service.call('sql.script', { connectionId: connection.id, sql, confirmName: 'Shop prod' })).ok).toBe(true)
    expect(worker.call).toHaveBeenCalledWith('sql.script', expect.anything(), expect.objectContaining({ sql }))
  })

  it('does not ask on other kinds of environment', async () => {
    const { service, save, runs } = fixture()
    const dev = await save({ name: 'Shop dev', environment: 'dev' })
    expect((await service.call('sql.run', { connectionId: dev.id, sql: 'DROP TABLE t', confirmed: true })).ok).toBe(true)
    expect(runs()).toHaveLength(1)
  })

  it('keeps asking for the destructive confirmation after the name is typed', async () => {
    const { service, save, runs } = fixture()
    const connection = await save()
    // The worker (here a recorder) enforces `confirmed`; the service must pass the flag through unchanged.
    await service.call('sql.run', { connectionId: connection.id, sql: 'DROP TABLE t', confirmName: 'Shop prod' })
    expect(runs()[0].input).toMatchObject({ sql: 'DROP TABLE t', confirmed: false })
  })
})

describe('environment limits', () => {
  it('hand the worker production at no more than 1,000 rows and 30 seconds', async () => {
    const { service, save, runs } = fixture()
    const connection = await save({ maxRows: 50_000, statementTimeoutMs: 600_000 })
    await service.call('sql.run', { connectionId: connection.id, sql: 'SELECT 1' })
    expect(runs()[0].connection).toMatchObject({ maxRows: 1000, statementTimeoutMs: 30_000 })
    await service.call('sql.run', { connectionId: connection.id, sql: 'SELECT 1', maxRows: 40_000 })
    expect(runs()[1].input.maxRows).toBe(1000)
    await service.call('sql.run', { connectionId: connection.id, sql: 'SELECT 1', maxRows: 20 })
    expect(runs()[2].input.maxRows).toBe(20)
  })

  it('leave the other environments alone, and follow what is set in preferences', async () => {
    const { service, save, runs } = fixture()
    const dev = await save({ name: 'Shop dev', environment: 'dev', maxRows: 50_000, statementTimeoutMs: 600_000 })
    await service.call('sql.run', { connectionId: dev.id, sql: 'SELECT 1' })
    expect(runs()[0].connection).toMatchObject({ maxRows: 50_000, statementTimeoutMs: 600_000 })
    const set = await service.call('preferences.set', { environmentLimits: { dev: { maxRows: 100, statementTimeoutMs: 5000 } } })
    expect(set.ok && set.value.environmentLimits).toMatchObject({ dev: { maxRows: 100, statementTimeoutMs: 5000 }, prod: { maxRows: 1000, statementTimeoutMs: 30_000 } })
    await service.call('sql.run', { connectionId: dev.id, sql: 'SELECT 1' })
    expect(runs()[1].connection).toMatchObject({ maxRows: 100, statementTimeoutMs: 5000 })
    expect((await failure(service.call('preferences.set', { environmentLimits: { dev: { maxRows: 0, statementTimeoutMs: 5000 } } }))).code).toBe('invalid')
  })

  it('are reported to the editor with the typed-name rule', async () => {
    const { service, save } = fixture()
    const prod = await save({ maxRows: 50_000, statementTimeoutMs: 600_000 })
    const dev = await save({ name: 'Shop dev', environment: 'dev', readOnly: true })
    const read = async (id: string): Promise<ConnectionSafety> => { const response = await service.call('safety.get', { connectionId: id }); if (!response.ok) throw Error(response.error.message); return response.value }
    expect(await read(prod.id)).toEqual({ readOnly: false, readOnlyBy: null, typedConfirmation: true, maxRows: 1000, statementTimeoutMs: 30_000 })
    expect(await read(dev.id)).toEqual({ readOnly: true, readOnlyBy: 'connection', typedConfirmation: false, maxRows: 500, statementTimeoutMs: 60_000 })
    expect((await failure(service.call('safety.get', { connectionId: 'gone' }))).code).toBe('invalid')
  })
})

describe('organization policy forces read-only', () => {
  const deny = [{ effect: 'deny' as const, action: 'db.write' as const, resource: 'prod:*' }]

  it('refuses writes to a connection the policy covers, even with the name typed, and still reads', async () => {
    const { service, save, runs } = fixture(deny)
    const connection = await save({ readOnly: false })
    const refused = await failure(service.call('sql.run', { connectionId: connection.id, sql: 'UPDATE t SET a = 1 WHERE id = 1', confirmName: 'Shop prod', confirmed: true }))
    expect(refused.code).toBe('read-only')
    expect(refused.message).toContain('Acme policy')
    expect((await failure(service.call('sql.script', { connectionId: connection.id, sql: 'SELECT 1; DROP TABLE t', confirmName: 'Shop prod', confirmed: true }))).code).toBe('read-only')
    expect(runs()).toHaveLength(0)
    expect((await service.call('sql.run', { connectionId: connection.id, sql: 'SELECT 1' })).ok).toBe(true)
    expect(runs()[0].connection.readOnly).toBe(true)
  })

  it('says so to the editor, and the connection form still shows what the person chose', async () => {
    const { service, save } = fixture(deny)
    const connection = await save({ readOnly: false })
    const safety = await service.call('safety.get', { connectionId: connection.id })
    expect(safety.ok && safety.value).toMatchObject({ readOnly: true, readOnlyBy: 'policy' })
    const listed = await service.call('connections.list', {})
    expect(listed.ok && (listed.value as OxeQueryConnection[])[0].readOnly).toBe(false)
  })

  it('applies per environment and per name, and only to what the rule names', async () => {
    const { service, save, runs } = fixture(deny)
    const dev = await save({ name: 'Shop dev', environment: 'dev' })
    expect((await service.call('sql.run', { connectionId: dev.id, sql: 'DELETE FROM t WHERE id = 1' })).ok).toBe(true)
    expect(runs()).toHaveLength(1)
    expect(runs()[0].connection.readOnly).toBe(false)
  })

  it('can name one connection, and a later allow lifts the rule', async () => {
    const byName = fixture([{ effect: 'deny', action: 'db.write', resource: '*:Reports' }])
    const reports = await byName.save({ name: 'Reports', environment: 'dev' })
    const other = await byName.save({ name: 'Other', environment: 'dev' })
    expect((await failure(byName.service.call('sql.run', { connectionId: reports.id, sql: 'DELETE FROM t WHERE id = 1' }))).code).toBe('read-only')
    expect((await byName.service.call('sql.run', { connectionId: other.id, sql: 'DELETE FROM t WHERE id = 1' })).ok).toBe(true)

    const lifted = fixture([...deny, { effect: 'allow', action: 'db.write', resource: 'prod:Shop prod' }])
    const connection = await lifted.save()
    expect((await lifted.service.call('sql.run', { connectionId: connection.id, sql: 'DELETE FROM t WHERE id = 1', confirmName: 'Shop prod' })).ok).toBe(true)
  })

  it('does not stand in the way of a person without any policy file', async () => {
    const { service, save } = fixture()
    const connection = await save({ environment: 'dev' })
    const safety = await service.call('safety.get', { connectionId: connection.id })
    expect(safety.ok && safety.value.readOnlyBy).toBeNull()
  })
})
