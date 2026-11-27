/**
 * Pure, zero-dependency 5-field local-time cron parser and next-run calculator.
 * Format: `minute hour day-of-month month day-of-week`
 * Supports `*`, single integers, ranges (`1-5`), steps (`* /15`, `1-10/2`, `5/10`), comma lists (`1,3,5`),
 * named months (`JAN`..`DEC`), and named weekdays (`SUN`..`SAT`, with `7` treated as Sunday `0`).
 */

export interface ParsedCron {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
  domRestricted: boolean
  dowRestricted: boolean
}

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
}

const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6
}

interface FieldSpec {
  min: number
  max: number
  names?: Record<string, number>
  wrapSevenToZero?: boolean
}

function parseAtom(token: string, spec: FieldSpec): number | null {
  const upper = token.toUpperCase()
  if (spec.names && Object.prototype.hasOwnProperty.call(spec.names, upper)) {
    return spec.names[upper]
  }
  if (!/^\d+$/.test(token)) return null
  const value = Number.parseInt(token, 10)
  const effectiveMax = spec.wrapSevenToZero ? 7 : spec.max
  if (!Number.isInteger(value) || value < spec.min || value > effectiveMax) return null
  return value
}

function parseField(raw: string, spec: FieldSpec): number[] | null {
  if (!raw || raw.includes(' ')) return null
  const values = new Set<number>()
  const segments = raw.split(',')
  for (const segment of segments) {
    if (!segment) return null
    const slashParts = segment.split('/')
    if (slashParts.length > 2) return null
    const base = slashParts[0]
    let step = 1
    if (slashParts.length === 2) {
      if (!/^\d+$/.test(slashParts[1])) return null
      step = Number.parseInt(slashParts[1], 10)
      if (!Number.isInteger(step) || step < 1) return null
    }

    let start: number
    let end: number
    if (base === '*') {
      start = spec.min
      end = spec.max
    } else if (base.includes('-')) {
      const rangeParts = base.split('-')
      if (rangeParts.length !== 2 || !rangeParts[0] || !rangeParts[1]) return null
      const parsedStart = parseAtom(rangeParts[0], spec)
      const parsedEnd = parseAtom(rangeParts[1], spec)
      if (parsedStart === null || parsedEnd === null || parsedStart > parsedEnd) return null
      start = parsedStart
      end = parsedEnd
    } else {
      const single = parseAtom(base, spec)
      if (single === null) return null
      start = single
      end = slashParts.length === 2 ? spec.max : single
    }

    for (let current = start; current <= end; current += step) {
      values.add(spec.wrapSevenToZero && current === 7 ? 0 : current)
    }
  }
  if (values.size === 0) return null
  return [...values].sort((a, b) => a - b)
}

export function parseCronExpression(expression: string): ParsedCron | null {
  if (typeof expression !== 'string') return null
  const trimmed = expression.trim()
  if (!trimmed) return null
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) return null

  const minutes = parseField(fields[0], { min: 0, max: 59 })
  const hours = parseField(fields[1], { min: 0, max: 23 })
  const daysOfMonth = parseField(fields[2], { min: 1, max: 31 })
  const months = parseField(fields[3], { min: 1, max: 12, names: MONTH_NAMES })
  const daysOfWeek = parseField(fields[4], { min: 0, max: 6, names: DOW_NAMES, wrapSevenToZero: true })

  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: fields[2] !== '*',
    dowRestricted: fields[4] !== '*'
  }
}

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null
}

function daysInMonth(year: number, monthOneBased: number): number {
  return new Date(year, monthOneBased, 0).getDate()
}

function dayMatches(parsed: ParsedCron, dom: number, dow: number): boolean {
  const domOk = parsed.daysOfMonth.includes(dom)
  const dowOk = parsed.daysOfWeek.includes(dow)
  if (parsed.domRestricted && parsed.dowRestricted) return domOk || dowOk
  return domOk && dowOk
}

/**
 * Computes the first local-time timestamp strictly greater than `after` that matches `expression`,
 * or `null` when invalid or no calendar date matches within 5 years.
 */
export function nextCronRun(expression: string, after: number): number | null {
  if (!Number.isFinite(after)) return null
  const parsed = parseCronExpression(expression)
  if (!parsed) return null

  // Start at the next whole minute strictly after `after`.
  const start = new Date(Math.floor(after / 60_000) * 60_000 + 60_000)
  let year = start.getFullYear()
  let month = start.getMonth() + 1
  let day = start.getDate()
  let hour = start.getHours()
  let minute = start.getMinutes()
  const maxYear = year + 5

  while (year <= maxYear) {
    if (!parsed.months.includes(month)) {
      const nextMonth = parsed.months.find(m => m > month)
      if (nextMonth !== undefined) {
        month = nextMonth
      } else {
        year += 1
        month = parsed.months[0]
      }
      day = 1
      hour = parsed.hours[0]
      minute = parsed.minutes[0]
      continue
    }

    const maxDay = daysInMonth(year, month)
    if (day > maxDay) {
      month += 1
      if (month > 12) {
        year += 1
        month = 1
      }
      day = 1
      hour = parsed.hours[0]
      minute = parsed.minutes[0]
      continue
    }

    const probeDay = new Date(year, month - 1, day, 12, 0, 0, 0)
    if (!dayMatches(parsed, day, probeDay.getDay())) {
      day += 1
      hour = parsed.hours[0]
      minute = parsed.minutes[0]
      continue
    }

    const nextHour = parsed.hours.find(h => h >= hour)
    if (nextHour === undefined) {
      day += 1
      hour = parsed.hours[0]
      minute = parsed.minutes[0]
      continue
    }
    if (nextHour > hour) {
      hour = nextHour
      minute = parsed.minutes[0]
    }

    const nextMinute = parsed.minutes.find(m => m >= minute)
    if (nextMinute === undefined) {
      hour += 1
      minute = parsed.minutes[0]
      continue
    }
    minute = nextMinute

    const candidate = new Date(year, month - 1, day, hour, minute, 0, 0)
    if (candidate.getTime() > after && candidate.getMonth() === month - 1 && candidate.getDate() === day) {
      return candidate.getTime()
    }

    minute += 1
    if (minute > 59) {
      hour += 1
      minute = 0
    }
  }

  return null
}

/** Computes up to `count` consecutive local-time occurrences strictly after `after`. */
export function nextCronRuns(expression: string, after: number, count = 3): number[] {
  if (!Number.isInteger(count) || count <= 0) return []
  const results: number[] = []
  let cursor = after
  for (let i = 0; i < count; i++) {
    const next = nextCronRun(expression, cursor)
    if (next === null) break
    results.push(next)
    cursor = next
  }
  return results
}
