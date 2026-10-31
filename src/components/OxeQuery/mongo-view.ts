const MAX_COLUMNS = 30

/** One readable cell for an EJSON value: ObjectId and dates unwrap, other objects stay JSON. */
export function ejsonCell(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.$oid === 'string') return record.$oid
  if (record.$date !== undefined) return typeof record.$date === 'string' ? record.$date : JSON.stringify(record.$date)
  if (record.$numberLong !== undefined || record.$numberInt !== undefined || record.$numberDouble !== undefined || record.$numberDecimal !== undefined) {
    return String(record.$numberLong ?? record.$numberInt ?? record.$numberDouble ?? record.$numberDecimal)
  }
  return JSON.stringify(value)
}

/** Turns documents (EJSON strings) into a table: the union of top-level fields, `_id` first. */
export function flattenDocuments(documents: string[]): { columns: string[]; rows: unknown[][]; truncatedColumns: boolean } {
  const parsed: Record<string, unknown>[] = []
  for (const text of documents) {
    try {
      const value: unknown = JSON.parse(text)
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed.push(value as Record<string, unknown>)
    } catch { /* A document that was cut off is skipped in table view. */ }
  }
  const seen = new Set<string>()
  for (const document of parsed) for (const key of Object.keys(document)) seen.add(key)
  const ordered = [...seen].sort((a, b) => (a === '_id' ? -1 : b === '_id' ? 1 : 0))
  const columns = ordered.slice(0, MAX_COLUMNS)
  return { columns, rows: parsed.map(document => columns.map(column => ejsonCell(document[column]))), truncatedColumns: ordered.length > MAX_COLUMNS }
}
