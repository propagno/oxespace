import { describe, expect, it } from 'vitest'
import { confirmScript, lineAt, mongoWritePreview } from '../src/components/OxeQuery/confirm-statements'

describe('confirmScript', () => {
  it('gives every statement its editor line and the reasons found inside it', () => {
    const text = 'SELECT 1;\n\n-- clean up\nDELETE FROM users;\nUPDATE t SET a = 1'
    const deleteAt = text.indexOf('DELETE'), updateAt = text.indexOf('UPDATE')
    const script = confirmScript(text, 10, [{ start: deleteAt, reason: 'DELETE without WHERE' }, { start: updateAt, reason: 'UPDATE without WHERE' }, { start: deleteAt + 2, reason: 'DELETE without WHERE' }])
    expect(script.all.map(statement => [statement.line, statement.text])).toEqual([[10, 'SELECT 1'], [13, 'DELETE FROM users'], [14, 'UPDATE t SET a = 1']])
    expect(script.flagged).toEqual([{ line: 13, text: 'DELETE FROM users', reasons: ['DELETE without WHERE'] }, { line: 14, text: 'UPDATE t SET a = 1', reasons: ['UPDATE without WHERE'] }])
    expect(script).toMatchObject({ text, firstLine: 10 })
  })
  it('keeps a single statement whole and counts lines from the offset', () => {
    expect(confirmScript('DROP TABLE x', 1, []).all).toEqual([{ line: 1, text: 'DROP TABLE x', reasons: [] }])
    expect(lineAt('a\nb\nc', 4)).toBe(3)
    expect(lineAt('a\r\nb', 3)).toBe(2)
  })
})

describe('mongoWritePreview', () => {
  const original = JSON.stringify({ _id: { $oid: 'abc' }, name: 'x' })
  it('a delete matches by _id and writes nothing', () => {
    expect(mongoWritePreview({ op: 'delete', database: 'shop', collection: 'items', original, document: null }))
      .toEqual({ operation: 'db.items.deleteOne() · shop', filter: JSON.stringify({ _id: { $oid: 'abc' } }, null, 2), document: null })
  })
  it('a replace shows the filter and the full new document; an insert only the document', () => {
    const replace = mongoWritePreview({ op: 'replace', database: 'shop', collection: 'items', original, document: '{"_id":{"$oid":"abc"},"name":"y"}' })
    expect(replace.filter).toContain('abc')
    expect(JSON.parse(replace.document!)).toEqual({ _id: { $oid: 'abc' }, name: 'y' })
    const insert = mongoWritePreview({ op: 'insert', database: 'shop', collection: 'items', original: null, document: 'not json' })
    expect(insert).toEqual({ operation: 'db.items.insertOne() · shop', filter: null, document: 'not json' })
  })
})
