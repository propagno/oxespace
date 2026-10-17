import { homedir } from 'node:os'

/**
 * Why OxeQuery did not start, in a form that can be shown to a person or handed to an
 * agent: one line, without the user's home directory, cut short.
 */
export function describeStartupFailure(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const home = homedir()
  const text = (home ? raw.split(home).join('~') : raw).replace(/\s+/g, ' ').trim()
  return text.length > 240 ? `${text.slice(0, 240)}…` : text || 'unknown error'
}
