import { tq } from './catalog'

export const PAGE_SIZES = [25, 50, 100, 250, 500]

/**
 * What is wrong with a JSON field, in words, or null when it is fine (or empty and allowed to be).
 * Mongo's relaxed extended JSON is plain JSON, so `{"$oid": "…"}` and `{"$date": "…"}` pass.
 */
export function jsonProblem(text: string, shape: 'object' | 'array', optional = false): string | null {
  if (text.trim() === '') return optional ? null : tq('json.empty')
  let value: unknown
  try { value = JSON.parse(text) } catch (error) { return tq('json.invalid', { reason: error instanceof Error ? error.message : tq('json.parseError') }) }
  if (shape === 'array') return Array.isArray(value) ? null : tq('json.array')
  return value && typeof value === 'object' && !Array.isArray(value) ? null : tq('json.object')
}

/** A copy of a document for a new one: the same fields without `_id`, so the server assigns another. */
export function cloneDocument(text: string): string {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    delete value._id
    return JSON.stringify(value, null, 2)
  } catch { return text }
}

export function prettyDocument(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

/** The `_id` of a document for a heading, or the start of its text when it has none. */
export function documentLabel(document: string): string {
  try {
    const value = JSON.parse(document) as Record<string, unknown>
    const id = value._id
    const label = id && typeof id === 'object' ? String((id as Record<string, unknown>).$oid ?? JSON.stringify(id)) : String(id ?? '')
    return label ? `_id: ${label}` : document.slice(0, 80)
  } catch { return document.slice(0, 80) }
}

/** A leaf of the tree view: ObjectId and dates unwrap, numbers with a type keep their text. */
export function leafText(value: unknown): { text: string; kind: 'string' | 'number' | 'boolean' | 'null' | 'id' | 'date' | 'other' } {
  if (value === null) return { text: 'null', kind: 'null' }
  if (typeof value === 'string') return { text: JSON.stringify(value), kind: 'string' }
  if (typeof value === 'number') return { text: String(value), kind: 'number' }
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean' }
  const record = value as Record<string, unknown>
  if (typeof record.$oid === 'string') return { text: `ObjectId("${record.$oid}")`, kind: 'id' }
  if (record.$date !== undefined) return { text: `Date(${typeof record.$date === 'string' ? record.$date : JSON.stringify(record.$date)})`, kind: 'date' }
  for (const type of ['$numberLong', '$numberInt', '$numberDouble', '$numberDecimal'] as const) if (record[type] !== undefined) return { text: `${type.slice(7)}(${String(record[type])})`, kind: 'number' }
  return { text: JSON.stringify(value), kind: 'other' }
}

/** True for an object or array the tree should open, and not for an extended-JSON scalar like `{"$oid": …}`. */
export function isBranch(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return true
  const keys = Object.keys(value)
  return !(keys.length === 1 && keys[0]!.startsWith('$'))
}
