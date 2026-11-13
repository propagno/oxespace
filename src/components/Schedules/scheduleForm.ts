/** What the Schedules form holds while the person types, and how it becomes a schedule and back. No React here. */
import { nextRun, scheduleRefusal, type Schedule, type ScheduleInput, type ScheduleRefusal, type ScheduleRule } from '../../../shared/schedule'
import type { ThreadProvider } from '../../../shared/types/thread'

export type RuleKind = ScheduleRule['kind']

export interface ScheduleForm {
  id?: string
  name: string
  projectId: string
  rootPath: string
  provider: ThreadProvider
  access: Schedule['access']
  prompt: string
  kind: RuleKind
  /** `once`: the value of a datetime-local field (YYYY-MM-DDTHH:MM, local time). */
  onceAt: string
  /** `daily`: HH:MM and the days of the week (0 = Sunday). */
  time: string
  days: number[]
  /** `hours`: every N hours, as typed. */
  every: string
  catchUp: boolean
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** A moment as a datetime-local field writes it, in local time. */
export function localFieldValue(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The moment a datetime-local field holds, or NaN when it holds none. */
export function fieldMoment(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime() : Number.NaN
}

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

/** An empty form for a project: every day at nine, read only, the first agent. */
export function newScheduleForm(project: { projectId: string; rootPath: string } | null, now: number): ScheduleForm {
  // The next full hour, at least an hour away: a time the person can accept as it is.
  const soon = new Date(now + 2 * 3_600_000); soon.setMinutes(0, 0, 0)
  return { name: '', projectId: project?.projectId ?? '', rootPath: project?.rootPath ?? '', provider: 'claude', access: 'read-only', prompt: '', kind: 'daily', onceAt: localFieldValue(soon.getTime()), time: '09:00', days: [...EVERY_DAY], every: '4', catchUp: false }
}

export function formOf(schedule: Schedule, now: number): ScheduleForm {
  const base = newScheduleForm({ projectId: schedule.projectId, rootPath: schedule.rootPath }, now)
  const rule = schedule.rule
  return {
    ...base, id: schedule.id, name: schedule.name, provider: schedule.provider, access: schedule.access, prompt: schedule.prompt, catchUp: schedule.catchUp, kind: rule.kind,
    ...(rule.kind === 'once' ? { onceAt: localFieldValue(rule.at) } : rule.kind === 'daily' ? { time: rule.time, days: [...rule.days].sort((a, b) => a - b) } : { every: String(rule.every) })
  }
}

export function ruleOf(form: ScheduleForm, now: number): ScheduleRule {
  if (form.kind === 'once') return { kind: 'once', at: fieldMoment(form.onceAt) }
  if (form.kind === 'daily') return { kind: 'daily', time: form.time, days: [...form.days].sort((a, b) => a - b) }
  return { kind: 'hours', every: Number(form.every), anchor: now + Number(form.every) * 3_600_000 }
}

export function inputOf(form: ScheduleForm, now: number, confirmedWrite: boolean): ScheduleInput {
  return { ...(form.id ? { id: form.id } : {}), name: form.name, projectId: form.projectId, rootPath: form.rootPath, provider: form.provider, access: form.access, prompt: form.prompt, rule: ruleOf(form, now), catchUp: form.catchUp, ...(confirmedWrite ? { confirmedWrite: true } : {}) }
}

/** Why the form cannot be saved yet (the write confirmation aside: that is asked on Save), and when it would first run. */
export function formCheck(form: ScheduleForm, now: number): { refusal: ScheduleRefusal | null; firstRun: number | null } {
  const input = inputOf(form, now, true)
  const refusal = scheduleRefusal(input, now)
  return { refusal, firstRun: refusal ? null : nextRun(input.rule, now) }
}
