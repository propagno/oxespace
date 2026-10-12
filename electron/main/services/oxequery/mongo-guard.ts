import { EJSON } from 'bson'

import { MongoInputError } from './oxequery-errors'

export { MongoInputError }

/** Server-side JavaScript and arbitrary code paths, refused everywhere. */
const FORBIDDEN = new Set(['$where', '$function', '$accumulator'])
/** Stages that write; refused on a read-only connection. */
const WRITING_STAGES = new Set(['$out', '$merge'])

function walk(value: unknown, visit: (key: string) => void, depth = 0): void {
  if (depth > 64) throw new MongoInputError('The document is nested too deeply.')
  if (Array.isArray(value)) { for (const item of value) walk(item, visit, depth + 1); return }
  if (value && typeof value === 'object' && !(value instanceof Date) && !('_bsontype' in value)) {
    for (const [key, entry] of Object.entries(value)) { visit(key); walk(entry, visit, depth + 1) }
  }
}

export function parseEjson(text: string | undefined, label: string, fallback: unknown): unknown {
  if (text === undefined || text.trim() === '') return fallback
  if (text.length > 256 * 1024) throw new MongoInputError(`${label} is too large.`)
  try { return EJSON.parse(text, { relaxed: true }) } catch (error) {
    throw new MongoInputError(`${label} is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`)
  }
}

export function parseDocument(text: string | undefined, label: string): Record<string, unknown> {
  const value = parseEjson(text, label, {})
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MongoInputError(`${label} must be a JSON object.`)
  walk(value, key => { if (FORBIDDEN.has(key)) throw new MongoInputError(`${key} runs server-side code and is not allowed.`) })
  return value as Record<string, unknown>
}

export function parsePipeline(text: string, readOnly: boolean): Record<string, unknown>[] {
  const value = parseEjson(text, 'Pipeline', [])
  if (!Array.isArray(value)) throw new MongoInputError('Pipeline must be a JSON array of stages.')
  if (value.length > 64) throw new MongoInputError('Pipeline has too many stages.')
  for (const stage of value) {
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) throw new MongoInputError('Every pipeline stage must be an object.')
    walk(stage, key => {
      if (FORBIDDEN.has(key)) throw new MongoInputError(`${key} runs server-side code and is not allowed.`)
    })
    for (const key of Object.keys(stage)) {
      if (WRITING_STAGES.has(key)) {
        if (readOnly) throw new MongoInputError(`${key} writes data and this connection is read-only.`)
        throw new MongoInputError(`${key} writes data and is not supported in OxeQuery yet.`)
      }
    }
  }
  return value as Record<string, unknown>[]
}

export function toEjson(value: unknown, maxLength = 64 * 1024): { text: string; truncated: boolean } {
  const text = EJSON.stringify(value as never, { relaxed: true })
  return text.length > maxLength ? { text: text.slice(0, maxLength), truncated: true } : { text, truncated: false }
}
