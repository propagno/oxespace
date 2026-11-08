// Frozen acceptance test for 1.5.0 A27 (OXE program, phase F7), SECURITY: the preview of a database write runs an
// equivalent SELECT (a count and a 5-row sample) and never the write, keeps no local snapshot, and is off for production
// by default. A fake driver records every statement it receives; Postgres and Mongo shapes.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f7-approvals.md §A27; DESIGN 1.5.0-f7-design.md U7.2.
import { describe, expect, test } from 'vitest'
import { previewDatabaseWrite, type PreviewDriver } from '../../../electron/main/services/approvals/db-write-preview'

function sqlDriver(rows: Array<Record<string, unknown>> = [{ id: 1, status: 'open' }, { id: 2, status: 'open' }], count = 42) {
  const seen: string[] = []
  const driver: PreviewDriver = {
    engine: 'postgres',
    query: async (sql: string) => {
      seen.push(sql)
      if (/^\s*select\s+count/i.test(sql)) return { rows: [{ count }] }
      if (/^\s*select/i.test(sql)) return { rows }
      throw new Error(`a write reached the driver: ${sql}`)
    }
  }
  return { driver, seen }
}

describe('A27 · SQL writes', () => {
  test('A27: an UPDATE becomes a count and a 5-row sample with SELECT; changed cells show old and new; the write never runs', async () => {
    const { driver, seen } = sqlDriver()
    const result = await previewDatabaseWrite({ text: "UPDATE orders SET status = 'paid' WHERE customer_id = 7", env: 'dev', driver })
    expect(result).toEqual({
      status: 'ok', count: 42,
      sample: { cols: ['id', 'status'], rows: [[1, { old: 'open', new: 'paid' }], [2, { old: 'open', new: 'paid' }]] }
    })
    expect(seen.every(sql => /^\s*select\b/i.test(sql))).toBe(true)
    expect(seen.some(sql => /where\s+customer_id\s*=\s*7/i.test(sql))).toBe(true)
    expect(seen.find(sql => !/count/i.test(sql))).toMatch(/limit\s+5\b/i)
  })

  test('A27: a DELETE previews the rows it would remove; with no WHERE it counts the whole table', async () => {
    const { driver, seen } = sqlDriver([{ id: 9 }], 1200)
    expect(await previewDatabaseWrite({ text: 'DELETE FROM carts WHERE created_at < now() - interval \'30 days\'', env: 'dev', driver })).toMatchObject({ status: 'ok', count: 1200, sample: { cols: ['id'], rows: [[9]] } })
    seen.length = 0
    expect(await previewDatabaseWrite({ text: 'DELETE FROM carts', env: 'dev', driver })).toMatchObject({ status: 'ok', count: 1200 })
    expect(seen.every(sql => /^\s*select\b/i.test(sql) && !/where/i.test(sql))).toBe(true)
  })

  test('A27: production is off by default: no statement at all reaches the driver; with the policy allowing it, only the count', async () => {
    const { driver, seen } = sqlDriver()
    expect(await previewDatabaseWrite({ text: 'UPDATE orders SET status = 1 WHERE id = 1', env: 'production', driver })).toEqual({ status: 'off-production', count: null })
    expect(seen).toEqual([])
    expect(await previewDatabaseWrite({ text: 'UPDATE orders SET status = 1 WHERE id = 1', env: 'production', driver, productionCount: true })).toEqual({ status: 'off-production', count: 42 })
    expect(seen.every(sql => /^\s*select\s+count/i.test(sql))).toBe(true)
  })

  test('A27: what it can\'t turn into a SELECT safely is failed with a reason, and nothing runs', async () => {
    const { driver, seen } = sqlDriver()
    for (const text of ['UPDATE a SET x = 1; DROP TABLE users', 'WITH d AS (DELETE FROM a RETURNING *) SELECT * FROM d', 'TRUNCATE orders', 'CALL wipe()', 'UPDATE a SET x = (SELECT pg_sleep(10))']) {
      const result = await previewDatabaseWrite({ text, env: 'dev', driver })
      expect(result.status, text).toBe('failed')
      expect(result.reason, text).toEqual(expect.any(String))
    }
    expect(seen).toEqual([])
  })

  test('A27: an INSERT has nothing to read: the count is the rows it adds, with no query', async () => {
    const { driver, seen } = sqlDriver()
    expect(await previewDatabaseWrite({ text: "INSERT INTO tags (name) VALUES ('a'), ('b'), ('c')", env: 'dev', driver })).toEqual({ status: 'ok', count: 3 })
    expect(seen).toEqual([])
  })
})

describe('A27 · Mongo writes', () => {
  test('A27: updateMany and deleteMany become countDocuments and a find with limit 5 on the same filter; no write method is called', async () => {
    const calls: Array<[string, unknown]> = []
    const driver: PreviewDriver = {
      engine: 'mongo',
      countDocuments: async (collection: string, filter: unknown) => { calls.push(['count', { collection, filter }]); return 3 },
      find: async (collection: string, filter: unknown, limit: number) => { calls.push(['find', { collection, filter, limit }]); return [{ _id: 'a', status: 'open' }] }
    }
    const result = await previewDatabaseWrite({ mongo: { collection: 'orders', op: 'updateMany', filter: { status: 'open' }, update: { $set: { status: 'closed' } } }, env: 'dev', driver })
    expect(result).toEqual({ status: 'ok', count: 3, sample: { cols: ['_id', 'status'], rows: [['a', { old: 'open', new: 'closed' }]] } })
    expect(calls).toEqual([['count', { collection: 'orders', filter: { status: 'open' } }], ['find', { collection: 'orders', filter: { status: 'open' }, limit: 5 }]])
    expect(await previewDatabaseWrite({ mongo: { collection: 'orders', op: 'deleteMany', filter: {} }, env: 'production', driver })).toEqual({ status: 'off-production', count: null })
  })
})
