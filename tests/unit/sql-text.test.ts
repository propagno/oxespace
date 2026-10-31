import { describe, expect, it } from 'vitest'
import { hasTopLevelOrderBy, namedToPositional, scanParameters, splitStatements, statementAt } from '../../shared/sqlText'

describe('splitStatements', () => {
  it('splits on top-level semicolons and keeps positions', () => {
    const sql = 'SELECT 1;\n  SELECT 2 ;SELECT 3'
    const spans = splitStatements(sql)
    expect(spans.map(span => span.text)).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3'])
    for (const span of spans) expect(sql.slice(span.start, span.end)).toBe(span.text)
  })

  it('ignores semicolons in strings, identifiers, comments and dollar-quoted bodies', () => {
    const sql = [
      "SELECT 'a;b', \"c;d\"; -- trailing; comment",
      '/* block; /* nested; */ still */ SELECT 2;',
      "CREATE FUNCTION f() RETURNS int AS $body$ BEGIN RETURN 1; END; $body$ LANGUAGE plpgsql;",
      String.raw`SELECT E'it\'s; ok', 'it''s; ok'`
    ].join('\n')
    expect(splitStatements(sql).map(span => span.text.slice(0, 22))).toEqual(["SELECT 'a;b', \"c;d\"", 'SELECT 2', 'CREATE FUNCTION f() RE', String.raw`SELECT E'it\'s; ok', '`])
  })

  it('drops fragments that are only whitespace or comments', () => {
    expect(splitStatements(' ;; -- nothing\n; /* x */ ')).toEqual([])
    expect(splitStatements('')).toEqual([])
  })
})

describe('statementAt', () => {
  const sql = 'SELECT 1;\nSELECT 2;\n\nSELECT 3'
  it('picks the statement under the cursor', () => {
    expect(statementAt(sql, 3)?.text).toBe('SELECT 1')
    expect(statementAt(sql, 12)?.text).toBe('SELECT 2')
    expect(statementAt(sql, sql.length)?.text).toBe('SELECT 3')
  })

  it('picks the previous statement from the gap right after a semicolon or a blank line', () => {
    expect(statementAt(sql, 9)?.text).toBe('SELECT 1')
    expect(statementAt(sql, 20)?.text).toBe('SELECT 2')
    expect(statementAt('   ', 1)).toBeNull()
  })
})

describe('parameters', () => {
  it('finds named and positional parameters outside strings, comments and casts', () => {
    expect(scanParameters("SELECT * FROM t WHERE id = :id AND at > :since AND note = ':fake' -- :comment\n AND x::int > :id")).toEqual({ kind: 'named', names: ['id', 'since'] })
    expect(scanParameters('SELECT $2, $1, $2')).toEqual({ kind: 'positional', names: ['1', '2'] })
    expect(scanParameters("SELECT a[1:2], 'x' || $$ :no $1 $$, 12::text")).toEqual({ kind: 'none', names: [] })
  })

  it('rewrites named parameters to numbered ones, one number per name', () => {
    expect(namedToPositional('SELECT :a, :b, :a, x::int, \':a\'')).toEqual({ sql: "SELECT $1, $2, $1, x::int, ':a'", names: ['a', 'b'] })
  })
})

describe('hasTopLevelOrderBy', () => {
  it('sees an ORDER BY only at the top level', () => {
    expect(hasTopLevelOrderBy('SELECT * FROM t ORDER BY id')).toBe(true)
    expect(hasTopLevelOrderBy('select * from t order\n  by id desc')).toBe(true)
    expect(hasTopLevelOrderBy('SELECT * FROM (SELECT * FROM t ORDER BY id) q')).toBe(false)
    expect(hasTopLevelOrderBy("SELECT 'ORDER BY' FROM t -- ORDER BY x")).toBe(false)
  })
})
