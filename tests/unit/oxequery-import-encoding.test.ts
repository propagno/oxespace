import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectEncoding, readRecords, type ImportItem } from '../../electron/main/services/oxequery/import-reader'

const dir = mkdtempSync(join(tmpdir(), 'oxe-encoding-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function records(name: string, bytes: Buffer, format: 'csv' | 'ndjson' | 'json' = 'csv'): Promise<Record<string, unknown>[]> {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  const out: Record<string, unknown>[] = []
  for await (const item of readRecords(path, format) as AsyncGenerator<ImportItem>) if ('record' in item) out.push(item.record)
  return out
}

describe('import encodings', () => {
  it('reads Windows-1252 (Excel in Portugal and Brazil) instead of producing replacement characters', async () => {
    const latin = Buffer.from([...Buffer.from('nome;cidade\r\n'), ...Buffer.from('Jo'), 0xe3, ...Buffer.from('o;S'), 0xe3, ...Buffer.from('o Paulo\r\n')])
    expect(await records('latin.csv', latin)).toEqual([{ nome: 'João', cidade: 'São Paulo' }])
  })

  it('reads UTF-8, with or without a byte-order mark, and UTF-16', async () => {
    expect(await records('utf8.csv', Buffer.from('a,b\nçã,ü\n'))).toEqual([{ a: 'çã', b: 'ü' }])
    expect(await records('bom.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n1,2\n')]))).toEqual([{ a: '1', b: '2' }])
    expect(await records('utf16.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a,b\n1,é\n', 'utf16le')]))).toEqual([{ a: '1', b: 'é' }])
  })

  it('applies the same detection to NDJSON and JSON', async () => {
    const latinJson = Buffer.from([...Buffer.from('[{"nome":"Jo'), 0xe3, ...Buffer.from('o"}]')])
    expect(await records('latin.json', latinJson, 'json')).toEqual([{ nome: 'João' }])
    expect(await records('x.ndjson', Buffer.from('{"a":"é"}\n{"a":"b"}\n'), 'ndjson')).toEqual([{ a: 'é' }, { a: 'b' }])
  })

  it('does not call a sample cut mid-character invalid UTF-8', () => {
    const text = Buffer.from('aé')
    expect(detectEncoding(text.subarray(0, 2)).encoding).toBe('utf-8')
    expect(detectEncoding(Buffer.from([0x61, 0xe9, 0x62])).encoding).toBe('windows-1252')
  })
})
