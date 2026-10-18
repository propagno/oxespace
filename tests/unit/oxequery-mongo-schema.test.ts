import { ObjectId } from 'bson'
import { describe, expect, it } from 'vitest'
import { bsonType, inferSchema } from '../../electron/main/services/oxequery/mongo-schema'

describe('bsonType', () => {
  it('names driver values like $type does', () => {
    expect(bsonType(new ObjectId())).toBe('objectId')
    expect(bsonType(new Date())).toBe('date')
    expect(bsonType(1)).toBe('int')
    expect(bsonType(1.5)).toBe('double')
    expect(bsonType(null)).toBe('null')
    expect(bsonType([])).toBe('array')
    expect(bsonType({})).toBe('object')
  })
})

describe('inferSchema', () => {
  it('reports types, presence and nested paths', () => {
    const { fields } = inferSchema([
      { _id: 1, name: 'a', tags: ['x', 'y'], address: { city: 'Rio' } },
      { _id: 2, name: 3, items: [{ sku: 's1' }, { sku: 's2' }] },
      { _id: 3 }
    ])
    const by = Object.fromEntries(fields.map(field => [field.path, field]))
    expect(fields[0].path).toBe('_id')
    expect(by.name.presence).toBeCloseTo(66.7, 1)
    expect(by.name.types.map(item => item.type).sort()).toEqual(['int', 'string'])
    expect(by['address.city'].types[0]).toEqual({ type: 'string', count: 1 })
    expect(by['items[].sku'].types[0].count).toBe(2)
    // Two elements in one document still count as one document having the field.
    expect(by['items[].sku'].presence).toBeCloseTo(33.3, 1)
  })
  it('caps the number of fields', () => {
    const wide = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`f${index}`, index]))
    const result = inferSchema([wide])
    expect(result.fields).toHaveLength(300)
    expect(result.truncated).toBe(true)
  })
  it('does not recurse without bound', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let index = 0; index < 50; index++) deep = { n: deep }
    expect(() => inferSchema([deep])).not.toThrow()
  })
})
