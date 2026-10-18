import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectFormat, parseCsv, readRecords } from '../../electron/main/services/oxequery/import-reader'

const dir = mkdtempSync(join(tmpdir(), 'oxe-import-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const item of source) out.push(item)
  return out
}
async function* chunked(text: string, size: number): AsyncGenerator<string> {
  for (let index = 0; index < text.length; index += size) yield text.slice(index, index + size)
}

describe('csv parser', () => {
  it('handles quotes, embedded newlines and CRLF', async () => {
    const text = 'a,b\r\n1,"he said ""hi"""\r\n2,"line1\nline2"\r\n'
    expect(await collect(parseCsv(chunked(text, 1000), ','))).toEqual([['a', 'b'], ['1', 'he said "hi"'], ['2', 'line1\nline2']])
  })
  it('is independent of how the stream is chunked', async () => {
    const text = 'a,b\n1,"x""y"\n2,"p,q"\n3,\n'
    const whole = await collect(parseCsv(chunked(text, 1000), ','))
    for (const size of [1, 2, 3, 5, 7]) expect(await collect(parseCsv(chunked(text, size), ','))).toEqual(whole)
    expect(whole).toEqual([['a', 'b'], ['1', 'x"y'], ['2', 'p,q'], ['3', '']])
  })
})

describe('readRecords', () => {
  it('reads csv with a semicolon delimiter and reports short rows', async () => {
    const path = join(dir, 'semi.csv')
    writeFileSync(path, 'id;name\n1;Ana\n2\n3;Caio\n')
    const items = await collect(readRecords(path, 'csv')) as { row: number; record?: Record<string, string>; error?: string }[]
    expect(items.map(item => item.record?.name ?? item.error)).toEqual(['Ana', 'Expected 2 fields but found 1.', 'Caio'])
    expect(items[1].row).toBe(2)
  })
  it('rejects a bad ndjson line without stopping', async () => {
    const path = join(dir, 'a.ndjson')
    writeFileSync(path, '{"a":1}\nnot json\n[1]\n{"a":2}\n')
    const items = await collect(readRecords(path, 'ndjson')) as { record?: { a: number }; error?: string }[]
    expect(items.filter(item => item.record).map(item => item.record!.a)).toEqual([1, 2])
    expect(items.filter(item => item.error)).toHaveLength(2)
  })
  it('requires an array of objects for json', async () => {
    const path = join(dir, 'o.json')
    writeFileSync(path, '{"a":1}')
    await expect(collect(readRecords(path, 'json'))).rejects.toThrow(/array/)
  })
  it('chooses a format from the extension and refuses others', () => {
    expect(detectFormat('x.CSV')).toBe('csv')
    expect(detectFormat('x.jsonl')).toBe('ndjson')
    expect(() => detectFormat('x.xlsx')).toThrow()
  })
})
