import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** An absolute path to an existing directory, the way a project root arrives from the renderer. */
export function parseDirectory(value: unknown, label = 'rootPath'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) throw new Error(`${label} must be a directory path`)
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`)
  let directory = false
  try { directory = statSync(value).isDirectory() } catch { /* missing */ }
  if (!directory) throw new Error(`${label} is not an existing directory`)
  return value
}

export function parseOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${label} must be one of ${allowed.join(', ')}`)
  return value as T
}

export function parseOptionalBoolean(value: unknown): boolean {
  return value === true
}

/** Binary payloads from the renderer arrive as Uint8Array (structured clone); anything else or anything too large is refused. */
export function parseBytes(value: unknown, maxBytes: number, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${label} must be binary data`)
  if (value.byteLength === 0 || value.byteLength > maxBytes) throw new Error(`${label} must be between 1 byte and ${Math.round(maxBytes / (1024 * 1024))} MB`)
  return value
}

/** Short identifiers (provider names, ids, session ids): letters, digits and - _ . : only. */
export function parseToken(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]+$/.test(value) || value.length > maxLength) throw new Error(`${label} is not a valid identifier`)
  return value
}

/** Free text shown to the person (titles, bodies): a string without NUL, cut to a sane length. */
export function parseText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${label} must be text`)
  return value.slice(0, maxLength)
}

export function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}
