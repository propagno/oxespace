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


/**
 * A document as text a person can edit and send back without changing what it stores.
 * Relaxed JSON writes Int64 and Double 5.0 as `5`, which parses back as an Int32: an edit would
 * silently retype fields. Here only values that survive the round trip are written plainly
 * (Int32, non-integer Double, strings, dates in range); the rest keep their extended form
 * (`{"$numberLong":"5"}`, `{"$numberDouble":"5.0"}`, `{"$numberDecimal":"1.10"}`).
 */
export function editableEjson(value: unknown, maxLength = 64 * 1024): { text: string; truncated: boolean } {
  const text = JSON.stringify(simplify(EJSON.serialize(value as never, { relaxed: false })))
  return text.length > maxLength ? { text: text.slice(0, maxLength), truncated: true } : { text, truncated: false }
}

function simplify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(simplify)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 1) {
    const only = record[keys[0]]
    if (keys[0] === '$numberInt' && typeof only === 'string') return Number(only)
    if (keys[0] === '$numberDouble' && typeof only === 'string' && /^-?\d+\.\d*[1-9]\d*(?:e[+-]?\d+)?$/i.test(only) && Number.isFinite(Number(only)) && !Number.isInteger(Number(only))) return Number(only)
    if (keys[0] === '$date' && only && typeof only === 'object') {
      const millis = Number((only as Record<string, unknown>).$numberLong)
      if (Number.isFinite(millis) && millis >= 0 && millis < 253_402_300_800_000) return { $date: new Date(millis).toISOString() }
    }
  }
  const out: Record<string, unknown> = {}
  for (const key of keys) out[key] = simplify(record[key])
  return out
}

/** Reads text written by `editableEjson` (and plain relaxed JSON) keeping every BSON type. */
export function parseEditableDocument(text: string | undefined, label: string): Record<string, unknown> {
  if (text === undefined || text.trim() === '') return {}
  if (text.length > 8 * 1024 * 1024) throw new MongoInputError(`${label} is too large.`)
  let value: unknown
  try { value = EJSON.parse(text, { relaxed: false }) } catch (error) {
    throw new MongoInputError(`${label} is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MongoInputError(`${label} must be a JSON object.`)
  walk(value, key => { if (FORBIDDEN.has(key)) throw new MongoInputError(`${key} runs server-side code and is not allowed.`) })
  return value as Record<string, unknown>
}
