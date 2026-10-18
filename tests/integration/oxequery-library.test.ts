import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ConnectionStore, type SecretCipher } from '../../electron/main/services/oxequery/connection-store'
import { PickedFiles } from '../../electron/main/services/oxequery/picked-files'
import { HISTORY_LIMIT, LibraryInputError, QueryLibrary } from '../../electron/main/services/oxequery/query-library'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

const cipher: SecretCipher = { available: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() }

function setup() {
  const db = openInMemoryDatabase(); databases.push(db)
  let clock = 1_700_000_000_000
  const store = new ConnectionStore(db, cipher, new PickedFiles())
  const connection = store.save({ name: 'one', engine: 'postgres', host: 'db', port: 5432 })
  const other = store.save({ name: 'two', engine: 'postgres', host: 'db2', port: 5432 })
  const library = new QueryLibrary(db, () => (clock += 1000))
  return { db, store, library, connection, other, tick: (ms: number) => { clock += ms } }
}

describe('query library', () => {
  it('does not keep a password typed into a statement, and scrubs history written before', () => {
    const { library, connection, db } = setup()
    library.record(connection.id, { sql: "ALTER ROLE app PASSWORD 'hunter2'", durationMs: 1, rows: null, ok: true })
    expect(library.list(connection.id).history[0].sql).toBe("ALTER ROLE app PASSWORD '***'")
    db.prepare('INSERT INTO oxequery_query_history (connection_id, sql, ran_at, ok) VALUES (?, ?, ?, 1)').run(connection.id, "CREATE USER u PASSWORD 'old-secret'", 5)
    expect(library.scrubHistory()).toBe(1)
    expect(library.list(connection.id).history.map(item => item.sql).join('|')).not.toContain('old-secret')
    expect(library.scrubHistory()).toBe(0)
  })

  it('keeps one history row per statement, newest first, per connection', () => {
    const { library, connection, other } = setup()
    library.record(connection.id, { sql: 'SELECT 1', durationMs: 3, rows: 1, ok: true })
    library.record(connection.id, { sql: 'SELECT 2', durationMs: 4, rows: 1, ok: true })
    library.record(connection.id, { sql: '  SELECT 1  ', durationMs: 5, rows: 1, ok: false })
    library.record(other.id, { sql: 'SELECT 9', durationMs: 1, rows: 1, ok: true })
    const { history } = library.list(connection.id)
    expect(history.map(item => item.sql)).toEqual(['SELECT 1', 'SELECT 2'])
    expect(history[0]).toMatchObject({ ok: false, durationMs: 5 })
    expect(library.list(other.id).history).toHaveLength(1)
  })

  it('bounds the history and expires old entries', () => {
    const { library, connection, tick } = setup()
    library.record(connection.id, { sql: 'SELECT old', durationMs: 1, rows: 1, ok: true })
    tick(91 * 86_400_000)
    for (let index = 0; index < HISTORY_LIMIT + 10; index++) library.record(connection.id, { sql: `SELECT ${index}`, durationMs: 1, rows: 1, ok: true })
    const { history } = library.list(connection.id)
    expect(history).toHaveLength(HISTORY_LIMIT)
    expect(history.some(item => item.sql === 'SELECT old')).toBe(false)
  })

  it('saves, renames and deletes queries, scoped to the connection', () => {
    const { library, connection, other } = setup()
    const created = library.save({ connectionId: connection.id, name: 'Active users', sql: 'SELECT * FROM users' })
    const renamed = library.save({ connectionId: connection.id, id: created.id, name: 'All users', sql: 'SELECT * FROM users' })
    expect(renamed.name).toBe('All users')
    expect(() => library.save({ connectionId: other.id, id: created.id, name: 'x', sql: 'SELECT 1' })).toThrow(LibraryInputError)
    expect(library.remove(other.id, created.id)).toBe(false)
    expect(library.remove(connection.id, created.id)).toBe(true)
    expect(library.list(connection.id).saved).toEqual([])
    expect(() => library.save({ connectionId: connection.id, name: '  ', sql: 'SELECT 1' })).toThrow(LibraryInputError)
  })

  it('does not record oversized statements and is removed with its connection', () => {
    const { library, connection, store, db } = setup()
    library.record(connection.id, { sql: 'x'.repeat(30_000), durationMs: 1, rows: 0, ok: true })
    expect(library.list(connection.id).history).toEqual([])
    library.record(connection.id, { sql: 'SELECT 1', durationMs: 1, rows: 1, ok: true })
    library.save({ connectionId: connection.id, name: 'keep', sql: 'SELECT 1' })
    store.delete(connection.id)
    expect((db.prepare('SELECT count(*) AS n FROM oxequery_query_history').get() as { n: number }).n).toBe(0)
    expect((db.prepare('SELECT count(*) AS n FROM oxequery_saved_queries').get() as { n: number }).n).toBe(0)
  })
})

describe('audit log', () => {
  it('is append-only and prunes only old rows', async () => {
    const { AuditLog } = await import('../../electron/main/services/oxequery/audit-log')
    const db = openInMemoryDatabase(); databases.push(db)
    let clock = 1_700_000_000_000
    const log = new AuditLog(db, () => clock)
    log.record({ actor: 'thread:1', tool: 'oxespace_db_query', decision: 'approved', outcome: 'ok', text: 'SELECT 1' })
    expect(() => db.prepare("UPDATE oxequery_audit SET decision = 'denied'").run()).toThrow(/append-only/)
    clock += 91 * 86_400_000
    log.record({ actor: 'thread:1', tool: 'oxespace_db_query', decision: 'approved', outcome: 'ok' })
    expect(log.prune()).toBe(1)
    expect(log.list()).toHaveLength(1)
  })
})
