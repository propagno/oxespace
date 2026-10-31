/**
 * Turns the form an MCP server asks for (an elicitation `requestedSchema`) into fields a person can
 * fill in, and checks the answers against what the schema allows before they are sent.
 *
 * Covers the primitive types the MCP specification allows: strings (with length and format limits),
 * numbers and integers (with bounds), booleans, single choices (`enum`, or `oneOf` with titles)
 * and multiple choices (`array` of an enum). Validation follows VS Code's elicitation form
 * (microsoft/vscode, MIT licence, Copyright (c) Microsoft Corporation):
 * `mcp/browser/mcpElicitationService.ts`.
 */

export type ElicitationValue = string | number | boolean | string[]

export interface ElicitationOption { value: string; label?: string }

export interface ElicitationField {
  name: string
  title: string
  description: string
  required: boolean
  kind: 'boolean' | 'single' | 'multi' | 'number' | 'text'
  options?: ElicitationOption[]
  integer?: boolean
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  format?: 'email' | 'uri' | 'date' | 'date-time'
  default?: ElicitationValue
}

type Schema = Record<string, unknown>
const isRecord = (value: unknown): value is Schema => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const str = (value: unknown): string => typeof value === 'string' ? value : ''

/** `enum` (with optional `enumNames`), or `oneOf`/`anyOf` of `{ const, title }`. */
function readOptions(schema: Schema): ElicitationOption[] | undefined {
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : []
    const options = schema.enum.flatMap((value, index): ElicitationOption[] => typeof value === 'string' ? [{ value, ...(typeof names[index] === 'string' ? { label: names[index] as string } : {}) }] : [])
    return options.length ? options.slice(0, 200) : undefined
  }
  const list = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : undefined
  if (!list) return undefined
  const options = list.flatMap((item): ElicitationOption[] => isRecord(item) && typeof item.const === 'string' ? [{ value: item.const, ...(typeof item.title === 'string' ? { label: item.title } : {}) }] : [])
  return options.length ? options.slice(0, 200) : undefined
}

export function elicitationFields(schema: unknown): ElicitationField[] {
  const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(isRecord(schema) && Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [])
  const fields: ElicitationField[] = []
  for (const [name, raw] of Object.entries(properties).slice(0, 50)) {
    if (!isRecord(raw)) continue
    const base = { name, title: str(raw.title) || name, description: str(raw.description), required: required.has(name) }
    if (raw.type === 'boolean') {
      fields.push({ ...base, kind: 'boolean', ...(typeof raw.default === 'boolean' ? { default: raw.default } : {}) })
    } else if (raw.type === 'array') {
      const options = isRecord(raw.items) ? readOptions(raw.items) : undefined
      if (!options) continue
      const defaults = Array.isArray(raw.default) ? raw.default.filter((item): item is string => typeof item === 'string') : undefined
      fields.push({ ...base, kind: 'multi', options, minItems: num(raw.minItems), maxItems: num(raw.maxItems), ...(defaults ? { default: defaults } : {}) })
    } else if (raw.type === 'number' || raw.type === 'integer') {
      fields.push({ ...base, kind: 'number', integer: raw.type === 'integer', minimum: num(raw.minimum), maximum: num(raw.maximum), ...(num(raw.default) !== undefined ? { default: num(raw.default) } : {}) })
    } else if (raw.type === 'string' || raw.type === undefined) {
      const options = readOptions(raw)
      const format = raw.format === 'email' || raw.format === 'uri' || raw.format === 'date' || raw.format === 'date-time' ? raw.format : undefined
      fields.push({ ...base, kind: options ? 'single' : 'text', ...(options ? { options } : {}), minLength: num(raw.minLength), maxLength: num(raw.maxLength), ...(format ? { format } : {}), ...(typeof raw.default === 'string' ? { default: raw.default } : {}) })
    }
  }
  return fields
}

export function elicitationDefaults(fields: ElicitationField[]): Record<string, ElicitationValue> {
  const values: Record<string, ElicitationValue> = {}
  for (const field of fields) if (field.default !== undefined) values[field.name] = field.default
  return values
}

const FORMATS: Record<NonNullable<ElicitationField['format']>, [RegExp, string]> = {
  email: [/^[^\s@]+@[^\s@]+$/, 'Enter a valid email address'],
  uri: [/^[a-z][a-z0-9+.-]*:\/\/\S+$/i, 'Enter a valid URL'],
  date: [/^\d{4}-\d{2}-\d{2}$/, 'Use the form YYYY-MM-DD'],
  'date-time': [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/i, 'Use the form YYYY-MM-DDTHH:MM:SS']
}

const isEmpty = (value: ElicitationValue | undefined): boolean => value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/** The reason a value is not acceptable, or null. An empty optional field is acceptable. */
export function validateElicitationField(field: ElicitationField, value: ElicitationValue | undefined): string | null {
  if (field.kind === 'boolean') return field.required && value === undefined ? 'Choose yes or no' : null
  if (isEmpty(value)) return field.required ? 'This field is required' : null
  if (field.kind === 'single') return field.options!.some(option => option.value === value) ? null : 'Choose one of the options'
  if (field.kind === 'multi') {
    const chosen = Array.isArray(value) ? value : []
    if (!chosen.every(item => field.options!.some(option => option.value === item))) return 'Choose from the options'
    if (field.minItems !== undefined && chosen.length < field.minItems) return `Choose at least ${field.minItems}`
    if (field.maxItems !== undefined && chosen.length > field.maxItems) return `Choose at most ${field.maxItems}`
    return null
  }
  if (field.kind === 'number') {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isFinite(parsed)) return 'Enter a number'
    if (field.integer && !Number.isInteger(parsed)) return 'Enter a whole number'
    if (field.minimum !== undefined && parsed < field.minimum) return `Minimum is ${field.minimum}`
    if (field.maximum !== undefined && parsed > field.maximum) return `Maximum is ${field.maximum}`
    return null
  }
  const text = String(value)
  if (field.minLength && text.length < field.minLength) return `Minimum length is ${field.minLength}`
  if (field.maxLength && text.length > field.maxLength) return `Maximum length is ${field.maxLength}`
  if (field.format && !FORMATS[field.format][0].test(text)) return FORMATS[field.format][1]
  return null
}

/** The answer to send: numbers as numbers, empty optional fields left out. */
export function elicitationContent(fields: ElicitationField[], values: Record<string, ElicitationValue>): { content: Record<string, ElicitationValue>; errors: Record<string, string> } {
  const content: Record<string, ElicitationValue> = {}
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const value = values[field.name]
    const problem = validateElicitationField(field, value)
    if (problem) { errors[field.name] = problem; continue }
    if (field.kind === 'boolean') { if (value !== undefined) content[field.name] = value }
    else if (isEmpty(value)) continue
    else content[field.name] = field.kind === 'number' ? Number(value) : value!
  }
  return { content, errors }
}
