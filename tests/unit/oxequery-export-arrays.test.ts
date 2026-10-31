import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSink, isPgArrayType, pgArrayLiteral } from '../../electron/main/services/oxequery/export-writer'

describe('SQL export of array columns', () => {
  it('writes PostgreSQL array literals, quoting what needs it', () => {
    expect(pgArrayLiteral(['a', 'b c', 'say "hi"', null])).toBe('{"a","b c","say \\"hi\\"",NULL}')
    expect(pgArrayLiteral([[1, 2], [3]])).toBe('{{"1","2"},{"3"}}')
    expect(isPgArrayType(1009)).toBe(true)
    expect(isPgArrayType(3802)).toBe(false)
  })

  it('exports an array column as an array and a json column as json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe-export-'))
    try {
      const path = join(dir, 'out.sql')
      const sink = createSink('sql', path, { tableName: '"query_result"' })
      await sink.start(['tags', 'meta'], [1009, 3802])
      await sink.row([['a', "it's"], ['a', 'b']])
      await sink.end()
      const text = readFileSync(path, 'utf8')
      expect(text).toContain('-- Rename "query_result"')
      expect(text).toContain(`VALUES ('{"a","it''s"}', '["a","b"]');`)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
