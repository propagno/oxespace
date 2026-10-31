import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The PostgreSQL half of OxeQuery's driver layer, driven through a scripted `pg`. Nothing here talks to a
 * server: each test says what the "server" answers to which SQL, and checks what the core made of it
 * (and which statements it sent, in which order). The real server is covered by tests/live.
 */
interface Reply { fields?: { name: string; dataTypeID: number }[]; rows?: unknown[][]; command?: string; rowCount?: number | null }
type Answer = Reply | ((sql: string, values: unknown[]) => Reply | Promise<Reply>)

const server = vi.hoisted(() => {
  const state = {
    rules: [] as { match: RegExp; answer: unknown }[],
    log: [] as string[],
    clients: 0,
    connectError: null as Error | null,
    killed: [] as unknown[],
    closedCursors: 0,
    answer: async (sql: string, values: unknown[]): Promise<Reply> => {
      state.log.push(sql.replace(/\s+/g, ' ').trim())
      const rule = state.rules.find(item => item.match.test(sql))
      if (!rule) return { rows: [], fields: [], command: /^\s*(\w+)/.exec(sql)?.[1]?.toUpperCase() ?? 'SELECT', rowCount: 0 }
      return typeof rule.answer === 'function' ? await (rule.answer as (s: string, v: unknown[]) => Reply | Promise<Reply>)(sql, values) : rule.answer as Reply
    }
  }
  return state
})

vi.mock('pg-cursor', () => ({
  default: class Cursor {
    private offset = 0
    constructor(readonly text: string, readonly values: unknown[]) {}
    // Each read continues where the last one stopped, as a server-side cursor does.
    read(count: number, done: (error: Error | null, rows?: unknown[][], result?: unknown) => void): void {
      Promise.resolve(server.answer(this.text, this.values)).then(reply => { const rows = (reply.rows ?? []).slice(this.offset, this.offset + count); this.offset += rows.length; done(null, rows, reply) }, error => done(error as Error))
    }
    close(done: () => void): void { server.closedCursors++; done() }
  }
}))

vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events')
  class Client extends EventEmitter {
    processID = 4242
    constructor(readonly config: unknown) { super(); server.clients++ }
    async connect(): Promise<void> { if (server.connectError) throw server.connectError }
    async end(): Promise<void> { /* closed */ }
    query(arg: unknown, params?: unknown[]): unknown {
      if (arg && typeof (arg as { read?: unknown }).read === 'function') return arg
      const text = typeof arg === 'string' ? arg : (arg as { text: string }).text
      const values = typeof arg === 'string' ? (params ?? []) : ((arg as { values?: unknown[] }).values ?? [])
      if (/pg_cancel_backend/.test(text)) { server.killed.push(values[0]); return Promise.resolve({ rows: [] }) }
      return Promise.resolve(server.answer(text, values))
    }
  }
  return { Client }
})

import { OxeQueryCore } from '../../electron/main/services/oxequery/oxequery-core'
import { OxeQueryError, type ResolvedConnection } from '../../electron/main/services/oxequery/oxequery-errors'

const on = (match: RegExp, answer: Answer): void => { server.rules.push({ match, answer }) }
const sent = (pattern: RegExp): string[] => server.log.filter(entry => pattern.test(entry))

const base: ResolvedConnection = { id: 'c1', engine: 'postgres', host: 'db.local', port: 5432, database: 'app', username: 'me', password: 'hunter2', sslMode: 'disable', readOnly: false, maxRows: 500 }
const connection = (change: Partial<ResolvedConnection> = {}): ResolvedConnection => ({ ...base, ...change })

let core: OxeQueryCore
beforeEach(() => { server.rules.length = 0; server.log.length = 0; server.clients = 0; server.connectError = null; server.killed.length = 0; server.closedCursors = 0; core = new OxeQueryCore() })
afterEach(async () => { await core.closeAll() })

const failure = async (run: () => Promise<unknown>): Promise<OxeQueryError> => {
  try { await run() } catch (error) { return error as OxeQueryError }
  throw new Error('expected a failure')
}

describe('running statements', () => {
  it('returns columns, rows and the command, and reuses one session', async () => {
    on(/SELECT id, name/, { fields: [{ name: 'id', dataTypeID: 23 }, { name: 'name', dataTypeID: 25 }], rows: [[1, 'alice'], [2, 'bob']], command: 'SELECT', rowCount: 2 })
    const first = await core.sqlRun(connection(), 'SELECT id, name FROM users')
    expect(first.columns.map(column => column.name)).toEqual(['id', 'name'])
    expect(first.rows).toEqual([[1, 'alice'], [2, 'bob']])
    expect(first).toMatchObject({ rowCount: 2, truncated: false })
    await core.sqlRun(connection(), 'SELECT id, name FROM users')
    expect(server.clients).toBe(1)
  })

  it('cuts the rows at the limit and says so', async () => {
    on(/FROM big/, { fields: [{ name: 'n', dataTypeID: 23 }], rows: [[1], [2], [3]], command: 'SELECT', rowCount: 3 })
    const result = await core.sqlRun(connection(), 'SELECT n FROM big', { maxRows: 2 })
    expect(result.rows).toEqual([[1], [2]])
    expect(result).toMatchObject({ truncated: true, limitedBy: 'rows' })
  })

  it('reports affected rows for a statement that changes data', async () => {
    on(/^UPDATE/, { command: 'UPDATE', rowCount: 3 })
    expect(await core.sqlRun(connection(), 'UPDATE users SET active = true WHERE id > 1')).toMatchObject({ command: 'UPDATE', affectedRows: 3 })
  })

  it('wraps a read-only connection in a READ ONLY transaction that is always rolled back', async () => {
    await core.sqlRun(connection({ readOnly: true }), 'SELECT 1')
    expect(server.log).toEqual(['BEGIN READ ONLY', 'SELECT 1', 'ROLLBACK'])
  })

  it('passes parameters to a single statement and refuses them for several', async () => {
    on(/WHERE id = \$1/, (_sql, values) => ({ fields: [{ name: 'echo', dataTypeID: 25 }], rows: [[String(values[0])]], command: 'SELECT', rowCount: 1 }))
    expect((await core.sqlRun(connection(), 'SELECT $1 AS echo FROM t WHERE id = $1', { params: ['7'] })).rows).toEqual([['7']])
    expect((await failure(() => core.sqlRun(connection(), 'SELECT 1; SELECT 2', { params: ['x'] }))).message).toMatch(/one statement at a time/)
  })

  it('runs several statements with the simple protocol and returns the last result', async () => {
    on(/SELECT 1; SELECT 2/, { fields: [{ name: 'two', dataTypeID: 23 }], rows: [[2]], command: 'SELECT', rowCount: 1 })
    const result = await core.sqlRun(connection(), 'SELECT 1; SELECT 2')
    expect(result.rows).toEqual([[2]])
    expect(result.columns[0]?.name).toBe('two')
  })

  it('collects server notices', async () => {
    on(/DO/, () => ({ command: 'DO' }))
    const result = await core.sqlRun(connection(), 'DO $$ BEGIN RAISE NOTICE \'hi\'; END $$')
    expect(result.notices).toBeUndefined()
  })
})

describe('what a statement may do', () => {
  it('refuses empty SQL, oversized SQL, changes on a read-only connection and unconfirmed destructive statements', async () => {
    expect((await failure(() => core.sqlRun(connection(), '   '))).message).toMatch(/nothing to run/)
    expect((await failure(() => core.sqlRun(connection(), 'x'.repeat(1024 * 1024 + 1)))).message).toMatch(/too large/)
    expect((await failure(() => core.sqlRun(connection({ readOnly: true }), 'DELETE FROM users WHERE id = 1'))).code).toBe('read-only')
    const confirm = await failure(() => core.sqlRun(connection(), 'DROP TABLE users'))
    expect(confirm.code).toBe('confirm')
    expect(confirm.reasons.length).toBeGreaterThan(0)
    on(/DROP TABLE/, { command: 'DROP' })
    expect(await core.sqlRun(connection(), 'DROP TABLE users', { confirmed: true })).toMatchObject({ command: 'DROP' })
  })

  it('turns server failures into typed errors with position, SQLSTATE and hint, and never shows the password', async () => {
    on(/SELEC/, () => { throw Object.assign(new Error('syntax error at or near "SELEC" (password hunter2)'), { position: '1', code: '42601', hint: 'Check hunter2 spelling' }) })
    const error = await failure(() => core.sqlRun(connection(), 'SELEC 1'))
    expect(error).toMatchObject({ code: 'query', detail: { position: 1, sqlState: '42601' } })
    expect(error.message).not.toContain('hunter2')
    expect(error.detail.hint).not.toContain('hunter2')
  })

  it('names a cancelled query and a timed-out query', async () => {
    on(/cancelme/, () => { throw new Error('canceling statement due to user request') })
    on(/slowone/, () => { throw new Error('canceling statement due to statement timeout') })
    expect((await failure(() => core.sqlRun(connection(), 'SELECT cancelme'))).code).toBe('cancelled')
    const timeout = await failure(() => core.sqlRun(connection({ statementTimeoutMs: 5000 }), 'SELECT slowone'))
    expect(timeout.code).toBe('timeout')
    expect(timeout.message).toContain('5s')
  })

  it('reports a failed connection with the password removed', async () => {
    server.connectError = new Error('password authentication failed for user "me" using hunter2')
    const error = await failure(() => core.sqlRun(connection(), 'SELECT 1'))
    expect(error.code).toBe('connect')
    expect(error.message).not.toContain('hunter2')
  })

  it('refuses a second statement while one is running, and cancels it from a second session', async () => {
    let release: () => void = () => undefined
    on(/SELECT pg_sleep/, () => new Promise<Reply>(resolve => { release = () => resolve({ rows: [[1]], fields: [{ name: 'x', dataTypeID: 23 }], command: 'SELECT', rowCount: 1 }) }))
    const running = core.sqlRun(connection(), 'SELECT pg_sleep(9)')
    await vi.waitFor(() => expect(sent(/pg_sleep/)).toHaveLength(1))
    expect((await failure(() => core.sqlRun(connection(), 'SELECT 2'))).message).toMatch(/already running/)
    expect(await core.sqlCancel(connection())).toBe(true)
    expect(server.killed).toEqual([4242])
    release()
    await running
    expect(await core.sqlCancel(connection())).toBe(false)
  })

  it('reconnects when the connection settings change, but not for read-only, which each statement applies itself', async () => {
    await core.sqlRun(connection(), 'SELECT 1')
    await core.sqlRun(connection({ readOnly: true }), 'SELECT 1')
    expect(server.clients).toBe(1)
    await core.sqlRun(connection({ password: 'changed' }), 'SELECT 1')
    expect(server.clients).toBe(2)
    await core.closeConnection('c1')
    await core.sqlRun(connection(), 'SELECT 1')
    expect(server.clients).toBe(3)
  })
})

describe('transactions', () => {
  it('follows BEGIN, the statements inside it, and COMMIT or ROLLBACK', async () => {
    expect(core.txState(connection())).toEqual({ state: 'none', statements: 0 })
    expect((await core.sqlTx(connection(), 'begin')).state).toBe('open')
    await core.sqlRun(connection(), 'INSERT INTO t VALUES (1)')
    await core.sqlRun(connection(), 'UPDATE t SET a = 2 WHERE a = 1')
    expect(core.txState(connection())).toMatchObject({ state: 'open', statements: 2 })
    expect((await failure(() => core.sqlTx(connection(), 'begin'))).message).toMatch(/already open/)
    expect(await core.sqlTx(connection(), 'commit')).toEqual({ state: 'none', statements: 0 })
    expect((await failure(() => core.sqlTx(connection(), 'rollback'))).message).toMatch(/no open transaction/)
  })

  it('does not wrap statements of a transaction the person opened, and tracks typed BEGIN and ROLLBACK', async () => {
    await core.sqlRun(connection({ readOnly: false }), 'BEGIN')
    expect(core.txState(connection()).state).toBe('open')
    await core.sqlRun(connection(), 'SELECT 1')
    await core.sqlRun(connection(), 'ROLLBACK')
    expect(core.txState(connection()).state).toBe('none')
  })

  it('marks the transaction failed after an error and accepts only ROLLBACK', async () => {
    await core.sqlTx(connection(), 'begin')
    on(/boom/, () => { throw new Error('relation "boom" does not exist') })
    await failure(() => core.sqlRun(connection(), 'SELECT * FROM boom'))
    expect(core.txState(connection()).state).toBe('failed')
    expect((await failure(() => core.sqlRun(connection(), 'SELECT 1'))).message).toMatch(/Roll it back/)
    await core.sqlRun(connection(), 'ROLLBACK')
    expect(core.txState(connection()).state).toBe('none')
  })

  it('does not open a transaction on a read-only connection', async () => {
    expect((await failure(() => core.sqlTx(connection({ readOnly: true }), 'begin'))).code).toBe('read-only')
  })

  it('keeps other work out of an open transaction (edits, structure, maintenance, explain)', async () => {
    await core.sqlTx(connection(), 'begin')
    expect((await failure(() => core.maintenance(connection(), { schema: 'public', table: 't', action: 'analyze' }))).message).toMatch(/transaction is open/)
    expect((await failure(() => core.sqlExplain(connection(), { sql: 'SELECT 1' }))).message).toMatch(/transaction is open/)
    expect((await failure(() => core.structureApply(connection(), { schema: 'public', table: 't', action: { kind: 'drop' }, confirmed: true }))).message).toMatch(/transaction is open/)
  })
})

describe('scripts', () => {
  it('runs each statement on its own and stops at the first failure', async () => {
    on(/bad/, () => { throw Object.assign(new Error('relation "bad" does not exist'), { code: '42P01' }) })
    const result = await core.sqlScript(connection(), 'SELECT 1; SELECT * FROM bad; SELECT 3')
    expect(result.statements).toHaveLength(2)
    expect(result.stoppedAt).toBe(1)
    expect(result.statements[1]?.error).toMatchObject({ code: 'query', sqlState: '42P01' })
    expect(sent(/SELECT 3/)).toHaveLength(0)
  })

  it('checks every statement before running the first, collecting the destructive reasons', async () => {
    const error = await failure(() => core.sqlScript(connection(), 'SELECT 1; DROP TABLE a; TRUNCATE b'))
    expect(error.code).toBe('confirm')
    expect(server.log).toEqual([])
    expect((await core.sqlScript(connection(), 'SELECT 1; DROP TABLE a', { confirmed: true })).statements).toHaveLength(2)
  })

  it('refuses an empty script, a read-only change and a script of a thousand statements', async () => {
    expect((await failure(() => core.sqlScript(connection(), ';;'))).message).toMatch(/nothing to run/)
    expect((await failure(() => core.sqlScript(connection({ readOnly: true }), 'SELECT 1; DELETE FROM t WHERE a = 1'))).code).toBe('read-only')
    expect((await failure(() => core.sqlScript(connection(), Array.from({ length: 501 }, () => 'SELECT 1').join(';')))).message).toMatch(/up to 500/)
  })
})

describe('browsing and the catalog', () => {
  it('pages a table, orders it, and counts the rows that match a filter', async () => {
    on(/SELECT count\(\*\)/, { rows: [[41]], fields: [{ name: 'count', dataTypeID: 20 }], command: 'SELECT', rowCount: 1 })
    on(/^SELECT \* FROM/, { rows: [[1, 'a']], fields: [{ name: 'id', dataTypeID: 23 }, { name: 'v', dataTypeID: 25 }], command: 'SELECT', rowCount: 1 })
    const plain = await core.sqlBrowse(connection(), { connectionId: 'c1', schema: 'public', table: 'users', limit: 10, offset: 20, orderBy: { column: 'id', direction: 'desc' } })
    expect(plain.totalRows).toBeUndefined()
    expect(sent(/^SELECT \* FROM "public"."users" ORDER BY "id" DESC LIMIT 11 OFFSET 20/)).toHaveLength(1)
    const filtered = await core.sqlBrowse(connection(), { connectionId: 'c1', schema: 'public', table: 'users', filters: [{ column: 'v', op: 'eq', value: 'a' }] })
    expect(filtered.totalRows).toBe(41)
    expect(sent(/WHERE/).length).toBeGreaterThan(0)
  })

  it('lists schemas, tables with their kind and the total, and functions', async () => {
    on(/FROM pg_namespace WHERE nspname NOT LIKE/, { rows: [['public'], ['audit']] })
    on(/FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace\s+WHERE n.nspname = \$1 AND c.relkind IN/, { rows: [['orders', 'r', 120, 2], ['active', 'v', -1, 2]] })
    on(/FROM pg_proc p/, { rows: [[16, 'touch', 'x integer', 'f'], [17, 'purge', '', 'p']] })
    expect(await core.sqlSchemas(connection())).toEqual(['public', 'audit'])
    const tables = await core.sqlTables(connection(), 'public')
    expect(tables.total).toBe(2)
    expect(tables.tables).toEqual([{ schema: 'public', name: 'orders', kind: 'table', approxRows: 120 }, { schema: 'public', name: 'active', kind: 'view' }])
    expect(await core.sqlFunctions(connection(), 'public')).toEqual([{ oid: 16, name: 'touch', args: 'x integer', kind: 'function' }, { oid: 17, name: 'purge', args: '', kind: 'procedure' }])
  })

  it('assembles the details of a table from the catalog', async () => {
    on(/DISTINCT kind/, { rows: [['view', 'public', 'v1']] })
    on(/pg_attrdef/, { rows: [['id', 'integer', false, null, true, 1, 'a', '', null], ['total', 'numeric', true, '(a * b)', false, 2, '', 's', 'sum'], ['note', 'text', true, "'x'::text", false, 3, '', '', null]] })
    on(/pg_get_indexdef/, { rows: [['t_pkey', 'CREATE UNIQUE INDEX t_pkey ON t (id)', true, true]] })
    on(/contype = 'f'/, { rows: [['t_fk', 'FOREIGN KEY (a) REFERENCES o (id)']] })
    on(/contype IN \('p'/, { rows: [['t_pkey', 'p', 'PRIMARY KEY (id)'], ['t_chk', 'c', 'CHECK (id > 0)']] })
    on(/pg_total_relation_size/, { rows: [['r', 'me', 'people', 16384, 12]] })
    on(/aclexplode/, { rows: [['me', 'SELECT', true]] })
    const details = await core.sqlTable(connection(), 'public', 't')
    expect(details.columns[0]).toMatchObject({ name: 'id', primaryKey: true, identity: 'always' })
    expect(details.columns[1]).toMatchObject({ name: 'total', generated: '(a * b)', comment: 'sum' })
    expect(details.columns[1]).not.toHaveProperty('default')
    expect(details.columns[2]).toMatchObject({ default: "'x'::text" })
    expect(details.indexes[0]).toMatchObject({ name: 't_pkey', unique: true, primary: true })
    expect(details.constraints.map(item => item.kind)).toEqual(['primary', 'check'])
    expect(details.foreignKeys).toEqual([{ name: 't_fk', definition: 'FOREIGN KEY (a) REFERENCES o (id)' }])
    expect(details.dependents).toEqual([{ kind: 'view', schema: 'public', name: 'v1' }])
    expect(details.privileges).toEqual([{ grantee: 'me', privilege: 'SELECT', grantable: true }])
    expect(details.properties).toEqual({ kind: 'table', owner: 'me', comment: 'people', sizeBytes: 16384, estimatedRows: 12 })
  })

  it('lists databases, roles, extensions, sequences, types and triggers', async () => {
    on(/FROM pg_database d/, { rows: [['app', 'me', 'UTF8', 8192, -1, true], ['other', 'me', 'UTF8', null, 5, false]] })
    on(/FROM pg_roles r/, { rows: [['me', true, true, true, true, false, -1, ['admins']], ['ro', false, false, false, true, false, 3, null]] })
    on(/FROM pg_extension/, { rows: [['pgcrypto', '1.3', 'public']] })
    on(/FROM pg_sequences WHERE schemaname = \$1 ORDER BY/, { rows: [['seq', 'bigint', 9], ['unused', 'integer', null]] })
    on(/FROM pg_type t JOIN pg_namespace n/, { rows: [[1, 'mood', 'e', 'sad\nhappy'], [2, 'pt', 'c', null]] })
    on(/FROM pg_trigger t/, { rows: [[3, 'trg', 'orders', 'CREATE TRIGGER trg ...', true]] })
    expect(await core.sqlDatabases(connection())).toEqual([
      { name: 'app', owner: 'me', encoding: 'UTF8', sizeBytes: 8192, connectionLimit: -1, current: true },
      { name: 'other', owner: 'me', encoding: 'UTF8', sizeBytes: null, connectionLimit: 5, current: false }])
    const roles = await core.sqlRoles(connection())
    expect(roles[0]).toMatchObject({ name: 'me', superuser: true, memberOf: ['admins'] })
    expect(roles[1]?.memberOf).toEqual([])
    expect(await core.sqlExtensions(connection())).toEqual([{ name: 'pgcrypto', version: '1.3', schema: 'public' }])
    const objects = await core.sqlObjects(connection(), 'public')
    expect(objects.sequences).toEqual([{ name: 'seq', dataType: 'bigint', lastValue: 9 }, { name: 'unused', dataType: 'integer', lastValue: null }])
    expect(objects.types).toEqual([{ oid: 1, name: 'mood', kind: 'enum', values: ['sad', 'happy'] }, { oid: 2, name: 'pt', kind: 'composite' }])
    expect(objects.triggers[0]).toMatchObject({ name: 'trg', table: 'orders', enabled: true })
    expect(objects.truncated).toBe(false)
  })

  it('searches by name across schemas, escaping the pattern', async () => {
    on(/SELECT \* FROM \(/, (_sql, values) => ({ rows: [['table', 'public', 'users_100', null, null], ['function', 'public', 'users_fn', 'x integer', 7]], fields: [], command: String(values[0]) }))
    expect(await core.sqlSearch(connection(), '  ')).toEqual({ hits: [], truncated: false })
    const found = await core.sqlSearch(connection(), '100%_x')
    expect(found.hits).toEqual([{ kind: 'table', schema: 'public', name: 'users_100' }, { kind: 'function', schema: 'public', name: 'users_fn', args: 'x integer', oid: 7 }])
    expect(server.log.some(entry => entry.includes('ILIKE'))).toBe(true)
  })

  it('re-creates the definition of a table, view, function, sequence, trigger and type', async () => {
    on(/a\.attgenerated\s+FROM pg_attribute a LEFT JOIN pg_attrdef/, { rows: [['id', 'integer', true, null, ''], ['sum', 'numeric', false, '(a + b)', 's'], ['note', 'text', false, "'x'", '']] })
    on(/FROM pg_indexes/, { rows: [['CREATE INDEX t_note ON public.t (note)']] })
    on(/FROM pg_constraint WHERE conrelid = to_regclass/, { rows: [['t_pkey', 'PRIMARY KEY (id)']] })
    on(/pg_get_viewdef/, { rows: [['m', '  SELECT 1  ']] })
    on(/pg_get_functiondef/, { rows: [['CREATE FUNCTION f() ...']] })
    on(/FROM pg_sequences WHERE schemaname = \$1 AND sequencename/, { rows: [['bigint', 1, 1, 100, 1, true, 5]] })
    on(/pg_get_triggerdef/, { rows: [['CREATE TRIGGER trg ...']] })
    const table = (await core.sqlDefinition(connection(), { kind: 'table', schema: 'public', name: 't' })).text
    expect(table).toContain('"id" integer NOT NULL')
    expect(table).toContain('GENERATED ALWAYS AS ((a + b)) STORED')
    expect(table).toContain("DEFAULT 'x'")
    expect(table).toContain('CONSTRAINT "t_pkey" PRIMARY KEY (id)')
    expect(table).toContain('CREATE INDEX t_note')
    expect((await core.sqlDefinition(connection(), { kind: 'view', schema: 'public', name: 'v' })).text).toBe('CREATE MATERIALIZED VIEW "public"."v" AS\nSELECT 1')
    expect((await core.sqlDefinition(connection(), { kind: 'function', oid: 5 } as never)).text).toBe('CREATE FUNCTION f() ...')
    expect((await core.sqlDefinition(connection(), { kind: 'sequence', schema: 'public', name: 's' })).text).toContain('CYCLE')
    expect((await core.sqlDefinition(connection(), { kind: 'trigger', oid: 9 } as never)).text).toBe('CREATE TRIGGER trg ...;')
    expect((await failure(() => core.sqlDefinition(connection(), { kind: 'function', oid: 0 } as never))).message).toMatch(/Choose a function/)
    expect((await failure(() => core.sqlDefinition(connection(), { kind: 'trigger', oid: -1 } as never))).message).toMatch(/Choose an object/)
  })

  it('re-creates enum, composite and domain types, and says when a type is gone', async () => {
    const info = (type: string, extra: unknown[] = []): Reply => ({ rows: [['public', 'ty', type, 77, 'integer', true, '0', ...extra]] })
    on(/FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.oid = \$1::oid/, (_sql, values) => values[0] === 1 ? info('e') : values[0] === 2 ? info('c') : values[0] === 3 ? info('d') : values[0] === 4 ? info('r') : { rows: [] })
    on(/FROM pg_enum WHERE enumtypid/, { rows: [["it's"], ['b']] })
    on(/FROM pg_attribute WHERE attrelid = \$1::oid/, { rows: [['x', 'integer'], ['y', 'text']] })
    const text = async (oid: number): Promise<string> => (await core.sqlDefinition(connection(), { kind: 'type', oid } as never)).text
    expect(await text(1)).toBe(`CREATE TYPE "public"."ty" AS ENUM ('it''s', 'b');`)
    expect(await text(2)).toBe('CREATE TYPE "public"."ty" AS (\n  "x" integer,\n  "y" text\n);')
    expect(await text(3)).toBe('CREATE DOMAIN "public"."ty" AS integer DEFAULT 0 NOT NULL;')
    expect(await text(4)).toMatch(/range type/)
    expect((await failure(() => text(5))).message).toMatch(/no longer exists/)
  })
})

describe('editing rows', () => {
  const columns: Reply = { rows: [['id', 'integer', true, true, false], ['email', 'text', false, false, false]] }
  const table = (relkind: string, key: string[] | null = ['id']): void => {
    on(/SELECT c\.relkind FROM pg_class c/, { rows: [[relkind]] })
    on(/a\.atthasdef/, columns)
    on(/SELECT a\.attname FROM pg_index i/, { rows: (key ?? []).map(name => [name]) })
    on(/array_agg\(a\.attname/, { rows: [[null]] })
  }

  it('says why a table cannot be edited', async () => {
    table('r', [])
    expect(await core.sqlEditability(connection(), 'public', 't')).toMatchObject({ editable: false, reason: expect.stringMatching(/no primary key/) })
    server.rules.length = 0; table('v')
    expect(await core.sqlEditability(connection(), 'public', 'v')).toMatchObject({ editable: false, reason: expect.stringMatching(/Only tables/) })
    server.rules.length = 0; table('r')
    expect(await core.sqlEditability(connection({ readOnly: true }), 'public', 't')).toMatchObject({ editable: false, reason: expect.stringMatching(/read-only/) })
    expect(await core.sqlEditability(connection(), 'public', 't')).toMatchObject({ editable: true, columns: [{ name: 'id', key: true }, { name: 'email', key: false }] })
  })

  it('finds the key of a table that has only a unique NOT NULL index', async () => {
    table('r', [])
    server.rules.unshift({ match: /array_agg\(a\.attname/, answer: { rows: [['{id}']] } })
    expect(await core.sqlEditability(connection(), 'public', 't')).toMatchObject({ editable: true })
  })

  const update = { kind: 'update', key: { id: 1 }, set: { email: 'b@example.com' }, old: { email: 'a@example.com' } } as const

  it('previews the statements a change would run', async () => {
    table('r')
    const lines = await core.sqlPreviewChanges(connection(), { schema: 'public', table: 't', changes: [update as never] })
    expect(lines[0]).toMatch(/^UPDATE "public"."t" SET "email"/)
  })

  it('applies changes in one transaction and commits', async () => {
    table('r')
    on(/^UPDATE/, { command: 'UPDATE', rowCount: 1 })
    const result = await core.sqlApply(connection(), { schema: 'public', table: 't', changes: [update as never] })
    expect(result.applied).toBe(1)
    expect(sent(/^BEGIN$/)).toHaveLength(1)
    expect(sent(/^COMMIT$/)).toHaveLength(1)
  })

  it('rolls everything back when a row was changed by someone else', async () => {
    table('r')
    on(/^UPDATE/, { command: 'UPDATE', rowCount: 0 })
    const error = await failure(() => core.sqlApply(connection(), { schema: 'public', table: 't', changes: [update as never] }))
    expect(error.code).toBe('conflict')
    expect(sent(/^COMMIT$/)).toHaveLength(0)
    expect(server.log.at(-1)).toBe('ROLLBACK')
  })

  it('rolls back and reports a database error without the password', async () => {
    table('r')
    on(/^UPDATE/, () => { throw new Error('duplicate key value (hunter2)') })
    const error = await failure(() => core.sqlApply(connection(), { schema: 'public', table: 't', changes: [update as never] }))
    expect(error).toMatchObject({ code: 'query' })
    expect(error.message).not.toContain('hunter2')
    expect(sent(/^COMMIT$/)).toHaveLength(0)
    expect(server.log.at(-1)).toBe('ROLLBACK')
  })

  it('refuses to edit on a read-only connection and on a table that cannot be edited', async () => {
    expect((await failure(() => core.sqlApply(connection({ readOnly: true }), { schema: 'public', table: 't', changes: [] }))).code).toBe('read-only')
    table('v')
    expect((await failure(() => core.sqlApply(connection(), { schema: 'public', table: 'v', changes: [update as never] }))).message).toMatch(/Only tables/)
  })
})

describe('structure, maintenance and databases', () => {
  it('previews a plan without touching the server', () => {
    const plan = core.structurePreview(connection(), { schema: 'public', table: 't', action: { kind: 'drop' } })
    expect(plan.destructive).toBe(true)
    expect(plan.statements[0]).toContain('DROP TABLE')
    expect(server.log).toEqual([])
  })

  it('needs confirmation for destructive plans and for any change on a production connection', async () => {
    expect((await failure(() => core.structureApply(connection(), { schema: 'public', table: 't', action: { kind: 'drop' } }))).code).toBe('confirm')
    const prod = connection({ environment: 'prod' })
    expect((await failure(() => core.structureApply(prod, { schema: 'public', table: 't', action: { kind: 'alter', changes: [{ op: 'renameTable', to: 'u' }] } }))).message).toMatch(/production/)
    expect((await failure(() => core.structureApply(connection({ readOnly: true }), { schema: 'public', table: 't', action: { kind: 'drop' }, confirmed: true }))).code).toBe('read-only')
  })

  it('applies a plan inside one transaction, and rolls it back when a statement fails', async () => {
    const applied = await core.structureApply(connection(), { schema: 'public', table: 't', action: { kind: 'alter', changes: [{ op: 'renameTable', to: 'u' }] } })
    expect(applied.applied).toBe(true)
    expect(server.log).toEqual(['BEGIN', expect.stringContaining('RENAME TO'), 'COMMIT'])
    server.log.length = 0
    on(/RENAME/, () => { throw Object.assign(new Error('relation "u" already exists'), { code: '42P07' }) })
    const error = await failure(() => core.structureApply(connection(), { schema: 'public', table: 't', action: { kind: 'alter', changes: [{ op: 'renameTable', to: 'u' }] } }))
    expect(error).toMatchObject({ code: 'query', detail: { sqlState: '42P07' } })
    expect(server.log).toEqual(['BEGIN', expect.stringContaining('RENAME'), 'ROLLBACK'])
  })

  it('copies only writable columns when duplicating a table with its data', async () => {
    on(/information_schema\.columns/, { rows: [['id'], ['email']] })
    const result = await core.structureApply(connection(), { schema: 'public', table: 't', action: { kind: 'duplicate', to: 'copy', withData: true } })
    expect(result.applied).toBe(true)
    expect(sent(/INSERT INTO/).join(' ')).toContain('"id", "email"')
  })

  it('runs maintenance as a single statement, and asks before REINDEX', async () => {
    expect((await core.maintenance(connection(), { schema: 'public', table: 't', action: 'analyze' })).statement).toContain('ANALYZE')
    expect((await failure(() => core.maintenance(connection(), { schema: 'public', table: 't', action: 'reindex' }))).code).toBe('confirm')
    expect((await core.maintenance(connection(), { schema: 'public', table: 't', action: 'reindex', confirmed: true })).statement).toContain('REINDEX')
    expect((await failure(() => core.maintenance(connection({ readOnly: true }), { schema: 'public', table: 't', action: 'vacuum' }))).code).toBe('read-only')
    on(/VACUUM/, () => { throw new Error('cannot vacuum (hunter2)') })
    const error = await failure(() => core.maintenance(connection(), { schema: 'public', table: 't', action: 'vacuum' }))
    expect(error.message).not.toContain('hunter2')
  })

  it('creates and drops databases with the guards in place', async () => {
    await core.sqlCreateDatabase(connection(), { name: 'shop', owner: 'me', template: 'template0', encoding: 'UTF8' })
    expect(sent(/CREATE DATABASE/)[0]).toBe('CREATE DATABASE "shop" OWNER "me" TEMPLATE "template0" ENCODING \'UTF8\'')
    expect((await failure(() => core.sqlCreateDatabase(connection(), { name: 'x', encoding: 'KOI8' }))).code).toBe('invalid')
    expect((await failure(() => core.sqlCreateDatabase(connection({ readOnly: true }), { name: 'x' }))).code).toBe('read-only')
    expect((await failure(() => core.sqlDropDatabase(connection(), { name: 'app', confirmed: true }))).message).toMatch(/using that database/)
    expect((await failure(() => core.sqlDropDatabase(connection(), { name: 'shop' }))).code).toBe('confirm')
    expect((await failure(() => core.sqlDropDatabase(connection({ readOnly: true }), { name: 'shop', confirmed: true }))).code).toBe('read-only')
    await core.sqlDropDatabase(connection(), { name: 'shop', confirmed: true })
    expect(sent(/DROP DATABASE/)).toEqual(['DROP DATABASE "shop"'])
  })
})

describe('EXPLAIN', () => {
  const plan = [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'users', 'Total Cost': 12.5, 'Plan Rows': 1000, 'Plan Width': 8, 'Startup Cost': 0 }, 'Planning Time': 0.2, 'Execution Time': 1.5 }]

  it('explains a statement inside a READ ONLY transaction that is rolled back', async () => {
    on(/^EXPLAIN/, { rows: [[JSON.stringify(plan)]] })
    const result = await core.sqlExplain(connection(), { sql: 'SELECT * FROM users;' })
    expect(result).toMatchObject({ analyze: false, planningMs: 0.2, executionMs: 1.5 })
    expect(result.plan.nodeType).toBe('Seq Scan')
    expect(server.log[0]).toBe('BEGIN READ ONLY')
    expect(server.log).toContain('EXPLAIN (FORMAT JSON) SELECT * FROM users')
    expect(server.log.at(-1)).toBe('ROLLBACK')
  })

  it('analyzes a data change in a transaction that is never committed, and refuses it on read-only', async () => {
    on(/^EXPLAIN/, { rows: [[plan]] })
    await core.sqlExplain(connection(), { sql: 'DELETE FROM users WHERE id = 1', analyze: true })
    expect(server.log[0]).toBe('BEGIN')
    expect(sent(/COMMIT/)).toHaveLength(0)
    expect((await failure(() => core.sqlExplain(connection({ readOnly: true }), { sql: 'DELETE FROM users WHERE id = 1', analyze: true }))).code).toBe('read-only')
  })

  it('refuses what it cannot explain', async () => {
    expect((await failure(() => core.sqlExplain(connection(), { sql: ' ' }))).message).toMatch(/nothing to explain/)
    expect((await failure(() => core.sqlExplain(connection(), { sql: 'SELECT 1; SELECT 2' }))).message).toMatch(/one statement/)
    expect((await failure(() => core.sqlExplain(connection(), { sql: '-- c\nEXPLAIN SELECT 1' }))).message).toMatch(/without EXPLAIN/)
  })

  it('names a cancelled, timed-out or failed EXPLAIN', async () => {
    on(/a_cancel/, () => { throw new Error('canceling statement due to user request') })
    on(/a_slow/, () => { throw new Error('canceling statement due to statement timeout') })
    on(/a_bad/, () => { throw new Error('column does not exist (hunter2)') })
    expect((await failure(() => core.sqlExplain(connection(), { sql: 'SELECT a_cancel' }))).code).toBe('cancelled')
    expect((await failure(() => core.sqlExplain(connection(), { sql: 'SELECT a_slow' }))).code).toBe('timeout')
    const error = await failure(() => core.sqlExplain(connection(), { sql: 'SELECT a_bad' }))
    expect(error.code).toBe('query')
    expect(error.message).not.toContain('hunter2')
  })
})

describe('testing a connection', () => {
  it('reports the server version and the latency, or the reason it failed', async () => {
    on(/SELECT version\(\)/, { rows: [['PostgreSQL 16.3 on x86_64-pc-linux-gnu']], fields: [{ name: 'version', dataTypeID: 25 }] })
    expect(await core.test(connection())).toMatchObject({ ok: true, serverVersion: 'PostgreSQL 16.3' })
    await core.closeConnection('c1')
    server.connectError = new Error('connect ECONNREFUSED 127.0.0.1:5432')
    const failed = await core.test(connection())
    expect(failed).toMatchObject({ ok: false, code: 'connect' })
    expect(failed.message).toMatch(/ECONNREFUSED/)
  })

  it('knows which drivers are present', () => {
    expect(core.drivers().postgres).toBe(true)
  })
})

describe('load more', () => {
  const numbers = { fields: [{ name: 'n', dataTypeID: 23 }], rows: Array.from({ length: 12 }, (_, index) => [index + 1]), command: 'SELECT', rowCount: 12 }

  it('keeps a long SELECT open and reads it page by page until it runs out', async () => {
    on(/FROM numbers/, numbers)
    const first = await core.sqlRun(connection(), 'SELECT n FROM numbers', { maxRows: 5, paged: true })
    expect(first.rows.flat()).toEqual([1, 2, 3, 4, 5])
    expect(first).toMatchObject({ truncated: true, limitedBy: 'rows' })
    expect(first.pageId).toBeTruthy()
    const second = await core.sqlMore(connection(), first.pageId!, 5)
    expect(second.rows.flat()).toEqual([6, 7, 8, 9, 10])
    expect(second.pageId).toBe(first.pageId)
    const last = await core.sqlMore(connection(), first.pageId!, 5)
    expect(last.rows.flat()).toEqual([11, 12])
    expect(last).toMatchObject({ truncated: false })
    expect(last.pageId).toBeUndefined()
    expect((await failure(() => core.sqlMore(connection(), first.pageId!, 5))).message).toMatch(/no longer open/)
  })

  it('holds the read-only transaction while the page is open and rolls it back when it closes', async () => {
    on(/FROM numbers/, numbers)
    const first = await core.sqlRun(connection({ readOnly: true }), 'SELECT n FROM numbers', { maxRows: 10, paged: true })
    expect(sent(/^(BEGIN READ ONLY|ROLLBACK)$/)).toEqual(['BEGIN READ ONLY'])
    await core.sqlMore(connection({ readOnly: true }), first.pageId!, 10)
    expect(sent(/^(BEGIN READ ONLY|ROLLBACK)$/)).toEqual(['BEGIN READ ONLY', 'ROLLBACK'])
  })

  it('reads the catalog on a second client while a page is open, without closing it', async () => {
    on(/FROM numbers/, numbers)
    on(/FROM pg_namespace/, { fields: [{ name: 'nspname', dataTypeID: 25 }], rows: [['public']] })
    const first = await core.sqlRun(connection(), 'SELECT n FROM numbers', { maxRows: 5, paged: true })
    expect(server.clients).toBe(1)
    expect(await core.sqlSchemas(connection())).toEqual(['public'])
    expect(server.clients).toBe(2)
    expect((await core.sqlMore(connection(), first.pageId!, 5)).rows.flat()).toEqual([6, 7, 8, 9, 10])
  })

  it('closes the page when anything else runs on the connection', async () => {
    on(/FROM numbers/, numbers)
    const first = await core.sqlRun(connection(), 'SELECT n FROM numbers', { maxRows: 5, paged: true })
    await core.sqlRun(connection(), 'SELECT 1')
    expect(server.closedCursors).toBe(2)
    expect((await failure(() => core.sqlMore(connection(), first.pageId!, 5))).message).toMatch(/no longer open/)
  })

  it('pages only a single read statement asked to page; a write or a run without the flag closes its cursor', async () => {
    on(/FROM numbers/, numbers)
    on(/RETURNING/, numbers)
    expect((await core.sqlRun(connection(), 'SELECT n FROM numbers', { maxRows: 5 })).pageId).toBeUndefined()
    expect((await core.sqlRun(connection(), 'UPDATE t SET a = 1 WHERE b = 2 RETURNING n', { maxRows: 5, paged: true })).pageId).toBeUndefined()
  })
})
