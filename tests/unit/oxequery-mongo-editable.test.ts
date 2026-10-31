import { describe, expect, it } from 'vitest'
import { Decimal128, Double, Int32, Long, ObjectId } from 'bson'
import { editableEjson, parseEditableDocument } from '../../electron/main/services/oxequery/mongo-guard'

const round = (value: Record<string, unknown>): Record<string, unknown> => parseEditableDocument(editableEjson(value).text, 'Document')

describe('editable EJSON keeps what a document stores', () => {
  it('does not retype numbers', () => {
    const doc = { _id: new ObjectId('507f1f77bcf86cd799439011'), small: new Int32(5), big: Long.fromNumber(5), whole: new Double(5), fraction: new Double(1.5), money: Decimal128.fromString('1.10') }
    const back = round(doc) as Record<string, { _bsontype?: string; toString(): string } | number>
    expect((back.small as { _bsontype: string })._bsontype).toBe('Int32')
    expect(Number(back.small)).toBe(5)
    expect((back.big as { _bsontype: string })._bsontype).toBe('Long')
    expect((back.whole as { _bsontype: string })._bsontype).toBe('Double')
    expect(Number(back.fraction)).toBe(1.5)
    expect((back.money as { _bsontype: string; toString(): string })._bsontype).toBe('Decimal128')
    expect(String(back.money)).toBe('1.10')
  })

  it('writes the plain form only for values that survive it', () => {
    const text = editableEjson({ a: new Int32(7), b: Long.fromNumber(7), c: new Double(2), d: new Double(0.25), e: new Date('2024-05-01T10:00:00.000Z') }).text
    expect(JSON.parse(text)).toEqual({ a: 7, b: { $numberLong: '7' }, c: { $numberDouble: '2.0' }, d: 0.25, e: { $date: '2024-05-01T10:00:00.000Z' } })
  })

  it('round-trips dates, nested documents and arrays, and still refuses server-side code', () => {
    const doc = { when: new Date('2020-01-02T03:04:05.000Z'), nested: { list: [new Int32(1), 'x', { k: Long.fromNumber(9) }] } }
    expect(editableEjson(round(doc)).text).toBe(editableEjson(doc).text)
    expect(() => parseEditableDocument('{"$where":"1"}', 'Document')).toThrow(/server-side code/)
    expect(() => parseEditableDocument('[1]', 'Document')).toThrow(/object/)
  })

  it('flags text it had to cut', () => {
    const big = editableEjson({ s: 'x'.repeat(100) }, 40)
    expect(big.truncated).toBe(true)
    expect(editableEjson({ s: 'x' }).truncated).toBe(false)
  })
})
