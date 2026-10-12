import { describe, expect, it } from 'vitest'
import { guardSql, isMutating, quoteIdentifier } from '../../electron/main/services/oxequery/sql-guard'
import { MongoInputError, parseDocument, parsePipeline, toEjson } from '../../electron/main/services/oxequery/mongo-guard'

describe('SQL guard', () => {
  it.each([
    ['SELECT * FROM users', 'read'],
    ['  -- comment\n SELECT 1;', 'read'],
    ['/* DROP TABLE x */ SELECT 1', 'read'],
    ["SELECT 'DROP TABLE users; DELETE FROM x'", 'read'],
    ['SELECT $$DELETE FROM users$$', 'read'],
    ['WITH a AS (SELECT 1) SELECT * FROM a', 'read'],
    ['EXPLAIN SELECT * FROM t', 'read'],
    ['SHOW search_path', 'read'],
    ['INSERT INTO t VALUES (1)', 'write'],
    ['UPDATE t SET a = 1 WHERE id = 2', 'write'],
    ['DELETE FROM t WHERE id = 1', 'write'],
    ['CREATE TABLE t (id int)', 'ddl'],
    ['SET default_transaction_read_only = off', 'ddl'],
    ['SELECT * INTO copy FROM t', 'ddl'],
    ['DROP TABLE t', 'destructive'],
    ['TRUNCATE t', 'destructive'],
    ['DELETE FROM t', 'destructive'],
    ['UPDATE t SET a = 1', 'destructive'],
    ['ALTER TABLE t DROP COLUMN a', 'destructive'],
    ['', 'empty'],
    ['   ;  ; ', 'empty']
  ] as const)('classifies %j as %s', (sql, kind) => {
    expect(guardSql(sql).kind).toBe(kind)
  })

  it('takes the most severe statement of a batch', () => {
    const verdict = guardSql('SELECT 1; DELETE FROM users; SELECT 2')
    expect(verdict).toMatchObject({ kind: 'destructive', statements: 3 })
    expect(verdict.reasons[0]).toMatch(/WHERE/)
    expect(isMutating(verdict)).toBe(true)
    expect(isMutating(guardSql('SELECT 1'))).toBe(false)
  })

  it('does not treat a data-modifying CTE as a read', () => {
    expect(guardSql('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d').kind).toBe('destructive')
    expect(guardSql('WITH d AS (DELETE FROM t WHERE id = 1 RETURNING *) SELECT * FROM d').kind).toBe('write')
    expect(guardSql('WITH i AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM i').kind).toBe('write')
  })

  it('sees past quoted identifiers and escape strings', () => {
    expect(guardSql('SELECT "drop" FROM "delete"').kind).toBe('read')
    expect(guardSql("SELECT E'it\\'s; DROP TABLE x'").kind).toBe('read')
    expect(guardSql("SELECT 'a'; DROP TABLE x").kind).toBe('destructive')
  })

  it('quotes identifiers safely', () => {
    expect(quoteIdentifier('users')).toBe('"users"')
    expect(quoteIdentifier('we"ird')).toBe('"we""ird"')
    expect(() => quoteIdentifier('')).toThrow()
    expect(() => quoteIdentifier('a\0b')).toThrow()
  })
})

describe('Mongo guard', () => {
  it('parses relaxed EJSON filters and keeps BSON types', () => {
    const filter = parseDocument('{ "_id": { "$oid": "507f1f77bcf86cd799439011" }, "n": { "$gt": 3 } }', 'Filter')
    expect(String((filter._id as { toHexString(): string }).toHexString())).toBe('507f1f77bcf86cd799439011')
    expect(parseDocument('', 'Filter')).toEqual({})
  })

  it('rejects server-side JavaScript anywhere in a filter or a pipeline', () => {
    expect(() => parseDocument('{ "$where": "this.a > 1" }', 'Filter')).toThrow(MongoInputError)
    expect(() => parseDocument('{ "a": { "$or": [ { "$where": "1" } ] } }', 'Filter')).toThrow(/server-side/)
    expect(() => parsePipeline('[{ "$addFields": { "x": { "$function": { "body": "1", "args": [], "lang": "js" } } } }]', false)).toThrow(/server-side/)
  })

  it('refuses writing stages and non-array pipelines', () => {
    expect(() => parsePipeline('[{ "$out": "copy" }]', true)).toThrow(/read-only/)
    expect(() => parsePipeline('[{ "$merge": { "into": "x" } }]', false)).toThrow(/not supported/)
    expect(() => parsePipeline('{ "$match": {} }', false)).toThrow(/array/)
    expect(() => parsePipeline('not json', false)).toThrow(MongoInputError)
    expect(parsePipeline('[{ "$match": { "a": 1 } }, { "$limit": 5 }]', true)).toHaveLength(2)
  })

  it('truncates very large documents', () => {
    const result = toEjson({ text: 'x'.repeat(200_000) }, 1000)
    expect(result.truncated).toBe(true)
    expect(result.text.length).toBe(1000)
  })
})
