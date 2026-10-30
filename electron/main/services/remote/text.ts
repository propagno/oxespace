import { REDACTED, redactSecrets } from '../../../../shared/secrets'

/**
 * What text goes through before it reaches a phone (C5 payloads): the app's redactor for secrets, absolute paths
 * replaced (the project root by `.`, anything else by `…`), and a cut to the contract's length. Pure functions, so
 * every topic filters the same way and the tests can check them alone.
 */

export const PATH_PLACEHOLDER = '…'

const occurrences = (text: string, needle: string): number => {
  let count = 0
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count += 1
  return count
}

/** The redactor's text and how many values it replaced. */
export function redactCounted(text: string): { text: string; redacted: number } {
  const value = redactSecrets(text)
  return { text: value, redacted: Math.max(0, occurrences(value, REDACTED) - occurrences(text, REDACTED)) }
}

/** At most `limit` characters, never ending on half of a surrogate pair. */
export function cut(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  let end = limit
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return { text: text.slice(0, end), truncated: true }
}

const unify = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '')
const isWindowsPath = (value: string): boolean => /^[A-Za-z]:\//.test(unify(value)) || unify(value).startsWith('//')
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Windows drive and UNC paths, and POSIX paths under the usual top-level directories. */
const ABSOLUTE = new RegExp([
  String.raw`\b[A-Za-z]:[\\/][^\s"'<>|*?\u0000-\u001f]*`,
  String.raw`\\\\[^\s"'<>|*?\\/\u0000-\u001f]+[\\/][^\s"'<>|*?\u0000-\u001f]*`,
  String.raw`(?<![\w.~-])/(?:Users|home|root|var|tmp|opt|etc|mnt|media|private|Volumes|usr|srv|run|snap|proc|Library|Applications|System|workspace|workspaces|data)(?:/[^\s"'<>|*?\u0000-\u001f]*)?`,
  String.raw`(?<![\w])~[\\/][^\s"'<>|*?\u0000-\u001f]*`,
  String.raw`\bfile:/{2,3}[^\s"'<>]*`
].join('|'), 'g')

/**
 * No absolute path leaves the desktop: the known roots become `.` (with what follows them kept, relative), any other
 * absolute path becomes `…`. Roots are matched with either slash and, for Windows paths, without regard to case.
 */
export function scrubPaths(text: string, roots: readonly string[]): string {
  let value = text
  const known = [...new Set(roots.map(unify).filter(root => root.length > 3))].sort((a, b) => b.length - a.length)
  for (const root of known) {
    const pattern = escapeRegExp(root).replace(/\//g, String.raw`[\\/]`)
    value = value.replace(new RegExp(`${pattern}(?![^\\\\/\\s"'<>|])`, isWindowsPath(root) ? 'gi' : 'g'), '.')
  }
  return value.replace(ABSOLUTE, PATH_PLACEHOLDER)
}

/**
 * `target` relative to `root` with `/`, `.` for the root itself; undefined when it lies outside, climbs with `..`, or
 * cannot be told apart from an absolute path.
 */
export function relativeTo(root: string, target: string): string | undefined {
  const base = unify(root), path = unify(target)
  if (!path) return undefined
  const absolute = /^[A-Za-z]:\//.test(path) || path.startsWith('/') || path.startsWith('~')
  let rest: string
  if (!absolute) rest = path.replace(/^\.\//, '')
  else {
    if (!base) return undefined
    const fold = isWindowsPath(base) ? (value: string) => value.toLowerCase() : (value: string) => value
    if (fold(path) === fold(base)) return '.'
    if (!fold(path).startsWith(`${fold(base)}/`)) return undefined
    rest = path.slice(base.length + 1)
  }
  const segments = rest.split('/')
  if (!rest || rest === '.') return '.'
  if (segments.some(segment => segment === '..' || segment === '') || /^[A-Za-z]:/.test(rest)) return undefined
  return rest
}

/** Everything a free-text field goes through: redaction (counted), paths, then the cut. */
export function clean(text: string | undefined, roots: readonly string[], limit: number): { text: string; truncated: boolean; redacted: number } {
  const redacted = redactCounted(text ?? '')
  const cutText = cut(scrubPaths(redacted.text, roots), limit)
  return { text: cutText.text, truncated: cutText.truncated, redacted: redacted.redacted }
}
