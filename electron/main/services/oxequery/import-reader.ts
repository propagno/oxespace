import { createReadStream } from 'node:fs'
import { open, readFile, stat, type FileHandle } from 'node:fs/promises'
import { OxeQueryError } from './oxequery-errors'

export type ImportFormat = 'csv' | 'ndjson' | 'json'
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024

export type ImportItem =
  | { row: number; record: Record<string, unknown> }
  | { row: number; error: string; raw?: string }

/** `<source>.rejects.ndjson` beside the imported file; never overwrites an earlier report. */
export async function openRejects(sourcePath: string): Promise<{ path: string; write(line: string): Promise<void>; close(): Promise<void> } | null> {
  for (const candidate of [`${sourcePath}.rejects.ndjson`, `${sourcePath}.rejects-${Date.now()}.ndjson`]) {
    try {
      const handle = await open(candidate, 'wx', 0o600)
      return { path: candidate, write: async line => { await handle.write(line) }, close: async () => { await handle.close().catch(() => undefined) } }
    } catch { /* try the next name */ }
  }
  return null
}

export function detectFormat(path: string): ImportFormat {
  const extension = path.toLowerCase().split('.').pop()
  if (extension === 'csv' || extension === 'tsv') return 'csv'
  if (extension === 'ndjson' || extension === 'jsonl') return 'ndjson'
  if (extension === 'json') return 'json'
  throw new OxeQueryError('invalid', 'Choose a .csv, .tsv, .json or .ndjson file.')
}

export async function checkSize(path: string): Promise<number> {
  const info = await stat(path)
  if (!info.isFile()) throw new OxeQueryError('invalid', 'That is not a file.')
  if (info.size > MAX_IMPORT_BYTES) throw new OxeQueryError('invalid', `That file is larger than the ${MAX_IMPORT_BYTES / 1024 / 1024} MB import limit.`)
  return info.size
}

/** RFC 4180 records from a text stream: quoted fields, doubled quotes, newlines inside quotes. */
export async function* parseCsv(chunks: AsyncIterable<string>, delimiter: string): AsyncGenerator<string[]> {
  let field = ''
  let record: string[] = []
  let quoted = false
  // A quote seen last in a chunk is either the end of the field or half of a doubled quote.
  let quoteAtEdge = false
  let carriageReturn = false
  let sawAny = false
  for await (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk[index]
      sawAny = true
      if (quoteAtEdge) {
        quoteAtEdge = false
        if (char === '"') { field += '"'; continue }
        quoted = false
      }
      if (carriageReturn) {
        carriageReturn = false
        if (char === '\n') continue
      }
      if (quoted) {
        if (char !== '"') field += char
        else if (index + 1 === chunk.length) quoteAtEdge = true
        else if (chunk[index + 1] === '"') { field += '"'; index++ } else quoted = false
        continue
      }
      if (char === '"' && field === '') quoted = true
      else if (char === delimiter) { record.push(field); field = '' }
      else if (char === '\n' || char === '\r') {
        carriageReturn = char === '\r'
        record.push(field); field = ''
        if (!(record.length === 1 && record[0] === '')) yield record
        record = []
      } else field += char
    }
  }
  if (sawAny && (field !== '' || record.length > 0)) { record.push(field); yield record }
}

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

/** The encoding of a text file: a byte-order mark decides, else strict UTF-8, else Windows-1252 (what Excel in Brazil, Portugal and most of Europe writes). */
export function detectEncoding(head: Buffer): { encoding: TextEncodingName; bomLength: number } {
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return { encoding: 'utf-8', bomLength: 3 }
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return { encoding: 'utf-16le', bomLength: 2 }
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return { encoding: 'utf-16be', bomLength: 2 }
  try {
    // A sample can end in the middle of a character; that is not evidence against UTF-8.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true })
    return { encoding: 'utf-8', bomLength: 0 }
  } catch { return { encoding: 'windows-1252', bomLength: 0 } }
}

async function readHead(path: string): Promise<Buffer> {
  let handle: FileHandle | undefined
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally { await handle?.close() }
}

async function sniff(path: string): Promise<string> {
  const head = await readHead(path)
  const { encoding, bomLength } = detectEncoding(head)
  return new TextDecoder(encoding).decode(head.subarray(bomLength, bomLength + 8192))
}

async function* textChunks(path: string): AsyncGenerator<string> {
  const { encoding, bomLength } = detectEncoding(await readHead(path))
  const decoder = new TextDecoder(encoding)
  let skip = bomLength
  for await (const chunk of createReadStream(path, { highWaterMark: 256 * 1024 })) {
    let bytes = chunk as Buffer
    if (skip > 0) { bytes = bytes.subarray(skip); skip = 0 }
    const text = decoder.decode(bytes, { stream: true })
    if (text) yield text
  }
  const rest = decoder.decode()
  if (rest) yield rest
}

/** Records of the file, one per row, each as an object. A bad row is reported, not fatal. */
export async function* readRecords(path: string, format: ImportFormat): AsyncGenerator<ImportItem> {
  await checkSize(path)
  if (format === 'csv') {
    const head = (await sniff(path)).split(/\r?\n/, 1)[0] ?? ''
    const delimiter = path.toLowerCase().endsWith('.tsv') ? '\t' : [',', ';', '\t'].map(item => [item, head.split(item).length] as const).sort((a, b) => b[1] - a[1])[0][0]
    let header: string[] | null = null
    let row = 0
    for await (const fields of parseCsv(textChunks(path), delimiter)) {
      if (!header) {
        header = fields.map((name, index) => name.trim() || `column_${index + 1}`)
        if (new Set(header).size !== header.length) throw new OxeQueryError('invalid', 'The CSV header has repeated column names.')
        continue
      }
      row++
      if (fields.length !== header.length) { yield { row, error: `Expected ${header.length} fields but found ${fields.length}.`, raw: fields.join(delimiter).slice(0, 300) }; continue }
      yield { row, record: Object.fromEntries(header.map((name, index) => [name, fields[index]])) }
    }
    return
  }
  if (format === 'ndjson') {
    let row = 0
    let pending = ''
    const handle = async function* (line: string): AsyncGenerator<ImportItem> {
      if (!line.trim()) return
      row++
      try {
        const value = JSON.parse(line) as unknown
        if (!value || typeof value !== 'object' || Array.isArray(value)) yield { row, error: 'A line must be a JSON object.', raw: line.slice(0, 300) }
        else yield { row, record: value as Record<string, unknown> }
      } catch { yield { row, error: 'The line is not valid JSON.', raw: line.slice(0, 300) } }
    }
    for await (const chunk of textChunks(path)) {
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        yield* handle(pending.slice(0, newline).replace(/\r$/, ''))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
    }
    yield* handle(pending)
    return
  }
  let parsed: unknown
  try {
    const bytes = await readFile(path)
    const { encoding, bomLength } = detectEncoding(bytes.subarray(0, 64 * 1024))
    parsed = JSON.parse(new TextDecoder(encoding).decode(bytes.subarray(bomLength)))
  } catch { throw new OxeQueryError('invalid', 'The file is not valid JSON.') }
  if (!Array.isArray(parsed)) throw new OxeQueryError('invalid', 'A JSON import must be an array of objects.')
  let row = 0
  for (const value of parsed) {
    row++
    if (!value || typeof value !== 'object' || Array.isArray(value)) yield { row, error: 'An entry must be a JSON object.', raw: JSON.stringify(value)?.slice(0, 300) }
    else yield { row, record: value as Record<string, unknown> }
  }
}
