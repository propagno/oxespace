import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSink, csvField, exportValue } from '../../electron/main/services/oxequery/export-writer'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
const temp = (): string => { const directory = mkdtempSync(join(tmpdir(), 'oxe-export-')); directories.push(directory); return directory }

async function write(format: Parameters<typeof createSink>[0], rows: unknown[][], options: Parameters<typeof createSink>[2] = {}): Promise<string> {
  const path = join(temp(), `out.${format}`)
  const sink = createSink(format, path, options)
  await sink.start(['id', 'name', 'seen'])
  for (const row of rows) await sink.row(row)
  await sink.end()
  return readFileSync(path, 'utf8')
}

const rows: unknown[][] = [[1, 'Ana, "the" boss', new Date('2026-10-11T10:00:00Z')], [2n, null, null], [3, 'line\nbreak', Buffer.from('ab')]]

describe('export formats', () => {
  it('writes CSV with quoting, a header and a BOM on request', async () => {
    const csv = await write('csv', rows, { bom: true })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1)).toBe('id,name,seen\r\n1,"Ana, ""the"" boss",2026-10-11T10:00:00.000Z\r\n2,,\r\n3,"line\nbreak",\\x6162\r\n')
    expect(await write('csv', [[1, 'a', 'b']], { delimiter: ';', header: false })).toBe('1;a;b\r\n')
  })

  it('does not let a cell run as a spreadsheet formula', () => {
    expect(csvField('=HYPERLINK("http://x")', ',')).toBe('"\'=HYPERLINK(""http://x"")"')
    expect(csvField('+1 555', ',')).toBe("'+1 555")
    expect(csvField('-5', ',')).toBe('-5')
    expect(csvField('@cmd', ',')).toBe("'@cmd")
  })

  it('writes JSON as one valid array, including the empty one', async () => {
    expect(JSON.parse(await write('json', rows))).toEqual([
      { id: 1, name: 'Ana, "the" boss', seen: '2026-10-11T10:00:00.000Z' }, { id: '2', name: null, seen: null }, { id: 3, name: 'line\nbreak', seen: '\\x6162' }
    ])
    expect(JSON.parse(await write('json', []))).toEqual([])
  })

  it('writes NDJSON one object per line', async () => {
    const lines = (await write('ndjson', rows)).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[1])).toEqual({ id: '2', name: null, seen: null })
  })

  it('writes SQL INSERT statements with quoted identifiers and escaped literals', async () => {
    const sql = await write('sql', [[1, "O'Brien", null], [2, true, 3.5]], { tableName: '"public"."people"' })
    expect(sql).toBe(`INSERT INTO "public"."people" ("id", "name", "seen") VALUES (1, 'O''Brien', NULL);\nINSERT INTO "public"."people" ("id", "name", "seen") VALUES (2, TRUE, 3.5);\n`)
  })

  it('never overwrites an existing file and removes a partial one when aborted', async () => {
    const directory = temp()
    const path = join(directory, 'taken.csv')
    writeFileSync(path, 'precious')
    const blocked = createSink('csv', path)
    await expect(blocked.start(['a'])).rejects.toThrow()
    // The cleanup after a failed export must not delete the file that blocked it.
    await blocked.abort()
    expect(readFileSync(path, 'utf8')).toBe('precious')

    const partial = join(directory, 'partial.csv')
    const sink = createSink('csv', partial)
    await sink.start(['a'])
    await sink.row([1])
    await sink.abort()
    expect(existsSync(partial)).toBe(false)
  })

  it('keeps numbers and timestamps exact', () => {
    expect(exportValue(10n ** 20n)).toBe('100000000000000000000')
    expect(exportValue(new Date(NaN))).toBeNull()
    expect(exportValue(undefined)).toBeNull()
    expect(exportValue(1.5)).toBe(1.5)
  })
})
