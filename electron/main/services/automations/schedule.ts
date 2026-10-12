/**
 * Next-occurrence arithmetic for automation schedules, in local time.
 */
import type { AutomationSchedule } from '../../../../shared/types/automation'

const MINUTE = 60_000
export const MIN_INTERVAL_MINUTES = 5
const CRON_SEARCH_LIMIT_MINUTES = 366 * 24 * 60

interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dayOfMonth: Set<number>
  month: Set<number>
  dayOfWeek: Set<number>
  domWild: boolean
  dowWild: boolean
}

function parseField(text: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const [rangeText, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) return null
    let from: number
    let to: number
    if (rangeText === '*') {
      from = min
      to = max
    } else if (/^\d+$/.test(rangeText)) {
      from = Number(rangeText)
      to = stepText === undefined ? from : max
    } else if (/^\d+-\d+$/.test(rangeText)) {
      const [a, b] = rangeText.split('-').map(Number)
      from = a
      to = b
    } else {
      return null
    }
    if (from < min || to > max || from > to) return null
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return out.size > 0 ? out : null
}

export function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [m, h, dom, mon, dow] = parts
  const minute = parseField(m, 0, 59)
  const hour = parseField(h, 0, 23)
  const dayOfMonth = parseField(dom, 1, 31)
  const month = parseField(mon, 1, 12)
  // Day-of-week accepts 7 as Sunday.
  const rawDow = parseField(dow, 0, 7)
  if (!minute || !hour || !dayOfMonth || !month || !rawDow) return null
  const dayOfWeek = new Set([...rawDow].map((d) => d % 7))
  return { minute, hour, dayOfMonth, month, dayOfWeek, domWild: dom === '*', dowWild: dow === '*' }
}

export function validateSchedule(schedule: AutomationSchedule): string | null {
  switch (schedule.kind) {
    case 'interval':
      return Number.isInteger(schedule.everyMinutes) && schedule.everyMinutes >= MIN_INTERVAL_MINUTES
        ? null
        : `O intervalo mínimo é ${MIN_INTERVAL_MINUTES} minutos.`
    case 'daily':
      return validTime(schedule.hour, schedule.minute) ? null : 'Horário inválido.'
    case 'weekly':
      if (!validTime(schedule.hour, schedule.minute)) return 'Horário inválido.'
      return schedule.days.length > 0 && schedule.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        ? null
        : 'Escolha ao menos um dia da semana.'
    case 'cron':
      return parseCron(schedule.expression) ? null : 'Expressão cron inválida (5 campos).'
  }
}

function validTime(hour: number, minute: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59
}

function cronMatches(fields: CronFields, d: Date): boolean {
  if (!fields.minute.has(d.getMinutes()) || !fields.hour.has(d.getHours()) || !fields.month.has(d.getMonth() + 1)) return false
  const domOk = fields.dayOfMonth.has(d.getDate())
  const dowOk = fields.dayOfWeek.has(d.getDay())
  // Standard cron: when both day fields are restricted, either one matches.
  if (!fields.domWild && !fields.dowWild) return domOk || dowOk
  return domOk && dowOk
}

/** First occurrence strictly after `after` (ms epoch), or null if none is found / invalid. */
export function nextOccurrence(schedule: AutomationSchedule, after: number): number | null {
  if (validateSchedule(schedule)) return null
  if (schedule.kind === 'interval') return after + schedule.everyMinutes * MINUTE

  const start = new Date(after)
  start.setSeconds(0, 0)
  start.setTime(start.getTime() + MINUTE)

  if (schedule.kind === 'daily' || schedule.kind === 'weekly') {
    const days = schedule.kind === 'weekly' ? new Set(schedule.days) : null
    for (let offset = 0; offset <= 8; offset += 1) {
      const candidate = new Date(start)
      candidate.setDate(candidate.getDate() + offset)
      candidate.setHours(schedule.hour, schedule.minute, 0, 0)
      if (candidate.getTime() <= after) continue
      if (days && !days.has(candidate.getDay())) continue
      return candidate.getTime()
    }
    return null
  }

  const fields = parseCron(schedule.expression)
  if (!fields) return null
  const cursor = new Date(start)
  for (let i = 0; i < CRON_SEARCH_LIMIT_MINUTES; i += 1) {
    if (cronMatches(fields, cursor)) return cursor.getTime()
    cursor.setTime(cursor.getTime() + MINUTE)
  }
  return null
}
