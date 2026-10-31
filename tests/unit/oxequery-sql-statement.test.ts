import { describe, expect, it } from 'vitest'
import { maskSql, parseForeignKey, parseStatement, selectColumns, statementAt } from '../../src/components/OxeQuery/sql-statement'

const parse = (sql: string) => parseStatement(maskSql(sql))

describe('maskSql', () => {
  it('blanks comments and string bodies but keeps offsets and quoted identifiers', () => {
    const sql = "SELECT 'a;b', \"x;y\" -- c;d\nFROM t /* e;f */"
    const masked = maskSql(sql)
    expect(masked).toHaveLength(sql.length)
    expect(masked).not.toContain('a;b')
    expect(masked).toContain('"x;y"')
    expect(masked).not.toContain('c;d')
    expect(masked).not.toContain('e;f')
  })
  it('blanks dollar-quoted bodies', () => {
    expect(maskSql('SELECT $$ FROM secret; $$ FROM t')).not.toContain('secret')
  })
})

describe('statementAt', () => {
  const sql = "SELECT 1; SELECT a FROM t WHERE x = ';'; SELECT 3"
  it('picks the statement around the cursor and ignores semicolons in strings', () => {
    const slice = statementAt(sql, sql.indexOf('WHERE'))
    expect(slice.text.trim()).toBe("SELECT a FROM t WHERE x = ';'")
  })
  it('treats the cursor right after a semicolon as the next statement', () => {
    expect(statementAt(sql, 9).text.trim()).toBe("SELECT a FROM t WHERE x = ';'")
    expect(statementAt(sql, 8).text.trim()).toBe('SELECT 1')
  })
})

describe('parseStatement', () => {
  it('finds aliases with and without AS, schemas and quoted names', () => {
    const { sources } = parse('SELECT * FROM users u JOIN audit.events AS e ON e.id = u.id JOIN "Order Items" oi ON true')
    expect(sources.map(s => [s.key, s.schema, s.table, s.joined])).toEqual([
      ['u', 'public', 'users', false], ['e', 'audit', 'events', true], ['oi', 'public', 'Order Items', true]
    ])
  })
  it('does not take a clause keyword for an alias', () => {
    const { sources } = parse('SELECT * FROM orders WHERE id = 1')
    expect(sources.map(s => s.key)).toEqual(['orders'])
  })
  it('reads comma-separated relations', () => {
    expect(parse('SELECT * FROM users u, orders o WHERE true').sources.map(s => s.key)).toEqual(['u', 'o'])
  })
  it('ignores relation names inside strings and comments', () => {
    expect(parse("SELECT 'FROM ghost' FROM real -- FROM nope").sources.map(s => s.key)).toEqual(['real'])
  })
  it('reads CTEs with their select-list columns and marks uses as cte sources', () => {
    const { ctes, sources } = parse('WITH recent AS (SELECT id, o.total AS amount, count(*) FROM orders o), big (a, b) AS (SELECT 1, 2) SELECT * FROM recent r JOIN big ON true')
    expect(ctes).toEqual([{ name: 'recent', columns: ['id', 'amount', 'count'] }, { name: 'big', columns: ['a', 'b'] }])
    expect(sources.filter(s => s.kind === 'cte').map(s => [s.key, s.columns])).toEqual([['r', ['id', 'amount', 'count']], ['big', ['a', 'b']]])
  })
  it('reads derived tables as sources with their columns', () => {
    const { sources } = parse('SELECT * FROM (SELECT id, email AS mail FROM users) AS d JOIN orders o ON o.user_id = d.id')
    expect(sources.find(s => s.key === 'd')).toMatchObject({ kind: 'subquery', columns: ['id', 'mail'] })
    expect(sources.some(s => s.key === 'o')).toBe(true)
  })
  it('copes with unfinished statements', () => {
    expect(parse('SELECT * FROM ').sources).toEqual([])
    expect(parse('WITH x AS (SELECT 1').ctes).toHaveLength(1)
    expect(() => parse('SELECT * FROM (SELECT')).not.toThrow()
  })
})

describe('selectColumns', () => {
  it('skips stars and unnamed expressions', () => {
    expect(selectColumns('SELECT *, t.*, a + b, x::int, u.name FROM t')).toEqual(['x', 'name'])
  })
})

describe('parseForeignKey', () => {
  it('reads single, composite and schema-qualified keys', () => {
    expect(parseForeignKey('FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE')).toEqual({ columns: ['user_id'], table: 'users', refColumns: ['id'] })
    expect(parseForeignKey('FOREIGN KEY (a, b) REFERENCES audit."Ev Ents"(x, y)')).toEqual({ columns: ['a', 'b'], schema: 'audit', table: 'Ev Ents', refColumns: ['x', 'y'] })
  })
  it('rejects other constraints', () => {
    expect(parseForeignKey('CHECK (a > 0)')).toBeNull()
  })
})
