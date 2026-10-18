import { describe, expect, it } from 'vitest'
import { describeMongoQuery, parseMongoQuery, stringifyMongoQuery } from '../../shared/mongoQueryText'

describe('mongo query text', () => {
  it('round trips a find and keeps only what was set', () => {
    const text = stringifyMongoQuery({ kind: 'find', database: 'shop', collection: 'orders', filter: '{"qty": {"$gt": 3}}', sort: ' ', projection: '' })
    expect(JSON.parse(text)).toEqual({ v: 1, kind: 'find', database: 'shop', collection: 'orders', filter: '{"qty": {"$gt": 3}}' })
    expect(parseMongoQuery(text)).toMatchObject({ kind: 'find', collection: 'orders' })
  })

  it('does not mistake other text for a query', () => {
    expect(parseMongoQuery('SELECT 1')).toBeNull()
    expect(parseMongoQuery('{"v":2}')).toBeNull()
    expect(parseMongoQuery('{"v":1,"kind":"find","database":1,"collection":"x"}')).toBeNull()
  })

  it('describes a query on one line', () => {
    expect(describeMongoQuery(stringifyMongoQuery({ kind: 'aggregate', database: 'd', collection: 'c', pipeline: '[\n  {"$match": {}}\n]' }))).toBe('c.aggregate [ {"$match": {}} ]')
    expect(describeMongoQuery('SELECT   *\nFROM t')).toBe('SELECT * FROM t')
  })
})
