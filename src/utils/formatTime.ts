import { currentLanguage, i18n } from '../i18n'

/**
 * Dates and numbers in the interface language, never the machine's: an English
 * interface on a Portuguese system shows 10/14/2026 and 1,234, and the other
 * way round. Each default matches the bare toLocale*String() it replaces.
 */
type DateInput = number | string | Date

const DATE_TIME: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }
const DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' }
const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: 'numeric', second: 'numeric' }

const formatters = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>()
function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(kind: string, options: object | undefined, make: (language: string) => T): T {
  const language = currentLanguage()
  const key = `${kind}|${language}|${options ? JSON.stringify(options) : ''}`
  let formatter = formatters.get(key) as T | undefined
  if (!formatter) { formatter = make(language); formatters.set(key, formatter) }
  return formatter
}

const toDate = (value: DateInput): Date => value instanceof Date ? value : new Date(value)

/** Date and time; `toLocaleString()` without options. */
export function formatDateTime(value: DateInput, options: Intl.DateTimeFormatOptions = DATE_TIME): string {
  return cached('dt', options, language => new Intl.DateTimeFormat(language, options)).format(toDate(value))
}

/** Date only; `toLocaleDateString()` without options. */
export function formatDate(value: DateInput, options: Intl.DateTimeFormatOptions = DATE): string {
  return formatDateTime(value, options)
}

/** Time only; `toLocaleTimeString()` without options. */
export function formatClock(value: DateInput, options: Intl.DateTimeFormatOptions = TIME): string {
  return formatDateTime(value, options)
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return cached('n', options, language => new Intl.NumberFormat(language, options)).format(value)
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31_536_000_000], ['month', 2_592_000_000], ['week', 604_800_000], ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000], ['second', 1000]]

/** "3 minutes ago", "in 2 days", "yesterday" in the interface language. */
export function formatRelative(value: DateInput, now: number = Date.now()): string {
  const diff = toDate(value).getTime() - now
  const [unit, size] = RELATIVE_UNITS.find(([, ms]) => Math.abs(diff) >= ms) ?? ['second', 1000]
  return cached('r', undefined, language => new Intl.RelativeTimeFormat(language, { numeric: 'auto' })).format(Math.round(diff / size), unit)
}

/** The sidebar's last-activity stamp: just now, a time today, yesterday, or a weekday. */
export function formatActivityTime(ms: number): string {
  const diff = Date.now() - ms
  const d = new Date(ms)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (diff < 60_000) return i18n.t('time.justNow')
  if (d.toDateString() === today.toDateString()) return formatDateTime(d, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === yesterday.toDateString()) return i18n.t('time.yesterday')
  return formatDateTime(d, { weekday: 'short' })
}
