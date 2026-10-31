/**
 * A MongoDB query as the text the library keeps (saved queries and history store one string per
 * entry). It is JSON so it can be read back into the form, and `describeMongoQuery` is what a list shows.
 */
export interface MongoQueryText {
  v: 1
  kind: 'find' | 'aggregate'
  database: string
  collection: string
  filter?: string
  projection?: string
  sort?: string
  pipeline?: string
}

export function stringifyMongoQuery(query: Omit<MongoQueryText, 'v'>): string {
  const clean: MongoQueryText = { v: 1, kind: query.kind, database: query.database, collection: query.collection }
  for (const key of ['filter', 'projection', 'sort', 'pipeline'] as const) {
    const value = query[key]
    if (typeof value === 'string' && value.trim() !== '') clean[key] = value
  }
  return JSON.stringify(clean)
}

export function parseMongoQuery(text: string): MongoQueryText | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (!value || value.v !== 1 || (value.kind !== 'find' && value.kind !== 'aggregate') || typeof value.database !== 'string' || typeof value.collection !== 'string') return null
    const query: MongoQueryText = { v: 1, kind: value.kind, database: value.database, collection: value.collection }
    for (const key of ['filter', 'projection', 'sort', 'pipeline'] as const) if (typeof value[key] === 'string') query[key] = value[key] as string
    return query
  } catch { return null }
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** `users.find {"age":{"$gt":3}}` for a list; text that is not a Mongo query is shown as it is. */
export function describeMongoQuery(text: string): string {
  const query = parseMongoQuery(text)
  if (!query) return squash(text)
  const body = query.kind === 'find' ? squash(query.filter ?? '{}') : squash(query.pipeline ?? '[]')
  return `${query.collection}.${query.kind} ${body}`
}
