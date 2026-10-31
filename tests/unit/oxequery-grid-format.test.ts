import { describe, expect, it } from 'vitest'
import { describeCell, formatRows, normalizeRange, sliceRange, sortedOrder, toInsert, toMarkdown, toTsv } from '../../src/components/OxeQuery/grid-format'

const columns = ['id', 'name', 'note']
const rows: unknown[][] = [[1, 'Ana', null], [2, "O'Neil", 'a|b'], [3, 'say "hi"', 'line1\nline2']]

describe('copy formats', () => {
  it('writes CSV and TSV with quoting only where needed', () => {
    expect(formatRows('csv', columns, rows)).toBe('id,name,note\n1,Ana,\n2,O\'Neil,a|b\n3,"say ""hi""","line1\nline2"')
    expect(toTsv(['a'], [['x\ty']])).toBe('a\n"x\ty"')
  })

  it('writes a Markdown table that survives pipes and newlines', () => {
    expect(toMarkdown(columns, rows)).toBe('| id | name | note |\n| --- | --- | --- |\n| 1 | Ana |  |\n| 2 | O\'Neil | a\\|b |\n| 3 | say "hi" | line1 line2 |')
  })

  it('writes INSERT statements with quoted identifiers and escaped text', () => {
    expect(toInsert(['id', 'we"ird'], [[1, "it's"], [null, true]], '"public"."t"')).toBe(
      'INSERT INTO "public"."t" ("id", "we""ird") VALUES (1, \'it\'\'s\');\nINSERT INTO "public"."t" ("id", "we""ird") VALUES (NULL, TRUE);')
    expect(formatRows('json', ['a'], [[1]])).toBe('[\n  {\n    "a": 1\n  }\n]')
  })
})

describe('selection', () => {
  it('normalizes a range in any direction and slices the cells of the display order', () => {
    expect(normalizeRange({ row: 2, column: 2 }, { row: 0, column: 1 })).toEqual({ rowStart: 0, rowEnd: 2, columnStart: 1, columnEnd: 2 })
    const order = sortedOrder(rows, 0, 'desc')
    expect(order).toEqual([2, 1, 0])
    expect(sliceRange(columns, rows, { rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 1 }, order)).toEqual({ columns: ['id', 'name'], rows: [[3, 'say "hi"'], [2, "O'Neil"]] })
  })
})

describe('describeCell', () => {
  it('tells NULL, JSON, binary and text apart', () => {
    expect(describeCell(null)).toEqual({ text: 'NULL', kind: 'null' })
    expect(describeCell('{"a":[1,2]}').kind).toBe('json')
    expect(describeCell('{"a":[1,2]}').text).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}')
    expect(describeCell('\\xdeadbeef… (400 bytes)').kind).toBe('binary')
    expect(describeCell('{ not json').kind).toBe('text')
    expect(describeCell(42)).toEqual({ text: '42', kind: 'text' })
  })
})
