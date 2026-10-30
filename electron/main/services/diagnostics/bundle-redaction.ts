import { REDACTED, redactSecrets } from '../../../../shared/secrets'
import { redactEnvironment } from '../../../../shared/environment-redaction'

/**
 * Redaction for the diagnostics bundle (B8.3), counting what it replaced so the preview can say so. On top of the
 * credential shapes `redactSecrets` knows (the same rules as the log hook), it removes e-mail addresses, URLs, host
 * names, IP addresses, absolute paths, the computer's and the person's names, and secret environment values.
 */
export interface Redactor {
  text(value: string): string
  /** Counts values removed some other way (a dropped log argument). */
  add(replaced: number): void
  readonly count: number
}

export interface RedactionContext {
  /** The computer's name and the account's user name, replaced wherever they appear. */
  names?: string[]
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const URL_PATTERN = /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s"'<>)\]}]+/gi
const WINDOWS_PATH = /(?:\b[A-Za-z]:|\\\\[^\s\\/"'<>|]+)[\\/][^\s"'<>|*?,;)\]}]*/g
const POSIX_PATH = /(?<![\w.:/-])~?\/(?:[\w.@ -]*[\w.@-]\/)+[\w.@-]*|(?<![\w.:/-])~\/[\w.@-]+/g
const IPV4 = /\b(?!127\.)(?:\d{1,3}\.){3}\d{1,3}\b/g
const HOST = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|app|ai|cloud|local|lan|internal|corp|home|br|co|us|uk|de|eu)\b/gi
const ENVIRONMENT = /\b([A-Z][A-Z0-9_]{1,63})=([^\s"',;]+)/g

export function createRedactor(context: RedactionContext = {}): Redactor {
  let count = 0
  const names = (context.names ?? []).filter(name => name && name.length >= 3)
    .map(name => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))
  const replace = (value: string, pattern: RegExp, by: string) => value.replace(pattern, () => { count++; return by })
  return {
    get count() { return count },
    add(replaced: number) { count += Math.max(0, Math.trunc(replaced)) },
    text(input: string): string {
      const before = occurrences(input, REDACTED)
      let value = redactSecrets(input)
      count += Math.max(0, occurrences(value, REDACTED) - before)
      value = value.replace(ENVIRONMENT, (whole, name: string, secret: string) => {
        if (redactEnvironment([`${name}=${secret}`])[0]?.value !== undefined) return whole
        count++
        return `${name}=${REDACTED}`
      })
      value = replace(value, EMAIL, '[email]')
      value = replace(value, URL_PATTERN, '[url]')
      value = replace(value, WINDOWS_PATH, '[path]')
      value = replace(value, POSIX_PATH, '[path]')
      value = replace(value, IPV4, '[ip]')
      value = replace(value, HOST, '[host]')
      for (const name of names) value = replace(value, name, '[name]')
      return value
    }
  }
}

function occurrences(text: string, needle: string): number {
  let total = 0
  for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + needle.length)) total++
  return total
}

/** An electron-log line: `[date] [level] (scope) message`. */
const LOG_LINE = /^(\[[^\]]{8,40}\]\s*\[[a-z]{3,8}\]\s*)(\([\w:.-]{1,40}\)\s*)?(.*)$/

/**
 * The app's own fixed log messages, as the code writes them before any value. Only a line that starts with one of
 * these reaches the bundle, and only as its time, level and this text: whatever follows (values, paths, error text,
 * anything a person typed) is never kept. A test keeps each entry present in the code.
 */
export const LOG_MESSAGE_ALLOWLIST = [
  '[main] uncaughtException', '[main] unhandledRejection', '[main] crashReporter init failed', '[main] PATH recovered from login shell',
  '[main] blocked navigation of the main window',
  '[OXESpace] Renderer failed to load', '[OXESpace] Renderer loadFile failed', '[OXESpace] Renderer loadURL failed', '[OXESpace] Renderer process gone',
  '[db] open attempt',
  '[rpc] failed to start', '[rpc] listening on', '[rpc] transport error',
  '[internal-mcp] start failed', '[internal-mcp] stop error', '[internal-mcp] slow request', '[internal-mcp] completed request', '[internal-mcp] client-disconnected request',
  '[mcp] quarantined', '[mcp] failed to sync', '[mcp] could not update retired endpoints', '[mcp] dropping oversized stdout buffer',
  '[updater] error', '[updater] init skipped', '[updater] update available', '[updater] downloaded, ready to install', '[updater] up to date',
  '[updater] quitAndInstall failed', '[updater] could not save preferences', '[updater] autoUpdater export not found',
  '[RtkService] Failed to download or extract RTK', '[RtkService] background update failed', '[RtkService] check failed',
  '[CodeGraphService] Failed to initialize', '[CodeGraph] Uncaught exception', '[CodeGraph] Unhandled rejection',
  '[oxe-context] buildPaneManifest failed'
] as const

/**
 * The tail of a log, kept as structured lines only: time, level, scope and an allowlisted fixed message. A line that
 * does not start with one of them (free text, stack frames, multi-line objects) is left out whole, never redacted
 * into the bundle; the count of what was left out is added to the redactions.
 */
export function redactLogTail(text: string, redactor: Redactor, maxLines = 400): string {
  const out: string[] = []
  let dropped = 0
  for (const line of text.split(/\r?\n/).slice(-maxLines * 4)) {
    const match = LOG_LINE.exec(line)
    const message = match?.[3] ?? ''
    const fixed = match ? LOG_MESSAGE_ALLOWLIST.find(entry => message === entry || message.startsWith(`${entry} `) || message.startsWith(`${entry}:`) || message.startsWith(`${entry},`)) : undefined
    if (!match || !fixed) { if (line.trim()) dropped++; continue }
    const cut = message.length > fixed.length
    if (cut) dropped++
    out.push(`${match[1]}${match[2] ?? ''}${fixed}${cut ? ' …' : ''}`)
  }
  redactor.add(dropped)
  return out.slice(-maxLines).join('\n')
}
