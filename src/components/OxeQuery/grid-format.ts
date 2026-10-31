/** How a result is written when it is copied: text for a spreadsheet, a chat, a document or another database. */

export type CopyFormat = 'csv' | 'tsv' | 'json' | 'markdown' | 'insert'

/** How a missing value is written in every language: it is the SQL keyword, not a word to translate. */
export const SQL_NULL = 'NULL'

export function displayCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  return typeof value === 'string' ? value : String(value)
}

function plain(value: unknown): string {
  return value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value)
}

function delimited(columns: string[], rows: unknown[][], delimiter: string): string {
  const field = (value: unknown): string => {
    const text = plain(value)
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [columns.map(field).join(delimiter), ...rows.map(row => row.map(field).join(delimiter))].join('\n')
}

export const toCsv = (columns: string[], rows: unknown[][]): string => delimited(columns, rows, ',')
export const toTsv = (columns: string[], rows: unknown[][]): string => delimited(columns, rows, '\t')

export function toJsonRows(columns: string[], rows: unknown[][]): string {
  return JSON.stringify(rows.map(row => Object.fromEntries(columns.map((name, index) => [name, row[index]]))), null, 2)
}

export function toMarkdown(columns: string[], rows: unknown[][]): string {
  const cell = (value: unknown): string => (value === null || value === undefined ? '' : plain(value)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  return [`| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n')
}

const quoteIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return `'${plain(value).replace(/'/g, "''")}'`
}

/** One INSERT per row. `table` is already a quoted, qualified name (or a placeholder to rename). */
export function toInsert(columns: string[], rows: unknown[][], table = '"table_name"'): string {
  const names = columns.map(quoteIdentifier).join(', ')
  return rows.map(row => `INSERT INTO ${table} (${names}) VALUES (${row.map(sqlLiteral).join(', ')});`).join('\n')
}

export function formatRows(format: CopyFormat, columns: string[], rows: unknown[][], table?: string): string {
  switch (format) {
    case 'csv': return toCsv(columns, rows)
    case 'tsv': return toTsv(columns, rows)
    case 'json': return toJsonRows(columns, rows)
    case 'markdown': return toMarkdown(columns, rows)
    case 'insert': return toInsert(columns, rows, table)
  }
}

/** A rectangular selection of cells: inclusive row and column ranges, in display order. */
export interface CellRange { rowStart: number; rowEnd: number; columnStart: number; columnEnd: number }

export function normalizeRange(anchor: { row: number; column: number }, focus: { row: number; column: number }): CellRange {
  return {
    rowStart: Math.min(anchor.row, focus.row), rowEnd: Math.max(anchor.row, focus.row),
    columnStart: Math.min(anchor.column, focus.column), columnEnd: Math.max(anchor.column, focus.column)
  }
}

/** The cells of a range as columns and rows, ready for `formatRows`. `order` maps display rows to data rows. */
export function sliceRange(columns: string[], rows: unknown[][], range: CellRange, order?: number[] | null): { columns: string[]; rows: unknown[][] } {
  const picked: unknown[][] = []
  for (let position = range.rowStart; position <= range.rowEnd; position++) {
    const row = rows[order ? order[position] : position]
    if (row) picked.push(row.slice(range.columnStart, range.columnEnd + 1))
  }
  return { columns: columns.slice(range.columnStart, range.columnEnd + 1), rows: picked }
}

/** Orders row indexes by one column. Numbers compare as numbers, NULL sorts last, everything else as text. */
export function sortedOrder(rows: unknown[][], column: number, direction: 'asc' | 'desc'): number[] {
  const factor = direction === 'asc' ? 1 : -1
  const indexes = rows.map((_, index) => index)
  return indexes.sort((left, right) => {
    const a = rows[left][column], b = rows[right][column]
    if (a === null || a === undefined) return b === null || b === undefined ? left - right : 1
    if (b === null || b === undefined) return -1
    const numeric = typeof a === 'number' && typeof b === 'number'
    const compared = numeric ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })
    return compared * factor || left - right
  })
}

/** How a cell is shown in the detail viewer: pretty JSON when it parses as an object or array. */
export function describeCell(value: unknown): { text: string; kind: 'null' | 'json' | 'binary' | 'text' } {
  if (value === null || value === undefined) return { text: 'NULL', kind: 'null' }
  const text = typeof value === 'string' ? value : String(value)
  if (typeof value === 'string' && /^\\x[0-9a-f]*(…|$)/i.test(value)) return { text, kind: 'binary' }
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try { const parsed: unknown = JSON.parse(value); if (parsed && typeof parsed === 'object') return { text: JSON.stringify(parsed, null, 2), kind: 'json' } } catch { /* plain text */ }
  }
  return { text, kind: 'text' }
}
