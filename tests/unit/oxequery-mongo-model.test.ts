import { describe, expect, it } from 'vitest'
import { cloneDocument, documentLabel, isBranch, jsonProblem, leafText } from '../../src/components/OxeQuery/mongo-model'

describe('json fields', () => {
  it('accepts the right shape and explains the wrong one', () => {
    expect(jsonProblem('{"a": {"$gt": 1}}', 'object')).toBeNull()
    expect(jsonProblem('[{"$match": {}}]', 'array')).toBeNull()
    expect(jsonProblem('', 'object', true)).toBeNull()
    expect(jsonProblem('', 'object')).toBe('This field is empty.')
    expect(jsonProblem('[1]', 'object')).toBe('Expected a JSON object.')
    expect(jsonProblem('{}', 'array')).toBe('Expected a JSON array.')
    expect(jsonProblem('{"a":', 'object')).toMatch(/^Not valid JSON/)
  })
})

describe('documents', () => {
  it('clones without the _id', () => {
    expect(JSON.parse(cloneDocument('{"_id":{"$oid":"5"},"a":1,"b":{"c":2}}'))).toEqual({ a: 1, b: { c: 2 } })
    expect(cloneDocument('not json')).toBe('not json')
  })

  it('labels a document by its _id', () => {
    expect(documentLabel('{"_id":{"$oid":"abc"}}')).toBe('_id: abc')
    expect(documentLabel('{"_id":7}')).toBe('_id: 7')
    expect(documentLabel('{"a":1}')).toBe('{"a":1}')
  })

  it('shows typed scalars as such in the tree and opens only real branches', () => {
    expect(leafText({ $oid: 'abc' })).toEqual({ text: 'ObjectId("abc")', kind: 'id' })
    expect(leafText({ $numberLong: '7' })).toEqual({ text: 'Long(7)', kind: 'number' })
    expect(leafText({ $date: '2024-01-01T00:00:00Z' }).kind).toBe('date')
    expect(leafText(null).kind).toBe('null')
    expect(isBranch({ $oid: 'abc' })).toBe(false)
    expect(isBranch({ a: 1 })).toBe(true)
    expect(isBranch([1])).toBe(true)
    expect(isBranch('x')).toBe(false)
  })
})
