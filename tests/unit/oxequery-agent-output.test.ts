import { describe, expect, it } from 'vitest'
import { MAX_BYTES, MAX_CELL, MAX_ROWS, compilePatterns, isSensitiveName, redactDocument, redactStatement, shapeDocuments, shapeRows } from '../../electron/main/services/oxequery/agent-output'

describe('shapeRows', () => {
  it('masks sensitive columns, clips long cells and defaults to 50 rows', () => {
    const rows = Array.from({ length: 120 }, (_, index) => [index, 'x'.repeat(40), `tok${index}`])
    const shaped = shapeRows(['id', 'bio', 'api_token'], rows)
    expect(shaped.rowCount).toBe(50)
    expect(shaped.truncated).toBe(true)
    expect(shaped.masked).toEqual(['api_token'])
    expect(shaped.rows[0][2]).toBe('«masked»')
    expect(String(shapeRows(['bio'], [['x'.repeat(2000)]]).rows[0][0]).length).toBeLessThan(MAX_CELL + 60)
  })
  it('never exceeds the row ceiling or the byte budget', () => {
    const rows = Array.from({ length: 1000 }, () => ['y'.repeat(500)])
    const shaped = shapeRows(['v'], rows, { maxRows: 5000 })
    expect(shaped.rowCount).toBeLessThanOrEqual(MAX_ROWS)
    expect(JSON.stringify(shaped.rows).length).toBeLessThanOrEqual(MAX_BYTES + 600)
    expect(shaped.truncated).toBe(true)
  })
  it('keeps NULL as null so the model can tell it from a masked value', () => {
    expect(shapeRows(['password'], [[null]]).rows[0][0]).toBeNull()
  })
  it('honours extra patterns for a connection', () => {
    const extra = compilePatterns(['matricula', '('])
    expect(isSensitiveName('Matricula_aluno', extra)).toBe(true)
    expect(isSensitiveName('name', extra)).toBe(false)
  })
})

describe('shapeDocuments', () => {
  it('masks keys at any depth and inside arrays', () => {
    const shaped = shapeDocuments([JSON.stringify({ a: 1, user: { secret: 's', list: [{ token: 't', ok: 1 }] } })])
    expect(shaped.documents[0]).toEqual({ a: 1, user: { secret: '«masked»', list: [{ token: '«masked»', ok: 1 }] } })
    expect(shaped.masked.sort()).toEqual(['secret', 'token'])
  })
})

describe('audit redaction', () => {
  it('drops string literals from SQL', () => {
    expect(redactStatement(`SELECT * FROM u WHERE email = 'a@b.c' AND note = 'it''s'`)).toBe(`SELECT * FROM u WHERE email = '?' AND note = '?'`)
    expect(redactStatement('SELECT $tag$secret$tag$')).not.toContain('secret')
  })
  it('masks sensitive keys in documents', () => {
    expect(redactDocument('{"password":"p","n":1}')).toBe('{"password":"«masked»","n":1}')
  })
})
