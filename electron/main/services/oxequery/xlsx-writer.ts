import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, open, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeflateRaw, deflateRawSync } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable, Writable } from 'node:stream'
import { OxeQueryError } from './oxequery-errors'
import { exportValue, type RowSink } from './export-writer'

/** Rows an Excel sheet can hold, header included. */
export const XLSX_MAX_ROWS = 1_048_576
const XLSX_MAX_COLUMNS = 16_384

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

export function crc32(data: Buffer, previous = 0): number {
  let crc = ~previous >>> 0
  for (let index = 0; index < data.length; index++) crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8)
  return ~crc >>> 0
}

/** `A`, `B`, … `Z`, `AA`: the column letters of a spreadsheet. */
export function columnName(index: number): string {
  let name = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name
  return name
}

/** Text safe inside XML: markup escaped, and the control characters XML 1.0 cannot carry removed. */
export function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * One cell. Numbers stay numbers, booleans stay booleans, everything else is text. A string that would
 * run as a formula in a spreadsheet is written as plain text (an inline string is never evaluated, but
 * the leading apostrophe makes the intent visible when the cell is edited).
 */
export function cellXml(reference: string, value: unknown, style = 0): string {
  const normalized = exportValue(value)
  const s = style ? ` s="${style}"` : ''
  if (normalized === null) return ''
  if (typeof normalized === 'number' && Number.isFinite(normalized)) return `<c r="${reference}"${s}><v>${normalized}</v></c>`
  if (typeof normalized === 'boolean') return `<c r="${reference}"${s} t="b"><v>${normalized ? 1 : 0}</v></c>`
  const raw = typeof normalized === 'object' ? JSON.stringify(normalized) : String(normalized)
  const text = /^[=+\-@]/.test(raw) && !/^[+-]?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : ''
  return `<c r="${reference}"${s} t="inlineStr"><is><t${preserve}>${xmlText(text.slice(0, 32_767))}</t></is></c>`
}

interface ZipEntry { name: string; offset: number; crc: number; compressed: number; size: number }

const dosTime = (date: Date): { time: number; date: number } => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  date: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
})

/**
 * A ZIP file written entry by entry: small parts from memory, the sheet streamed from disk through
 * deflate, so a million rows never sit in memory at once.
 */
async function writeZip(target: string, parts: { name: string; data: Buffer }[], sheet: { name: string; path: string }): Promise<void> {
  const output = await open(target, 'wx', 0o600)
  const entries: ZipEntry[] = []
  let offset = 0
  const stamp = dosTime(new Date())
  const write = async (chunk: Buffer): Promise<void> => { await output.write(chunk); offset += chunk.length }
  const localHeader = (name: Buffer, flags: number, method: number, crc: number, compressed: number, size: number): Buffer => {
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags | 0x0800, 6); header.writeUInt16LE(method, 8)
    header.writeUInt16LE(stamp.time, 10); header.writeUInt16LE(stamp.date, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed, 18); header.writeUInt32LE(size, 22)
    header.writeUInt16LE(name.length, 26); header.writeUInt16LE(0, 28)
    return Buffer.concat([header, name])
  }
  try {
    for (const part of parts) {
      const name = Buffer.from(part.name, 'utf8')
      const compressed = deflateRawSync(part.data)
      const crc = crc32(part.data)
      entries.push({ name: part.name, offset, crc, compressed: compressed.length, size: part.data.length })
      await write(localHeader(name, 0, 8, crc, compressed.length, part.data.length))
      await write(compressed)
    }
    // The sheet's size and checksum are only known after it has been compressed: a data descriptor carries them.
    const sheetName = Buffer.from(sheet.name, 'utf8')
    const start = offset
    await write(localHeader(sheetName, 0x0008, 8, 0, 0, 0))
    let crc = 0
    let size = 0
    let compressed = 0
    const deflate = createDeflateRaw()
    const sink = new Writable({ write(chunk: Buffer, _encoding, callback) { compressed += chunk.length; output.write(chunk).then(() => callback(), callback) } })
    const source = Readable.from((async function* () {
      for await (const chunk of createReadStream(sheet.path, { highWaterMark: 256 * 1024 })) { const data = chunk as Buffer; crc = crc32(data, crc); size += data.length; yield data }
    })())
    await pipeline(source, deflate, sink)
    offset += compressed
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(compressed, 8); descriptor.writeUInt32LE(size, 12)
    await write(descriptor)
    entries.push({ name: sheet.name, offset: start, crc, compressed, size })

    const directoryStart = offset
    for (const entry of entries) {
      const name = Buffer.from(entry.name, 'utf8')
      const record = Buffer.alloc(46)
      record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6)
      record.writeUInt16LE(entry.name === sheet.name ? 0x0808 : 0x0800, 8); record.writeUInt16LE(8, 10)
      record.writeUInt16LE(stamp.time, 12); record.writeUInt16LE(stamp.date, 14); record.writeUInt32LE(entry.crc, 16)
      record.writeUInt32LE(entry.compressed, 20); record.writeUInt32LE(entry.size, 24); record.writeUInt16LE(name.length, 28)
      record.writeUInt32LE(entry.offset, 42)
      await write(Buffer.concat([record, name]))
    }
    const directorySize = offset - directoryStart
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(directoryStart, 16)
    await write(end)
  } finally { await output.close() }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`
const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

/** A sink that writes an Excel workbook (.xlsx): one sheet, a bold header row, numbers and booleans typed. */
export function createXlsxSink(path: string): RowSink {
  let bytes = 0
  let rows = 0
  let columns = 0
  let dir = ''
  let sheetPath = ''
  let stream: ReturnType<typeof createWriteStream> | null = null
  let reserved = false
  let failure: Error | null = null

  const write = (chunk: string): Promise<void> => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return }
    bytes += Buffer.byteLength(chunk)
    if (stream!.write(chunk)) resolve()
    else stream!.once('drain', () => (failure ? reject(failure) : resolve()))
  })
  const rowXml = (number: number, values: unknown[], style: number): string => {
    let cells = ''
    for (let index = 0; index < values.length; index++) cells += cellXml(`${columnName(index)}${number}`, values[index], style)
    return `<row r="${number}">${cells}</row>`
  }
  const cleanup = async (): Promise<void> => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined) }

  return {
    get bytes() { return bytes },
    async start(names) {
      if (names.length > XLSX_MAX_COLUMNS) throw new OxeQueryError('invalid', `Excel holds at most ${XLSX_MAX_COLUMNS} columns; this result has ${names.length}. Export it as CSV instead.`)
      // An existing file is never overwritten: say so now, before any row is read.
      const probe = await open(path, 'wx', 0o600)
      reserved = true
      await probe.close()
      dir = await mkdtemp(join(tmpdir(), 'oxequery-xlsx-'))
      sheetPath = join(dir, 'sheet1.xml')
      stream = createWriteStream(sheetPath)
      stream.on('error', error => { failure = error })
      columns = names.length
      await write(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>`)
      await write(rowXml(1, names, 1))
      rows = 1
    },
    async row(values) {
      if (rows >= XLSX_MAX_ROWS) throw new OxeQueryError('invalid', `Excel holds at most ${XLSX_MAX_ROWS.toLocaleString()} rows. Export it as CSV or NDJSON instead, or narrow the query.`)
      rows++
      await write(rowXml(rows, values.slice(0, columns), 0))
    },
    async end() {
      await write('</sheetData></worksheet>')
      await new Promise<void>((resolve, reject) => stream!.end((error?: Error | null) => (error ? reject(error) : resolve())))
      // The reservation is replaced by the real file: remove the empty placeholder, then write the workbook with 'wx'.
      await unlink(path)
      reserved = false
      try {
        await writeZip(path, [
          { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES) }, { name: '_rels/.rels', data: Buffer.from(ROOT_RELS) },
          { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK) }, { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS) }, { name: 'xl/styles.xml', data: Buffer.from(STYLES) }
        ], { name: 'xl/worksheets/sheet1.xml', path: sheetPath })
      } catch (error) {
        await unlink(path).catch(() => undefined)
        throw error
      } finally { await cleanup() }
    },
    async abort() {
      failure ??= new Error('aborted')
      stream?.destroy()
      if (reserved) await unlink(path).catch(() => undefined)
      await cleanup()
    }
  }
}
