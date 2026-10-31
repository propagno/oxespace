import type common from '../../shared/locales/en/common.json'
import { i18n } from '../i18n'

/**
 * One way to turn an error from an IPC call, a fetch or a library into a sentence a person can
 * act on, in the interface language. Strips Electron's "Error invoking remote method '…': Error:"
 * wrapper, recognises the common system failures (missing file, permission, network, timeout,
 * missing command, busy database) and keeps the original detail for anything else, bounded to one
 * short paragraph.
 */

const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*/i
const ERROR_NAME_PREFIX = /^(?:[A-Z][A-Za-z]*)?Error:\s*/
const MAX_LENGTH = 300

interface KnownFailure {
  test: RegExp
  message: (match: RegExpMatchArray) => string
}

const t = (key: keyof typeof common.errors, values: { command?: string; path?: string } = {}): string => i18n.t(`errors.${key}`, values)

// Order matters: the first match wins, so specific patterns come before generic ones.
const KNOWN_FAILURES: KnownFailure[] = [
  { test: /spawn (\S+) ENOENT/i, message: (m) => t('commandMissing', { command: m[1] }) },
  { test: /\bENOENT\b[^']*'([^']+)'/, message: (m) => t('pathMissing', { path: m[1] }) },
  { test: /\bENOENT\b/, message: () => t('somethingMissing') },
  { test: /\b(EACCES|EPERM)\b[^']*'([^']+)'/, message: (m) => t('noPermissionPath', { path: m[2] }) },
  { test: /\b(EACCES|EPERM)\b/, message: () => t('noPermission') },
  { test: /\bEBUSY\b|\bresource busy or locked\b/i, message: () => t('busy') },
  { test: /\bENOSPC\b/, message: () => t('diskFull') },
  { test: /\bSQLITE_BUSY\b|database is locked/i, message: () => t('databaseBusy') },
  { test: /\b(ENOTFOUND|EAI_AGAIN)\b|getaddrinfo/i, message: () => t('unresolved') },
  { test: /\bECONNREFUSED\b/, message: () => t('refused') },
  { test: /\b(ECONNRESET|EPIPE)\b|socket hang up/i, message: () => t('reset') },
  { test: /\bETIMEDOUT\b|timed out|timeout of \d+ms/i, message: () => t('timeout') },
  { test: /^fetch failed$|Failed to fetch|NetworkError/i, message: () => t('offline') },
  // HTTP codes only next to a status word, so "line 401" in a message is left alone.
  { test: /(?:status|code|HTTP)\D{0,8}401\b|\bunauthori[sz]ed\b/i, message: () => t('signedOut') },
  { test: /(?:status|code|HTTP)\D{0,8}403\b|\bforbidden\b/i, message: () => t('forbidden') },
  { test: /(?:status|code|HTTP)\D{0,8}429\b|\brate.?limit/i, message: () => t('rateLimited') },
  { test: /not a git repository/i, message: () => t('notGit') }
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
export function humanizeError(cause: unknown, fallback: string = t('generic')): string {
  const text = errorText(cause)
  if (!text) return fallback
  for (const failure of KNOWN_FAILURES) {
    const match = text.match(failure.test)
    if (match) return failure.message(match)
  }
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? text
  return firstLine.length > MAX_LENGTH ? `${firstLine.slice(0, MAX_LENGTH - 1)}…` : firstLine
}
