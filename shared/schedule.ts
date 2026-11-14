/**
 * Schedules: a request to an agent that OXESpace sends by itself, at a set time or on repeat, while the app is open.
 * Each run opens a new conversation in the schedule's project and sends the request there; from then on it is a
 * conversation like any other (approvals, notifications, the changes panel).
 *
 * What a schedule can never do, by construction: run with "full access" or without approvals, run more than once an
 * hour, pile up runs it missed while the app was closed (at most one is recovered), or be created by an agent.
 */
import type { ThreadProvider } from './types/thread'

export type ScheduleAccess = 'read-only' | 'workspace-write'

/** When a schedule runs. Times are the computer's local time, as the person typed them. */
export type ScheduleRule =
  /** One time only, at this moment (epoch ms). */
  | { kind: 'once'; at: number }
  /** At HH:MM on the chosen days of the week (0 = Sunday … 6 = Saturday); all seven is every day. */
  | { kind: 'daily'; time: string; days: number[] }
  /** Every N hours (1 to 24), counted from `anchor` (epoch ms). */
  | { kind: 'hours'; every: number; anchor: number }

export interface Schedule {
  id: string
  name: string
  projectId: string
  rootPath: string
  provider: ThreadProvider
  /** The agent's model, or null for the agent's own default. */
  model: string | null
  access: ScheduleAccess
  prompt: string
  rule: ScheduleRule
  enabled: boolean
  /** The app was closed (or the computer asleep) at the time: run once when it is back, or let it pass. */
  catchUp: boolean
  createdAt: number
  updatedAt: number
  /** The next time it is due, or null when it will not run again (off, or a single time already past). */
  nextRunAt: number | null
  lastRunAt: number | null
  /** Runs that failed to start, in a row. */
  failures: number
  /** Why OXESpace turned it off by itself, when it did. */
  pausedReason: 'failures' | null
}

export type ScheduleRunOutcome =
  /** A conversation was opened and the request sent. */
  | 'started'
  /** The conversation could not be opened or the request could not be sent; `detail` says why. */
  | 'failed'
  /** The app was not open at the time and the schedule lets missed runs pass. */
  | 'missed'
  /** The run before it was still working, or waiting for an answer. */
  | 'skipped-busy'
  /** It had already run as many times today as a schedule may. */
  | 'skipped-limit'

export interface ScheduleRun {
  id: string
  scheduleId: string
  /** When it was due. */
  dueAt: number
  /** When OXESpace acted on it. */
  at: number
  outcome: ScheduleRunOutcome
  threadId: string | null
  detail: string | null
}

export interface SchedulesState {
  /** "Pause all": nothing runs while this is on. */
  paused: boolean
  schedules: Schedule[]
}

/** What the person fills in. `id` is there when an existing schedule is being changed. */
export interface ScheduleInput {
  id?: string
  name: string
  projectId: string
  rootPath: string
  provider: ThreadProvider
  model?: string | null
  access: ScheduleAccess
  prompt: string
  rule: ScheduleRule
  enabled?: boolean
  catchUp?: boolean
  /** The person's yes to "it will change files with no one watching": required for `workspace-write`. */
  confirmedWrite?: boolean
}

export const SCHEDULE_LIMITS = {
  nameLength: 80,
  promptLength: 8000,
  /** How many schedules there may be. */
  count: 50,
  /** A schedule never starts more runs than this in one local day. */
  runsPerDay: 24,
  /** Runs that fail to start in a row before OXESpace turns the schedule off and says why. */
  failuresBeforePause: 3,
  /** The runs kept for each schedule's history. */
  history: 30
} as const

/** A run later than this was not "on time": the app was closed or the computer asleep, and it counts as missed. */
export const SCHEDULE_LATE_MS = 2 * 60_000
const HOUR = 3_600_000
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export type ScheduleRefusal = 'name' | 'prompt' | 'provider' | 'project' | 'access' | 'time' | 'days' | 'every' | 'past' | 'unconfirmedWrite' | 'rule'

/** Why what the person filled in cannot be saved, or null when it can. `now` decides whether a single time is past. */
export function scheduleRefusal(input: unknown, now: number): ScheduleRefusal | null {
  const value = (input ?? {}) as Partial<ScheduleInput>
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > SCHEDULE_LIMITS.nameLength) return 'name'
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > SCHEDULE_LIMITS.promptLength) return 'prompt'
  if (value.provider !== 'claude' && value.provider !== 'codex' && value.provider !== 'antigravity') return 'provider'
  if (typeof value.projectId !== 'string' || !value.projectId || typeof value.rootPath !== 'string' || !value.rootPath) return 'project'
  if (value.access !== 'read-only' && value.access !== 'workspace-write') return 'access'
  if (value.access === 'workspace-write' && value.confirmedWrite !== true) return 'unconfirmedWrite'
  const rule = value.rule as ScheduleRule | undefined
  if (!rule || typeof rule !== 'object') return 'rule'
  if (rule.kind === 'once') return Number.isFinite(rule.at) ? (rule.at > now ? null : 'past') : 'time'
  if (rule.kind === 'daily') {
    if (typeof rule.time !== 'string' || !TIME.test(rule.time)) return 'time'
    if (!Array.isArray(rule.days) || !rule.days.length || rule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6) || new Set(rule.days).size !== rule.days.length) return 'days'
    return null
  }
  if (rule.kind === 'hours') {
    if (!Number.isInteger(rule.every) || rule.every < 1 || rule.every > 24) return 'every'
    return Number.isFinite(rule.anchor) ? null : 'time'
  }
  return 'rule'
}

/**
 * The first time the rule is due strictly after `after`, or null when there is none (a single time already past).
 *
 * A daily time is local wall-clock time, worked out again from the rule each time: when the clocks change, 09:00 is
 * still 09:00. On the day an hour does not exist (02:30 when clocks jump from 02:00 to 03:00) the run is an hour
 * later by the clock (03:30), once; on the day an hour happens twice it runs the first time only.
 */
export function nextRun(rule: ScheduleRule, after: number): number | null {
  if (rule.kind === 'once') return rule.at > after ? rule.at : null
  if (rule.kind === 'hours') {
    const step = rule.every * HOUR
    if (rule.anchor > after) return rule.anchor
    return rule.anchor + (Math.floor((after - rule.anchor) / step) + 1) * step
  }
  const [hours, minutes] = rule.time.split(':').map(Number)
  const from = new Date(after)
  for (let offset = 0; offset <= 8; offset++) {
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, hours, minutes, 0, 0)
    if (rule.days.includes(at.getDay()) && at.getTime() > after) return at.getTime()
  }
  return null
}

/** Midnight that starts the local day `at` falls in: what "today" means for the daily limit. */
export function localDayStart(at: number): number {
  const day = new Date(at)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
}

/** What to do with a schedule that is due at `now`. Pure: the service acts on the answer. */
export type DueDecision =
  | { act: 'run'; dueAt: number; recovered: boolean }
  | { act: 'skip'; dueAt: number; outcome: Extract<ScheduleRunOutcome, 'missed' | 'skipped-busy' | 'skipped-limit'> }

export function decideDue(schedule: Pick<Schedule, 'nextRunAt' | 'catchUp'>, now: number, facts: { busy: boolean; startedToday: number }): DueDecision | null {
  const dueAt = schedule.nextRunAt
  if (dueAt === null || dueAt > now) return null
  const late = now - dueAt > SCHEDULE_LATE_MS
  // However many times it was due while the app was away, this is one decision: one recovery at most, or one "missed".
  if (late && !schedule.catchUp) return { act: 'skip', dueAt, outcome: 'missed' }
  if (facts.busy) return { act: 'skip', dueAt, outcome: 'skipped-busy' }
  if (facts.startedToday >= SCHEDULE_LIMITS.runsPerDay) return { act: 'skip', dueAt, outcome: 'skipped-limit' }
  return { act: 'run', dueAt, recovered: late }
}
