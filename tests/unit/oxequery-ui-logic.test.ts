import { describe, expect, it } from 'vitest'
import { sortedOrder, toCsv } from '../../src/components/OxeQuery/ResultGrid'

describe('result grid helpers', () => {
  const rows: unknown[][] = [[10, 'b'], [2, 'a'], [null, 'c'], [33, null]]

  it('sorts numbers as numbers, text naturally, and NULL last in both directions', () => {
    expect(sortedOrder(rows, 0, 'asc')).toEqual([1, 0, 3, 2])
    expect(sortedOrder(rows, 0, 'desc')).toEqual([3, 0, 1, 2])
    expect(sortedOrder(rows, 1, 'asc')).toEqual([1, 0, 2, 3])
  })

  it('quotes CSV cells that need it', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [null, 'line\nbreak']])).toBe('a,b\n"x,y","say ""hi"""\n,"line\nbreak"')
  })
})

import { ejsonCell, flattenDocuments } from '../../src/components/OxeQuery/mongo-view'

describe('Mongo table view', () => {
  it('unwraps ObjectId, dates and numbers', () => {
    expect(ejsonCell({ $oid: '507f1f77bcf86cd799439011' })).toBe('507f1f77bcf86cd799439011')
    expect(ejsonCell({ $date: '2026-10-11T00:00:00Z' })).toBe('2026-10-11T00:00:00Z')
    expect(ejsonCell({ $numberLong: '9007199254740993' })).toBe('9007199254740993')
    expect(ejsonCell({ a: 1 })).toBe('{"a":1}')
    expect(ejsonCell(null)).toBeNull()
  })

  it('builds the union of fields with _id first and skips unreadable documents', () => {
    const table = flattenDocuments([
      JSON.stringify({ sku: 'a', _id: { $oid: '1' } }), JSON.stringify({ qty: 3, _id: { $oid: '2' }, tags: ['x'] }), '{ cut off'
    ])
    expect(table.columns).toEqual(['_id', 'sku', 'qty', 'tags'])
    expect(table.rows).toEqual([['1', 'a', null, null], ['2', null, 3, '["x"]']])
    expect(table.truncatedColumns).toBe(false)
  })

  it('caps very wide documents', () => {
    const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`f${index}`, index])))
    const table = flattenDocuments([wide])
    expect(table.columns).toHaveLength(30)
    expect(table.truncatedColumns).toBe(true)
  })
})
