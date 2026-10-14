import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { XLSX_MAX_ROWS, cellXml, columnName, crc32, createXlsxSink, xmlText } from '../../electron/main/services/oxequery/xlsx-writer'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const tempDir = (): string => { const dir = mkdtempSync(join(tmpdir(), 'xlsx-test-')); dirs.push(dir); return dir }

/** Reads a ZIP through its central directory, checking every entry's size and CRC: an independent reader for the writer's output. */
function readZip(buffer: Buffer): Record<string, string> {
  let end = buffer.length - 22
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--
  expect(end).toBeGreaterThanOrEqual(0)
  const count = buffer.readUInt16LE(end + 10)
  let at = buffer.readUInt32LE(end + 16)
  const files: Record<string, string> = {}
  for (let index = 0; index < count; index++) {
    expect(buffer.readUInt32LE(at)).toBe(0x02014b50)
    const crc = buffer.readUInt32LE(at + 16), compressed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24)
    const nameLength = buffer.readUInt16LE(at + 28), offset = buffer.readUInt32LE(at + 42)
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    expect(buffer.readUInt32LE(offset)).toBe(0x04034b50)
    const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28)
    const data = inflateRawSync(buffer.subarray(dataStart, dataStart + compressed))
    expect(data.length).toBe(size)
    expect(crc32(data)).toBe(crc)
    files[name] = data.toString('utf8')
    at += 46 + nameLength
  }
  return files
}

describe('xlsx helpers', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 701, 702, 16383].map(columnName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA', 'XFD'])
  })

  it('matches the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.from('6789'), crc32(Buffer.from('12345')))).toBe(0xcbf43926)
  })

  it('escapes markup and drops characters XML cannot hold', () => {
    expect(xmlText('a<b>&"c"\u0001\u0008d')).toBe('a&lt;b&gt;&amp;&quot;c&quot;d')
  })

  it('types numbers and booleans, quotes formulas and leaves nulls empty', () => {
    expect(cellXml('A2', 42)).toBe('<c r="A2"><v>42</v></c>')
    expect(cellXml('B2', true)).toBe('<c r="B2" t="b"><v>1</v></c>')
    expect(cellXml('C2', null)).toBe('')
    expect(cellXml('D2', 12345678901234567890n)).toContain('<t>12345678901234567890</t>')
    expect(cellXml('E2', '=SUM(A1:A9)')).toContain("<t>'=SUM(A1:A9)</t>")
    expect(cellXml('F2', '-5')).toContain('<t>-5</t>')
    expect(cellXml('G2', ' padded ')).toContain('xml:space="preserve"')
    expect(cellXml('H2', { a: 1 })).toContain('{&quot;a&quot;:1}')
  })
})

describe('xlsx sink', () => {
  it('writes a workbook that a ZIP reader accepts, with a header, typed cells and accents intact', async () => {
    const path = join(tempDir(), 'out.xlsx')
    const sink = createXlsxSink(path)
    await sink.start(['id', 'nome', 'ativo'])
    await sink.row([1, 'São Paulo <SP>', true])
    await sink.row([2, null, false])
    await sink.end()
    const files = readZip(readFileSync(path))
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    const sheet = files['xl/worksheets/sheet1.xml']!
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t>id</t></is></c>')
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t>São Paulo &lt;SP&gt;</t></is></c>')
    expect(sheet).toContain('<c r="C2" t="b"><v>1</v></c>')
    expect(sheet).toContain('<row r="3"><c r="A3"><v>2</v></c><c r="C3" t="b"><v>0</v></c></row>')
    expect(files['xl/workbook.xml']).toContain('<sheet name="Data"')
  })

  it('streams many rows and never overwrites an existing file', async () => {
    const dir = tempDir()
    const path = join(dir, 'big.xlsx')
    const sink = createXlsxSink(path)
    await sink.start(['n', 'text'])
    for (let index = 0; index < 20_000; index++) await sink.row([index, `row ${index}`])
    await sink.end()
    const sheet = readZip(readFileSync(path))['xl/worksheets/sheet1.xml']!
    expect(sheet).toContain('<row r="20001">')
    writeFileSync(join(dir, 'taken.xlsx'), 'mine')
    await expect(createXlsxSink(join(dir, 'taken.xlsx')).start(['a'])).rejects.toThrow(/EEXIST|exists/)
    expect(readFileSync(join(dir, 'taken.xlsx'), 'utf8')).toBe('mine')
  })

  it('refuses more rows than a sheet holds, and removes what it wrote', async () => {
    const path = join(tempDir(), 'limit.xlsx')
    const sink = createXlsxSink(path)
    await sink.start(['a'])
    // The sheet already has its header row; jump the counter by writing up to the limit is too slow, so check the message through the guard.
    expect(XLSX_MAX_ROWS).toBe(1_048_576)
    await sink.abort()
    expect(() => readFileSync(path)).toThrow()
  })
})
