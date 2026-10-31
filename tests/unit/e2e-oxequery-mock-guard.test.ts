import { describe, expect, it } from 'vitest'
import { commandOf, refuseSql } from '../../electron/main/e2e/oxequery-mock-guard'

const prod = { name: 'pg-dev', environment: 'prod', readOnly: false }
const dev = { name: 'pg-dev', environment: 'dev', readOnly: false }
const readOnly = { name: 'pg-dev', environment: 'dev', readOnly: true }
const codesOf = (refusal: ReturnType<typeof refuseSql>): string[] => (refusal?.codes ?? []).map(message => message.code)

describe('E2E OxeQuery mock: the real guard decides', () => {
  it('lets reads through everywhere and asks nothing', () => {
    for (const target of [prod, dev, readOnly]) {
      expect(refuseSql(target, 'SELECT * FROM users', {})).toBeNull()
      expect(refuseSql(target, 'SELECT 1; SELECT 2;', {})).toBeNull()
      expect(refuseSql(target, 'EXPLAIN SELECT 1', {})).toBeNull()
    }
  })

  it('asks production for its exact name before any write, with the guard reasons', () => {
    expect(refuseSql(prod, "UPDATE users SET name = 'x' WHERE id = 1", {})).toMatchObject({ code: 'confirm-name' })
    expect(refuseSql(prod, "UPDATE users SET name = 'x' WHERE id = 1", { confirmName: 'PG-DEV' })).toMatchObject({ code: 'confirm-name' })
    expect(refuseSql(prod, "UPDATE users SET name = 'x' WHERE id = 1", { confirmName: 'pg-dev' })).toBeNull()
    expect(codesOf(refuseSql(prod, 'DO $$ BEGIN DELETE FROM users; END $$', {}))).toEqual(['oxequery.sql.doBlock', 'oxequery.sql.destructiveInside'])
    expect(codesOf(refuseSql(prod, "COPY users TO PROGRAM 'id'", {}))).toEqual(['oxequery.sql.copyProgram'])
    expect(codesOf(refuseSql(prod, 'SELECT * FROM users FOR UPDATE', {}))).toEqual(['oxequery.sql.rowLock'])
    expect(refuseSql(prod, 'WITH d AS (DELETE FROM users RETURNING *) SELECT * FROM d', {})).toMatchObject({ code: 'confirm-name', reasons: [expect.stringMatching(/WHERE/)] })
    expect(refuseSql(prod, 'SELECT 1;\nDELETE FROM users', {})).toMatchObject({ code: 'confirm-name', reasons: [expect.stringMatching(/WHERE/)] })
  })

  it('then asks the destructive confirmation, as the worker does', () => {
    expect(refuseSql(prod, 'DO $$ BEGIN DELETE FROM users; END $$', { confirmName: 'pg-dev' })).toMatchObject({ code: 'confirm' })
    expect(refuseSql(prod, 'DO $$ BEGIN DELETE FROM users; END $$', { confirmName: 'pg-dev', confirmed: true })).toBeNull()
    expect(refuseSql(prod, 'SELECT * FROM users FOR UPDATE', { confirmName: 'pg-dev' })).toBeNull()
    expect(refuseSql(dev, 'DELETE FROM users', {})).toMatchObject({ code: 'confirm', reasons: ['DELETE without a WHERE clause affects every row'] })
    expect(refuseSql(dev, 'SELECT 1;\nDELETE FROM users', {})).toMatchObject({ code: 'confirm', message: expect.stringMatching(/script/) })
    expect(refuseSql(dev, 'DELETE FROM users', { confirmed: true })).toBeNull()
    expect(refuseSql(dev, 'DELETE FROM users WHERE id = 1', {})).toBeNull()
  })

  it('refuses every write on a read-only connection first', () => {
    expect(refuseSql(readOnly, 'DELETE FROM users', {})).toMatchObject({ code: 'read-only' })
    expect(refuseSql(readOnly, 'CREATE TABLE t (id int)', {})).toMatchObject({ code: 'read-only' })
    expect(refuseSql({ ...prod, readOnly: true }, 'DELETE FROM users', { confirmName: 'pg-dev', confirmed: true })).toMatchObject({ code: 'read-only' })
  })

  it('reports the statement verb the way the server would', () => {
    expect(commandOf("UPDATE users SET name = 'x'")).toBe('UPDATE')
    expect(commandOf('-- note\n  delete from users')).toBe('DELETE')
    expect(commandOf('CREATE TABLE t (id int)')).toBe('CREATE')
  })
})
