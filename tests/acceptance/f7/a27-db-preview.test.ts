// Frozen acceptance test for 1.5.0 A27 (OXE program, phase F7), SECURITY (TECH LEAD S4 and HML 714-4/5 on #714): the
// preview of a database write runs an equivalent SELECT (a count and a 5-row sample), inside a read-only transaction
// with a 5 s statement timeout, never the write, with no local snapshot, off for production by default. What it can't
// translate safely it refuses, running nothing. Secret-looking columns are masked in the sample. A fake driver records
// every statement and its options; Postgres and Mongo shapes. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f7-approvals.md §A27.
import { describe, expect, test } from 'vitest'
import { previewDatabaseWrite, type PreviewDriver } from '../../../electron/main/services/approvals/db-write-preview'

interface Seen { sql: string; options: { readOnly?: boolean; timeoutMs?: number } }
function sqlDriver(rows: Array<Record<string, unknown>> = [{ id: 1, status: 'open' }, { id: 2, status: 'open' }], count = 42, fail?: Error) {
  const seen: Seen[] = []
  const driver: PreviewDriver = {
    engine: 'postgres',
    query: async (sql: string, options = {}) => {
      seen.push({ sql, options })
      if (fail) throw fail
      if (/^\s*select\s+count/i.test(sql)) return { rows: [{ count }] }
      if (/^\s*select/i.test(sql)) return { rows }
      throw new Error(`a write reached the driver: ${sql}`)
    }
  }
  return { driver, seen }
}

describe('A27 · SQL writes', () => {
  test('A27 / S4: an UPDATE becomes a count and a 5-row sample, read-only with a 5 s timeout; changed cells show old and new; the write never runs', async () => {
    const { driver, seen } = sqlDriver()
    const result = await previewDatabaseWrite({ text: "UPDATE orders SET status = 'paid' WHERE customer_id = 7", env: 'dev', driver })
    expect(result).toEqual({ status: 'ok', count: 42, sample: { cols: ['id', 'status'], rows: [[1, { old: 'open', new: 'paid' }], [2, { old: 'open', new: 'paid' }]] } })
    expect(seen.length).toBe(2)
    expect(seen.every(entry => /^\s*select\b/i.test(entry.sql) && entry.options.readOnly === true && entry.options.timeoutMs === 5000)).toBe(true)
    expect(seen.some(entry => /where\s+customer_id\s*=\s*7/i.test(entry.sql))).toBe(true)
    expect(seen.find(entry => !/count/i.test(entry.sql))?.sql).toMatch(/limit\s+5\b/i)
  })

  test('S4: a timeout or a driver error is "couldn\'t preview": failed with a reason, and nothing else runs', async () => {
    const { driver, seen } = sqlDriver(undefined, undefined, Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }))
    expect(await previewDatabaseWrite({ text: 'UPDATE a SET x = 1 WHERE id = 1', env: 'dev', driver })).toEqual({ status: 'failed', count: null, reason: 'timeout' })
    expect(seen).toHaveLength(1)
  })

  test('S4: sample cells in columns named like password, secret, token, key, hash or salt are masked', async () => {
    const { driver } = sqlDriver([{ id: 1, email: 'a@x', password_hash: '$2b$10$abc', api_key: 'k-123', salt: 's', token: 't', secret_note: 'n' }])
    const result = await previewDatabaseWrite({ text: "UPDATE users SET email = 'b@x' WHERE id = 1", env: 'dev', driver })
    expect(result.sample?.cols).toEqual(['id', 'email', 'password_hash', 'api_key', 'salt', 'token', 'secret_note'])
    expect(result.sample?.rows[0]).toEqual([1, { old: 'a@x', new: 'b@x' }, '•••', '•••', '•••', '•••', '•••'])
    expect(JSON.stringify(result)).not.toMatch(/\$2b\$|k-123/)
  })

  test('A27: a DELETE previews the rows it would remove; with no WHERE it counts the whole table', async () => {
    const { driver, seen } = sqlDriver([{ id: 9 }], 1200)
    expect(await previewDatabaseWrite({ text: 'DELETE FROM carts WHERE id > 100', env: 'dev', driver })).toMatchObject({ status: 'ok', count: 1200, sample: { cols: ['id'], rows: [[9]] } })
    seen.length = 0
    expect(await previewDatabaseWrite({ text: 'DELETE FROM carts', env: 'dev', driver })).toMatchObject({ status: 'ok', count: 1200 })
    expect(seen.every(entry => /^\s*select\b/i.test(entry.sql) && !/where/i.test(entry.sql))).toBe(true)
  })

  test('HML-714-5: pure functions are allowed in WHERE (the most common real DELETE); a ; inside a string or a comment is not a second statement', async () => {
    const { driver, seen } = sqlDriver([{ id: 1 }], 3)
    for (const text of [
      "DELETE FROM carts WHERE created_at < now() - interval '30 days'",
      "DELETE FROM carts WHERE lower(email) = 'a@x' AND coalesce(note, '') = '' AND created_at < date_trunc('day', current_date)",
      "UPDATE notes SET body = 'a; b' WHERE id = 1",
      'UPDATE notes SET body = 1 WHERE id = 1 -- a comment; with a semicolon',
      'UPDATE notes SET body = 1 /* x; y */ WHERE id = 1'
    ]) expect((await previewDatabaseWrite({ text, env: 'dev', driver })).status, text).toBe('ok')
    expect(seen.every(entry => /^\s*select\b/i.test(entry.sql))).toBe(true)
  })

  test('HML-714-4 / A27: what it can\'t translate safely is refused, failed with a reason, and nothing reaches the driver', async () => {
    const { driver, seen } = sqlDriver()
    for (const text of [
      'UPDATE a SET x = 1; DROP TABLE users', 'WITH d AS (DELETE FROM a RETURNING *) SELECT * FROM d', 'TRUNCATE orders', 'CALL wipe()', 'UPDATE a SET x = (SELECT pg_sleep(10))',
      'UPDATE a SET x = b.y FROM b WHERE a.id = b.id', 'UPDATE a JOIN b ON a.id = b.id SET a.x = 1', 'DELETE FROM a USING b WHERE a.id = b.id',
      'DELETE FROM a WHERE x = 1 ORDER BY id LIMIT 10', 'UPDATE a SET x = 1 ORDER BY id LIMIT 1',
      "INSERT INTO a (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET x = 2", "INSERT INTO a (id) VALUES (1) ON DUPLICATE KEY UPDATE x = 2", 'REPLACE INTO a (id) VALUES (1)',
      'MERGE INTO a USING b ON a.id = b.id WHEN MATCHED THEN UPDATE SET x = 1',
      'CREATE TABLE z (id int)', 'ALTER TABLE a ADD COLUMN b int', 'DROP INDEX i', 'GRANT ALL ON a TO bob'
    ]) {
      const result = await previewDatabaseWrite({ text, env: 'dev', driver })
      expect(result.status, text).toBe('failed')
      expect(result.reason, text).toEqual(expect.any(String))
    }
    expect(seen).toEqual([])
  })

  test('HML-714-4: an INSERT … VALUES counts its rows with no query; an INSERT … SELECT counts the rows that SELECT returns, read-only', async () => {
    const { driver, seen } = sqlDriver([], 17)
    expect(await previewDatabaseWrite({ text: "INSERT INTO tags (name) VALUES ('a'), ('b'), ('c')", env: 'dev', driver })).toEqual({ status: 'ok', count: 3 })
    expect(seen).toEqual([])
    expect(await previewDatabaseWrite({ text: 'INSERT INTO archive SELECT * FROM orders WHERE status = 1', env: 'dev', driver })).toMatchObject({ status: 'ok', count: 17 })
    expect(seen.every(entry => /^\s*select\s+count/i.test(entry.sql) && entry.options.readOnly === true)).toBe(true)
  })

  test('A27: production is off by default (nothing reaches the driver); with the policy allowing it, only the count', async () => {
    const { driver, seen } = sqlDriver()
    expect(await previewDatabaseWrite({ text: 'UPDATE orders SET status = 1 WHERE id = 1', env: 'production', driver })).toEqual({ status: 'off-production', count: null })
    expect(seen).toEqual([])
    expect(await previewDatabaseWrite({ text: 'UPDATE orders SET status = 1 WHERE id = 1', env: 'production', driver, productionCount: true })).toEqual({ status: 'off-production', count: 42 })
    expect(seen.every(entry => /^\s*select\s+count/i.test(entry.sql) && entry.options.readOnly === true)).toBe(true)
  })
})

describe('A27 · Mongo writes', () => {
  function mongo(count = 3) {
    const calls: Array<[string, unknown]> = []
    const driver: PreviewDriver = {
      engine: 'mongo',
      countDocuments: async (collection: string, filter: unknown, options?: unknown) => { calls.push(['count', { collection, filter, options }]); return count },
      find: async (collection: string, filter: unknown, limit: number, options?: unknown) => { calls.push(['find', { collection, filter, limit, options }]); return [{ _id: 'a', status: 'open' }] }
    }
    return { driver, calls }
  }

  test('A27: updateMany becomes countDocuments and a find with limit 5 on the same filter, with a 5 s limit; no write method exists on the driver', async () => {
    const { driver, calls } = mongo()
    const result = await previewDatabaseWrite({ mongo: { collection: 'orders', op: 'updateMany', filter: { status: 'open' }, update: { $set: { status: 'closed' } } }, env: 'dev', driver })
    expect(result).toEqual({ status: 'ok', count: 3, sample: { cols: ['_id', 'status'], rows: [['a', { old: 'open', new: 'closed' }]] } })
    expect(calls).toEqual([
      ['count', { collection: 'orders', filter: { status: 'open' }, options: { maxTimeMS: 5000 } }],
      ['find', { collection: 'orders', filter: { status: 'open' }, limit: 5, options: { maxTimeMS: 5000 } }]
    ])
  })

  test('HML-714-4: deleteOne, replaceOne and findOneAnd* count at most 1; $where, $function, upsert and bulkWrite are refused', async () => {
    const { driver, calls } = mongo(9)
    for (const op of ['deleteOne', 'replaceOne', 'findOneAndUpdate', 'findOneAndDelete'] as const) {
      expect((await previewDatabaseWrite({ mongo: { collection: 'orders', op, filter: { status: 'open' }, update: { status: 'x' } }, env: 'dev', driver })).count, op).toBe(1)
    }
    const before = calls.length
    for (const input of [
      { collection: 'orders', op: 'deleteMany', filter: { $where: 'sleep(1000)' } },
      { collection: 'orders', op: 'updateMany', filter: { $expr: { $function: { body: 'x', args: [], lang: 'js' } } }, update: { $set: { a: 1 } } },
      { collection: 'orders', op: 'updateMany', filter: {}, update: { $set: { a: 1 } }, upsert: true },
      { collection: 'orders', op: 'bulkWrite', operations: [] }
    ]) expect((await previewDatabaseWrite({ mongo: input as never, env: 'dev', driver })).status, JSON.stringify(input)).toBe('failed')
    expect(calls).toHaveLength(before)
  })

  test('A27: a Mongo write on production is off', async () => {
    const { driver, calls } = mongo()
    expect(await previewDatabaseWrite({ mongo: { collection: 'orders', op: 'deleteMany', filter: {} }, env: 'production', driver })).toEqual({ status: 'off-production', count: null })
    expect(calls).toEqual([])
  })
})
