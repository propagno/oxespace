/**
 * Client-side view of the rows already loaded: which rows pass a filter, in what order, which columns are pinned,
 * and how a json / array cell is read. Nothing here re-runs a query or looks outside the rows it is given.
 */
import { SQL_NULL, sortedOrder } from './grid-format'

export interface GridFilter {
  /** Matches any column. */
  text: string
  /** Column index → text that column must contain. */
  columns: Record<number, string>
}

export const EMPTY_FILTER: GridFilter = { text: '', columns: {} }

export const isFiltering = (filter: GridFilter): boolean => filter.text.trim() !== '' || Object.values(filter.columns).some(value => value.trim() !== '')

/** How a value reads when filtering: the same text the grid shows, so what you see is what matches. */
function haystack(value: unknown): string {
  if (value === null || value === undefined) return SQL_NULL.toLowerCase()
  if (typeof value === 'string') return value.toLowerCase()
  if (typeof value === 'object') { try { return JSON.stringify(value).toLowerCase() } catch { return '' } }
  return String(value).toLowerCase()
}

/**
 * Original indices of the rows to show, filtered (case-insensitive "contains") and then sorted. `null` means
 * "all rows, as loaded" so an untouched grid pays nothing.
 */
export function viewOrder(rows: unknown[][], filter: GridFilter, sort: { column: number; direction: 'asc' | 'desc' } | null): number[] | null {
  const needles = Object.entries(filter.columns).map(([column, text]) => [Number(column), text.trim().toLowerCase()] as const).filter(([, text]) => text !== '')
  const any = filter.text.trim().toLowerCase()
  let indices: number[] | null = null
  if (any || needles.length > 0) {
    indices = []
    rows.forEach((row, index) => {
      if (needles.some(([column, text]) => !haystack(row[column]).includes(text))) return
      if (any && !row.some(value => haystack(value).includes(any))) return
      indices!.push(index)
    })
  }
  if (!sort) return indices
  const sorted = sortedOrder(rows, sort.column, sort.direction)
  if (!indices) return sorted
  const keep = new Set(indices)
  return sorted.filter(index => keep.has(index))
}

/** Visible columns with the pinned ones first, each group in its original order. */
export function pinColumns(visible: number[], pinned: ReadonlySet<number>): number[] {
  return [...visible.filter(index => pinned.has(index)), ...visible.filter(index => !pinned.has(index))]
}

/** Left offset of each pinned column, after the row-number column of `indexWidth`. */
export function pinOffsets(ordered: number[], pinned: ReadonlySet<number>, widthOf: (column: number) => number, indexWidth: number): Map<number, number> {
  const offsets = new Map<number, number>()
  let left = indexWidth
  for (const column of ordered) {
    if (!pinned.has(column)) break
    offsets.set(column, left)
    left += widthOf(column)
  }
  return offsets
}

/** What a json / array cell holds, ready to draw. */
export type CellContent =
  | { kind: 'json'; data: unknown }
  | { kind: 'array'; items: (string | null)[] }
  | { kind: 'other' }

const isArrayType = (type: string | undefined): boolean => Boolean(type && (/\[\]$/.test(type) || /^_/.test(type) || /^array$/i.test(type)))
const isJsonType = (type: string | undefined): boolean => Boolean(type && /^jsonb?$/i.test(type))

/** Elements of a one-level PostgreSQL array literal such as `{a,"b c",NULL}`; nested arrays stay as text. */
export function parsePgArray(literal: string): (string | null)[] | null {
  const text = literal.trim()
  if (!text.startsWith('{') || !text.endsWith('}')) return null
  const inner = text.slice(1, -1)
  const items: (string | null)[] = []
  let i = 0
  if (inner === '') return items
  while (i <= inner.length) {
    if (inner[i] === '"') {
      let value = ''
      i++
      while (i < inner.length && inner[i] !== '"') { if (inner[i] === '\\') i++; value += inner[i] ?? ''; i++ }
      items.push(value)
      i++
    } else if (inner[i] === '{') {
      let depth = 0
      const from = i
      for (; i < inner.length; i++) { if (inner[i] === '{') depth++; else if (inner[i] === '}' && --depth === 0) { i++; break } }
      items.push(inner.slice(from, i))
    } else {
      const end = inner.indexOf(',', i)
      const raw = inner.slice(i, end < 0 ? inner.length : end).trim()
      items.push(raw.toUpperCase() === 'NULL' ? null : raw)
      i = end < 0 ? inner.length : end
    }
    if (i >= inner.length) break
    if (inner[i] !== ',') return null
    i++
  }
  return items
}

/** Classifies a cell by its declared type first and its shape second; anything unsure is `other`. */
export function readCell(value: unknown, type?: string): CellContent {
  if (value === null || value === undefined) return { kind: 'other' }
  if (Array.isArray(value)) return { kind: 'array', items: value.map(item => item === null || item === undefined ? null : typeof item === 'string' ? item : JSON.stringify(item)) }
  if (typeof value === 'object') return { kind: 'json', data: value }
  if (typeof value !== 'string') return { kind: 'other' }
  if (isJsonType(type) || /^\s*[[{]/.test(value)) {
    if (!isArrayType(type)) {
      try {
        const data: unknown = JSON.parse(value)
        if (data !== null && typeof data === 'object') return { kind: 'json', data }
      } catch { /* not json: maybe an array literal */ }
    }
  }
  if (isArrayType(type)) {
    const items = parsePgArray(value)
    if (items) return { kind: 'array', items }
  }
  return { kind: 'other' }
}
