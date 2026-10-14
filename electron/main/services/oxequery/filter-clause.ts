import type { SqlFilter } from '../../../../shared/types/oxequery'
import { quoteIdentifier } from './sql-guard'

const MAX_FILTERS = 20
const MAX_VALUE = 4096
const COMPARE: Record<string, string> = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }

/** `%`, `_` and the escape character itself are literal in a LIKE pattern built from what a person typed. */
const likeEscape = (value: string): string => value.replace(/[\\%_]/g, match => '\\' + match)

/**
 * The WHERE clause of the table filter bar. Column names are quoted as identifiers and every
 * value travels as a parameter, so nothing a person types is ever part of the SQL text.
 * Comparisons use the column's own type (an index can serve them); the text operators compare
 * the column as text.
 */
export function buildFilterClause(filters: SqlFilter[]): { where: string; params: string[] } {
  if (filters.length === 0) return { where: '', params: [] }
  if (filters.length > MAX_FILTERS) throw new Error(`A filter can have up to ${MAX_FILTERS} conditions.`)
  const parts: string[] = []
  const params: string[] = []
  const add = (value: string): string => { params.push(value); return `$${params.length}` }
  for (const filter of filters) {
    if (typeof filter.column !== 'string' || !filter.column || filter.column.length > 255) throw new Error('A filter needs a column.')
    const column = quoteIdentifier(filter.column)
    const value = filter.value ?? ''
    if (value.length > MAX_VALUE) throw new Error('A filter value is too long.')
    switch (filter.op) {
      case 'null': parts.push(`${column} IS NULL`); break
      case 'notNull': parts.push(`${column} IS NOT NULL`); break
      case 'eq': case 'ne': case 'lt': case 'lte': case 'gt': case 'gte': parts.push(`${column} ${COMPARE[filter.op]} ${add(value)}`); break
      case 'contains': parts.push(`${column}::text ILIKE ${add(`%${likeEscape(value)}%`)}`); break
      case 'startsWith': parts.push(`${column}::text ILIKE ${add(`${likeEscape(value)}%`)}`); break
      case 'endsWith': parts.push(`${column}::text ILIKE ${add(`%${likeEscape(value)}`)}`); break
      case 'in': {
        const items = value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 200)
        if (items.length === 0) throw new Error('List at least one value for "is one of".')
        // One parameter holds the list (as JSON text), so any number of values is still one placeholder.
        parts.push(`${column}::text = ANY (ARRAY(SELECT jsonb_array_elements_text(${add(JSON.stringify(items))}::jsonb)))`)
        break
      }
      default: throw new Error('That filter is not supported.')
    }
  }
  return { where: ` WHERE ${parts.join(' AND ')}`, params }
}
