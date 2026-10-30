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
/** Where a log message stops being our own words and starts carrying data. */
const DATA_START = /[{["'`:(<|]|\s-{1,2}[A-Za-z]/

/**
 * The tail of a log, keeping each line's time, level, scope and the fixed words of its message: everything from the
 * first quote, colon, bracket or object on (values, arguments, error text, anything a person typed) is dropped, and
 * so are lines that are not log entries (stack frames, multi-line objects). The rest is redacted.
 */
export function redactLogTail(text: string, redactor: Redactor, maxLines = 400): string {
  const out: string[] = []
  let dropped = 0
  for (const line of text.split(/\r?\n/).slice(-maxLines * 4)) {
    const match = LOG_LINE.exec(line)
    if (!match) { if (line.trim()) dropped++; continue }
    let message = match[3]
    const tag = /^\[[\w:.-]{1,40}\]\s*/.exec(message)?.[0] ?? ''
    const rest = message.slice(tag.length)
    const cut = rest.search(DATA_START)
    message = tag + (cut >= 0 ? rest.slice(0, cut) : rest)
    if (message.length > 160) message = message.slice(0, 160)
    const trimmed = cut >= 0 || message.length < match[3].length
    if (trimmed) dropped++
    out.push(`${match[1]}${match[2] ?? ''}${redactor.text(message.trimEnd())}${trimmed ? ' …' : ''}`)
  }
  redactor.add(dropped)
  return out.slice(-maxLines).join('\n')
}
