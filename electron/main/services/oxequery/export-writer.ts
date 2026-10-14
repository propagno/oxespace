import { createWriteStream, type WriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import type { ExportFormat } from '../../../../shared/types/oxequery'

export interface ExportOptions {
  delimiter?: ',' | ';' | '\t'
  header?: boolean
  bom?: boolean
  /** Name used by the SQL format; schema-qualified identifiers are quoted by the caller. */
  tableName?: string
}

/** A value as it is written to a file: never truncated, never lossy for a number or a timestamp. */
export function exportValue(value: unknown): string | number | boolean | null | unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`
  return value
}

function text(value: unknown): string {
  const normalized = exportValue(value)
  if (normalized === null) return ''
  return typeof normalized === 'object' ? JSON.stringify(normalized) : String(normalized)
}

export function csvField(value: unknown, delimiter: string): string {
  const raw = text(value)
  // A leading = + - @ makes a spreadsheet run the cell as a formula; a tab or CR does the same in some tools.
  const guarded = /^[=+\-@\t\r]/.test(raw) && !/^[+-]?\d+(\.\d+)?$/.test(raw) ? `'${raw}` : raw
  return guarded.includes(delimiter) || /["\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** Array types of PostgreSQL by OID: a JS array from one of these is an array value, from json/jsonb it is JSON. */
const PG_ARRAY_OIDS = new Set([199, 1000, 1001, 1005, 1007, 1009, 1014, 1015, 1016, 1021, 1022, 1115, 1182, 1183, 1185, 1231, 2951, 3807])

export const isPgArrayType = (oid: number | undefined): boolean => oid !== undefined && PG_ARRAY_OIDS.has(oid)

/** `{a,"b c",NULL,{1,2}}`: the text form of an array that PostgreSQL reads back. */
export function pgArrayLiteral(values: unknown[]): string {
  const element = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL'
    if (Array.isArray(value)) return pgArrayLiteral(value)
    const raw = typeof value === 'object' ? JSON.stringify(exportValue(value)) : String(exportValue(value))
    return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return `{${values.map(element).join(',')}}`
}

function sqlLiteral(value: unknown, arrayColumn = false): string {
  if (arrayColumn && Array.isArray(value)) return `'${pgArrayLiteral(value).replace(/'/g, "''")}'`
  const normalized = exportValue(value)
  if (normalized === null) return 'NULL'
  if (typeof normalized === 'number') return Number.isFinite(normalized) ? String(normalized) : 'NULL'
  if (typeof normalized === 'boolean') return normalized ? 'TRUE' : 'FALSE'
  const raw = typeof normalized === 'object' ? JSON.stringify(normalized) : String(normalized)
  return `'${raw.replace(/'/g, "''")}'`
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export interface RowSink {
  /** Called once with the column names, before any row. */
  start(columns: string[], typeOids?: number[]): Promise<void>
  row(values: unknown[]): Promise<void>
  end(): Promise<void>
  /** Closes and deletes a partial file. */
  abort(): Promise<void>
  readonly bytes: number
}

/** A sink that writes `format` to a new file. An existing file is never overwritten. */
export function createSink(format: ExportFormat, path: string, options: ExportOptions = {}): RowSink {
  const stream: WriteStream = createWriteStream(path, { flags: 'wx', mode: 0o600 })
  let bytes = 0
  let columns: string[] = []
  let arrayColumns: boolean[] = []
  let rows = 0
  let failure: Error | null = null
  stream.on('error', error => { failure = error })
  // `wx` fails when the file exists; that must surface before the first write, not later.
  const opened = new Promise<void>((resolve, reject) => { stream.once('open', () => resolve()); stream.once('error', reject) })
  opened.catch(() => undefined)
  // Only a file this sink created may be removed; with `wx` a failed open means someone else's file is there.
  let created = false
  stream.once('open', () => { created = true })

  const write = (chunk: string): Promise<void> => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return }
    bytes += Buffer.byteLength(chunk)
    if (stream.write(chunk)) resolve()
    else stream.once('drain', () => (failure ? reject(failure) : resolve()))
  })
  const close = (): Promise<void> => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return }
    stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
  })
  const delimiter = options.delimiter ?? ','
  const asObject = (values: unknown[]): Record<string, unknown> => Object.fromEntries(columns.map((name, index) => [name, exportValue(values[index])]))

  return {
    get bytes() { return bytes },
    async start(names, typeOids) {
      await opened
      columns = names
      arrayColumns = names.map((_name, index) => isPgArrayType(typeOids?.[index]))
      if (format === 'sql' && options.tableName === '"query_result"') await write('-- Rename "query_result" to the table these rows belong in.\n')
      if (format === 'csv') {
        if (options.bom) await write('﻿')
        if (options.header !== false) await write(`${names.map(name => csvField(name, delimiter)).join(delimiter)}\r\n`)
      } else if (format === 'json') await write('[')
    },
    async row(values) {
      if (format === 'csv') await write(`${values.map(value => csvField(value, delimiter)).join(delimiter)}\r\n`)
      else if (format === 'ndjson') await write(`${JSON.stringify(asObject(values))}\n`)
      else if (format === 'json') await write(`${rows === 0 ? '\n  ' : ',\n  '}${JSON.stringify(asObject(values))}`)
      else await write(`INSERT INTO ${options.tableName ?? '"export"'} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${values.map((value, index) => sqlLiteral(value, arrayColumns[index])).join(', ')});\n`)
      rows++
    },
    async end() {
      if (format === 'json') await write(rows === 0 ? ']\n' : '\n]\n')
      await close()
    },
    async abort() {
      failure ??= new Error('aborted')
      stream.destroy()
      if (created) await unlink(path).catch(() => undefined)
    }
  }
}
