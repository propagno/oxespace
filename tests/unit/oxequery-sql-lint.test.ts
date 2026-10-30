import { describe, expect, it } from 'vitest'
import { destructiveFindings, lintSql, type LintCode, type LintContext } from '../../src/components/OxeQuery/sql-lint'

const estimates: Record<string, number> = { 'public.orders': 2_400_000, 'public.users': 3, 'audit.events': 900_000, 'public.small': 99_999 }
const context = (overrides: Partial<LintContext> = {}): LintContext => ({
  environment: 'dev',
  rowEstimate: (schema, table) => estimates[`${schema ?? 'public'}.${table}`],
  ...overrides
})
const codes = (sql: string, overrides: Partial<LintContext> = {}): LintCode[] => lintSql(sql, context(overrides)).map(finding => finding.code)

describe('SQL lint: UPDATE and DELETE without WHERE', () => {
  it('flags both, with the statement as the range', () => {
    const sql = 'UPDATE users SET name = \'x\''
    const [finding] = lintSql(sql, context())
    expect(finding).toMatchObject({ code: 'updateNoWhere', start: 0, end: sql.length, destructive: true })
    expect(codes('DELETE FROM users')).toEqual(['deleteNoWhere'])
    expect(codes('delete from users;')).toEqual(['deleteNoWhere'])
  })

  it('accepts a WHERE of the statement itself', () => {
    expect(codes('UPDATE users SET name = \'x\' WHERE id = 1')).toEqual([])
    expect(codes('DELETE FROM users USING old WHERE users.id = old.id')).toEqual([])
    expect(codes('UPDATE users SET a = 1 FROM other WHERE other.id = users.id')).toEqual([])
  })

  it('does not count a WHERE that belongs to a subquery', () => {
    expect(codes('UPDATE users SET name = (SELECT n FROM names WHERE names.id = 1)')).toEqual(['updateNoWhere'])
    expect(codes('DELETE FROM users WHERE id IN (SELECT id FROM gone WHERE x)')).toEqual([])
  })

  it('ignores a WHERE or a verb that only appears in a comment or a string', () => {
    expect(codes('DELETE FROM users -- WHERE id = 1')).toEqual(['deleteNoWhere'])
    expect(codes('/* DELETE FROM users */ SELECT 1')).toEqual([])
    expect(codes('SELECT \'DELETE FROM users\'')).toEqual([])
    expect(codes('SELECT $$UPDATE users SET a = 1$$')).toEqual([])
  })

  it('finds a data-modifying CTE without WHERE, and not the verbs of other clauses', () => {
    expect(codes('WITH gone AS (DELETE FROM users RETURNING *) SELECT count(*) FROM gone')).toEqual(['deleteNoWhere'])
    expect(codes('WITH gone AS (DELETE FROM users WHERE id < 5 RETURNING *) SELECT count(*) FROM gone')).toEqual([])
    expect(codes('INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET id = 2')).toEqual([])
    expect(codes('CREATE TABLE t (id int REFERENCES u ON DELETE CASCADE ON UPDATE CASCADE)')).toEqual([])
    expect(codes('SELECT * FROM users FOR UPDATE')).toEqual([])
    expect(codes('GRANT UPDATE, DELETE ON users TO app')).toEqual([])
  })

  it('looks at every statement of a script', () => {
    const sql = 'DELETE FROM a WHERE id = 1;\nDELETE FROM b;\nUPDATE c SET x = 1;'
    const found = lintSql(sql, context())
    expect(found.map(finding => finding.code)).toEqual(['deleteNoWhere', 'updateNoWhere'])
    expect(sql.slice(found[0].start, found[0].end)).toBe('DELETE FROM b')
  })

  it('is destructive, so it asks for confirmation', () => {
    expect(destructiveFindings(lintSql('DELETE FROM users', context()))).toHaveLength(1)
  })
})

describe('SQL lint: DROP and TRUNCATE', () => {
  it.each([
    ['DROP TABLE users', 'drop'],
    ['drop schema public cascade', 'drop'],
    ['DROP INDEX CONCURRENTLY idx', 'drop'],
    ['TRUNCATE users', 'truncate'],
    ['truncate table users restart identity', 'truncate'],
    ['ALTER TABLE users DROP COLUMN email', 'alterDrop'],
    ['ALTER TABLE users DROP CONSTRAINT users_pkey', 'alterDrop']
  ] as const)('flags %s', (sql, code) => {
    const [finding] = lintSql(sql, context())
    expect(finding).toMatchObject({ code, destructive: true })
    expect(sql.slice(finding.start, finding.end).toUpperCase()).toMatch(/^(DROP|TRUNCATE)/)
  })

  it.each([
    'ALTER TABLE users ALTER COLUMN email DROP NOT NULL',
    'ALTER TABLE users ALTER COLUMN email DROP DEFAULT',
    'ALTER TABLE users ADD COLUMN x int',
    'SELECT \'DROP TABLE users\'',
    '-- DROP TABLE users\nSELECT 1',
    'CREATE TABLE drops (id int)',
    'COMMENT ON TABLE users IS \'truncate me\''
  ])('does not flag %s', sql => {
    expect(codes(sql)).toEqual([])
  })

  it('names the statement for the message', () => {
    expect(lintSql('DROP TABLE users', context())[0].params).toEqual({ statement: 'DROP TABLE' })
    expect(lintSql('ALTER TABLE users DROP COLUMN email', context())[0].params).toEqual({ statement: 'ALTER DROP COLUMN' })
  })
})

describe('SQL lint: SELECT * on a large table', () => {
  it('flags the star when the catalog estimates a large table', () => {
    const sql = 'SELECT * FROM orders'
    const [finding] = lintSql(sql, context())
    expect(finding).toMatchObject({ code: 'selectStarLarge', destructive: false, params: { table: 'orders', rows: 2_400_000 } })
    expect(sql.slice(finding.start, finding.end)).toBe('*')
  })

  it('handles qualified names, aliases, DISTINCT and joins', () => {
    expect(codes('SELECT * FROM audit.events')).toEqual(['selectStarLarge'])
    expect(codes('SELECT DISTINCT * FROM orders o')).toEqual(['selectStarLarge'])
    expect(codes('SELECT o.* FROM orders o JOIN users u ON u.id = o.user_id')).toEqual(['selectStarLarge'])
    expect(codes('SELECT u.name, o.* FROM users u JOIN orders o ON true')).toEqual(['selectStarLarge'])
    expect(lintSql('SELECT * FROM users u JOIN audit.events e ON true', context())[0].params).toMatchObject({ table: 'audit.events' })
    expect(codes('SELECT * FROM "orders"')).toEqual(['selectStarLarge'])
  })

  it('says nothing for small tables, unknown tables or the threshold minus one', () => {
    expect(codes('SELECT * FROM users')).toEqual([])
    expect(codes('SELECT * FROM small')).toEqual([])
    expect(codes('SELECT * FROM mystery')).toEqual([])
    expect(codes('SELECT * FROM orders', { largeTableRows: 5_000_000 })).toEqual([])
    expect(codes('SELECT * FROM users', { largeTableRows: 3 })).toEqual(['selectStarLarge'])
  })

  it('says nothing without a catalog estimate', () => {
    expect(codes('SELECT * FROM orders', { rowEstimate: undefined })).toEqual([])
  })

  it('does not take a count, a product or a LIMIT for a full read', () => {
    expect(codes('SELECT count(*) FROM orders')).toEqual([])
    expect(codes('SELECT 2 * total FROM orders')).toEqual([])
    expect(codes('SELECT id, total * 2 FROM orders')).toEqual([])
    expect(codes('SELECT * FROM orders LIMIT 10')).toEqual([])
    expect(codes('SELECT * FROM orders FETCH FIRST 10 ROWS ONLY')).toEqual([])
    expect(codes('SELECT id, total FROM orders')).toEqual([])
  })

  it('looks inside subqueries and CTEs', () => {
    expect(codes('WITH big AS (SELECT * FROM orders) SELECT id FROM big LIMIT 5')).toEqual(['selectStarLarge'])
    expect(codes('SELECT id FROM (SELECT * FROM orders) o LIMIT 5')).toEqual(['selectStarLarge'])
    expect(codes('SELECT id FROM (SELECT * FROM orders LIMIT 5) o')).toEqual([])
  })

  it('does not look at statements that are not queries', () => {
    expect(codes('INSERT INTO archive SELECT * FROM orders')).toEqual([])
    expect(codes('EXPLAIN SELECT * FROM orders')).toEqual([])
  })
})

describe('SQL lint: SELECT without LIMIT in production', () => {
  const prod = { environment: 'prod' as const }

  it('flags an unbounded read, only in production', () => {
    const sql = 'SELECT id, total FROM orders WHERE total > 10'
    const [finding] = lintSql(sql, context(prod))
    expect(finding).toMatchObject({ code: 'selectNoLimit', destructive: false })
    expect(sql.slice(finding.start, finding.end)).toBe('SELECT')
    expect(codes(sql, { environment: 'dev' })).toEqual([])
    expect(codes(sql, { environment: 'local' })).toEqual([])
  })

  it('accepts LIMIT and FETCH, wherever the outermost query puts them', () => {
    expect(codes('SELECT id FROM orders ORDER BY id LIMIT 10', prod)).toEqual([])
    expect(codes('SELECT id FROM orders ORDER BY id FETCH FIRST 10 ROWS ONLY', prod)).toEqual([])
    expect(codes('WITH a AS (SELECT id FROM orders LIMIT 5) SELECT id FROM a LIMIT 3', prod)).toEqual([])
    expect(codes('SELECT id FROM a UNION ALL SELECT id FROM b LIMIT 10', prod)).toEqual([])
  })

  it('does not count a LIMIT of a subquery for the outer query', () => {
    expect(codes('SELECT id FROM (SELECT id FROM orders LIMIT 5) o', prod)).toEqual(['selectNoLimit'])
  })

  it('leaves alone queries that return one row or read no table', () => {
    expect(codes('SELECT count(*) FROM orders', prod)).toEqual([])
    expect(codes('SELECT max(total), min(total) FROM orders', prod)).toEqual([])
    expect(codes('SELECT now()', prod)).toEqual([])
    expect(codes('SELECT 1', prod)).toEqual([])
    expect(codes('EXPLAIN SELECT id FROM orders', prod)).toEqual([])
    expect(codes('SELECT id INTO TEMP t FROM orders', prod)).toEqual([])
  })

  it('still flags an aggregate that is grouped, which returns a row per group', () => {
    expect(codes('SELECT user_id, count(*) FROM orders GROUP BY user_id', prod)).toEqual(['selectNoLimit'])
  })

  it('does not flag writes and DDL as unbounded reads', () => {
    expect(codes('UPDATE orders SET total = 0 WHERE id = 1', prod)).toEqual([])
    expect(codes('CREATE TABLE t AS SELECT id FROM orders', prod)).toEqual([])
  })

  it('reports once per statement and sorts by position', () => {
    const found = lintSql('SELECT id FROM a; DELETE FROM b; SELECT id FROM c', context(prod))
    expect(found.map(finding => finding.code)).toEqual(['selectNoLimit', 'deleteNoWhere', 'selectNoLimit'])
    expect(found.map(finding => finding.start)).toEqual([...found.map(finding => finding.start)].sort((a, b) => a - b))
  })
})

describe('SQL lint: robustness', () => {
  it('gives nothing for empty or comment-only text', () => {
    expect(lintSql('', context())).toEqual([])
    expect(lintSql('  \n-- nothing\n/* here */', context())).toEqual([])
  })

  it('survives unterminated strings, comments and parentheses', () => {
    expect(() => lintSql('SELECT \'oops', context())).not.toThrow()
    expect(() => lintSql('/* never closed SELECT 1', context())).not.toThrow()
    expect(() => lintSql('DELETE FROM t WHERE (a = 1', context())).not.toThrow()
    expect(() => lintSql('SELECT )))) FROM', context())).not.toThrow()
    expect(codes('DELETE FROM t WHERE (a = 1')).toEqual([])
  })

  it('offsets point into the text that was given, whatever comes before', () => {
    const sql = '-- note\n/* more */ DELETE FROM users'
    const [finding] = lintSql(sql, context())
    expect(sql.slice(finding.start, finding.end)).toBe('DELETE FROM users')
  })

  it('treats a quoted identifier named like a keyword as a name', () => {
    expect(codes('SELECT "DELETE", "WHERE" FROM users')).toEqual([])
    expect(codes('DELETE FROM "where"')).toEqual(['deleteNoWhere'])
  })
})
