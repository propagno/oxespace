import type { MongoSchemaField } from '../../../../shared/types/oxequery'

const MAX_FIELDS = 300
const MAX_DEPTH = 6

/** The BSON type name of a driver value, in the words `$type` uses. */
export function bsonType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'string': return 'string'
    case 'boolean': return 'bool'
    case 'number': return Number.isInteger(value) ? 'int' : 'double'
    case 'bigint': return 'long'
    default: break
  }
  if (value instanceof Date) return 'date'
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return 'binData'
  const tag = (value as { _bsontype?: string })._bsontype
  if (tag) {
    const names: Record<string, string> = { ObjectId: 'objectId', ObjectID: 'objectId', Long: 'long', Decimal128: 'decimal', Int32: 'int', Double: 'double', Timestamp: 'timestamp', Binary: 'binData', BSONRegExp: 'regex', UUID: 'uuid' }
    return names[tag] ?? tag.toLowerCase()
  }
  return 'object'
}

/**
 * Field paths, the types seen at each and how often they were present, from a
 * sample of documents. Arrays are descended into with a `[]` segment, so
 * `items[].sku` is the `sku` of the elements of `items`.
 */
export function inferSchema(documents: unknown[]): { fields: MongoSchemaField[]; truncated: boolean } {
  const fields = new Map<string, { types: Map<string, number>; present: number }>()
  let truncated = false
  const note = (path: string, type: string, seenInDocument: Set<string>): void => {
    let entry = fields.get(path)
    if (!entry) {
      if (fields.size >= MAX_FIELDS) { truncated = true; return }
      entry = { types: new Map(), present: 0 }
      fields.set(path, entry)
    }
    entry.types.set(type, (entry.types.get(type) ?? 0) + 1)
    if (!seenInDocument.has(path)) { seenInDocument.add(path); entry.present++ }
  }
  const walk = (value: unknown, path: string, depth: number, seen: Set<string>): void => {
    const type = bsonType(value)
    if (path) note(path, type, seen)
    if (depth >= MAX_DEPTH) return
    if (type === 'array') for (const item of value as unknown[]) walk(item, `${path}[]`, depth + 1, seen)
    else if (type === 'object') for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, path ? `${path}.${key}` : key, depth + 1, seen)
  }
  for (const document of documents) walk(document, '', 0, new Set())
  const total = documents.length || 1
  return {
    truncated,
    fields: [...fields.entries()].map(([path, entry]) => ({
      path,
      presence: Math.round((entry.present / total) * 1000) / 10,
      types: [...entry.types.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => ({ type, count }))
    })).sort((a, b) => (a.path === '_id' ? -1 : b.path === '_id' ? 1 : a.path.localeCompare(b.path)))
  }
}
