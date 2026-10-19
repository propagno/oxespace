/**
 * One way to turn an error from an IPC call, a fetch or a library into a sentence a person can
 * act on. Strips Electron's "Error invoking remote method '…': Error:" wrapper, recognises the
 * common system failures (missing file, permission, network, timeout, missing command, busy
 * database) and keeps the original detail for anything else, bounded to one short paragraph.
 */

const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*/i
const ERROR_NAME_PREFIX = /^(?:[A-Z][A-Za-z]*)?Error:\s*/
const MAX_LENGTH = 300

interface KnownFailure {
  test: RegExp
  message: (match: RegExpMatchArray) => string
}

// Order matters: the first match wins, so specific patterns come before generic ones.
const KNOWN_FAILURES: KnownFailure[] = [
  { test: /spawn (\S+) ENOENT/i, message: (m) => `${m[1]} was not found. Install it or add it to your PATH, then try again.` },
  { test: /\bENOENT\b[^']*'([^']+)'/, message: (m) => `${m[1]} does not exist.` },
  { test: /\bENOENT\b/, message: () => 'A file or folder it needed does not exist.' },
  { test: /\b(EACCES|EPERM)\b[^']*'([^']+)'/, message: (m) => `No permission to use ${m[2]}.` },
  { test: /\b(EACCES|EPERM)\b/, message: () => 'No permission to use a file or folder it needed.' },
  { test: /\bEBUSY\b|\bresource busy or locked\b/i, message: () => 'A file it needed is in use by another program. Close it and try again.' },
  { test: /\bENOSPC\b/, message: () => 'The disk is full.' },
  { test: /\bSQLITE_BUSY\b|database is locked/i, message: () => 'The local database is busy. Try again in a moment.' },
  { test: /\b(ENOTFOUND|EAI_AGAIN)\b|getaddrinfo/i, message: () => 'Could not reach the server: the address could not be resolved. Check your connection.' },
  { test: /\bECONNREFUSED\b/, message: () => 'The connection was refused. Check that the service is running.' },
  { test: /\b(ECONNRESET|EPIPE)\b|socket hang up/i, message: () => 'The connection was closed unexpectedly. Try again.' },
  { test: /\bETIMEDOUT\b|timed out|timeout of \d+ms/i, message: () => 'It took too long to respond. Try again.' },
  { test: /^fetch failed$|Failed to fetch|NetworkError/i, message: () => 'Could not connect. Check your internet connection or proxy.' },
  // HTTP codes only next to a status word, so "line 401" in a message is left alone.
  { test: /(?:status|code|HTTP)\D{0,8}401\b|\bunauthori[sz]ed\b/i, message: () => 'You are not signed in, or the session expired. Sign in again.' },
  { test: /(?:status|code|HTTP)\D{0,8}403\b|\bforbidden\b/i, message: () => 'Your account does not have access to this.' },
  { test: /(?:status|code|HTTP)\D{0,8}429\b|\brate.?limit/i, message: () => 'Too many requests for now. Wait a moment and try again.' },
  { test: /not a git repository/i, message: () => 'This folder is not a Git repository.' }
]

/** The error's own text without wrappers, or '' when there is none. */
export function errorText(cause: unknown): string {
  const raw = cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : cause && typeof cause === 'object' && typeof (cause as { message?: unknown }).message === 'string'
        ? (cause as { message: string }).message
        : ''
  return raw.replace(IPC_PREFIX, '').replace(ERROR_NAME_PREFIX, '').trim()
}

/**
 * A short, readable message for showing an error to a person.
 * `fallback` says what failed ("Could not save the file.") and is used when the error carries no
 * text of its own.
 */
export function humanizeError(cause: unknown, fallback = 'Something went wrong. Try again.'): string {
  const text = errorText(cause)
  if (!text) return fallback
  for (const failure of KNOWN_FAILURES) {
    const match = text.match(failure.test)
    if (match) return failure.message(match)
  }
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? text
  return firstLine.length > MAX_LENGTH ? `${firstLine.slice(0, MAX_LENGTH - 1)}…` : firstLine
}
