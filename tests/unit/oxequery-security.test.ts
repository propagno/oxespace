import { describe, expect, it } from 'vitest'
import { guardSql, outsideReach } from '../../electron/main/services/oxequery/sql-guard'
import { buildStatements, type ColumnMeta } from '../../electron/main/services/oxequery/table-editor'
import { redact } from '../../electron/main/services/oxequery/oxequery-core'
import { csvField } from '../../electron/main/services/oxequery/export-writer'
import { assertContainerId, assertExecArgv } from '../../electron/main/services/oxepod/container-runtime'

describe('security: SQL that must never be classified as a plain read', () => {
  const reaching = [
    "SELECT pg_read_file('/etc/passwd')",
    "SELECT pg_catalog.pg_read_file('/etc/passwd')",
    "SELECT \"pg_read_file\"('/etc/passwd')",
    "SELECT PG_READ_FILE ( '/etc/passwd' )",
    "SELECT lo_import('/etc/passwd')",
    "SELECT * FROM dblink('host=evil', 'select 1') AS t(a int)",
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity",
    "SELECT set_config('transaction_read_only', 'off', false)",
    "SELECT query_to_xml('select pg_read_file(''/etc/passwd'')', true, false, '')",
    "SELECT /* hide */ pg_ls_dir('/')",
    "SELECT pg_advisory_lock(1)",
    "SELECT nextval('s')"
  ]
  it.each(reaching)('%s', sql => {
    expect(guardSql(sql).kind).not.toBe('read')
    expect(outsideReach(sql).length).toBeGreaterThan(0)
  })

  const hidden = [
    "SELECT 'pg_read_file(' || 'x'",
    "SELECT $$pg_read_file('x')$$",
    "SELECT 1 -- pg_read_file('x')",
    "SELECT 1 /* lo_import('x') */",
    "SELECT E'\\'pg_read_file(\\'' AS note",
    "SELECT * FROM pg_read_files_report",
    "SELECT my_set_config_view.value FROM my_set_config_view"
  ]
  it.each(hidden)('does not flag %s', sql => {
    expect(outsideReach(sql)).toEqual([])
    expect(guardSql(sql).kind).toBe('read')
  })

  const writes = [
    'SELECT 1; DELETE FROM t', "COPY t TO PROGRAM 'id'", 'DO $$ BEGIN PERFORM 1; END $$', 'CALL p()', 'PREPARE x AS DELETE FROM t',
    'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'SELECT * INTO copy FROM t', 'EXPLAIN ANALYZE UPDATE t SET a = 1',
    'SET ROLE postgres', 'ALTER SYSTEM SET fsync = off', 'CREATE EXTENSION dblink', 'GRANT ALL ON t TO PUBLIC', 'LISTEN chan', 'VACUUM FULL t'
  ]
  it.each(writes)('classifies %s as not a read', sql => { expect(guardSql(sql).kind).not.toBe('read') })
})

describe('security: generated statements', () => {
  const columns: ColumnMeta[] = [
    { name: 'id', type: 'integer', nullable: false, hasDefault: true, generated: false, key: true },
    { name: 'name"; DROP TABLE t; --', type: 'text', nullable: true, hasDefault: false, generated: false, key: false }
  ]
  it('quotes identifiers and never puts a value into the statement text', () => {
    const [statement] = buildStatements('pub"lic', 'ta"ble', columns, [{ kind: 'update', key: { id: 1 }, set: { 'name"; DROP TABLE t; --': "x'); DROP TABLE t; --" } }])
    expect(statement.text).toContain('"pub""lic"."ta""ble"')
    expect(statement.text).toContain('"name""; DROP TABLE t; --"')
    expect(statement.text).not.toContain('DROP TABLE t; --\')')
    expect(statement.values).toContain("x'); DROP TABLE t; --")
  })
  it('refuses a column that is not in the catalog and a hostile type', () => {
    expect(() => buildStatements('public', 't', columns, [{ kind: 'insert', values: { 'nope': 1 } }])).toThrow()
    const hostile: ColumnMeta[] = [{ ...columns[0], type: 'integer); DROP TABLE t; --' }]
    expect(() => buildStatements('public', 't', hostile, [{ kind: 'delete', key: { id: 1 } }])).toThrow()
  })
})

describe('security: exports, secrets and container arguments', () => {
  it('neutralises spreadsheet formulas', () => {
    for (const value of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=1']) expect(csvField(value, ',').replace(/^"/, '').startsWith("'")).toBe(true)
    expect(csvField('-12.5', ',')).toBe('-12.5')
  })
  it('redacts the password from a driver error', () => {
    expect(redact('password authentication failed for user "u" with hunter2xyz', 'hunter2xyz')).not.toContain('hunter2xyz')
  })
  it('accepts only plain container identifiers and argv arrays', () => {
    for (const bad of ['', '-rf', 'a b', 'a;b', '$(id)', '../x', 'a\nb', 'x'.repeat(200)]) expect(() => assertContainerId(bad)).toThrow()
    expect(assertContainerId('pg-dev_1.2')).toBe('pg-dev_1.2')
    expect(() => assertExecArgv('ls -la')).toThrow()
    expect(() => assertExecArgv(['ls', '\0'])).toThrow()
  })
})
