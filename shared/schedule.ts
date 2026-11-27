/**
 * Schedules & Automations: requests OXESpace sends to an agent on time/cron rules or CI/PR/CLI events while the app is
 * open. `workspace-write` automations run in mandatory isolated git worktrees and surface completed runs in the
 * dedicated Review Queue.
 *
 * What an automation can never do, by construction: run with "full access" or without approvals, pile up runs missed
 * while the app was closed (at most one is recovered), or be created/edited/elevated by an agent via MCP.
 */
import { isValidCronExpression, nextCronRun, nextCronRuns } from './cron'
import type { ThreadProvider } from './types/thread'

export type ScheduleAccess = 'read-only' | 'workspace-write'

export type ScheduleEventType = 'ci-failed' | 'pr-review-requested' | 'manual-cli'

export type ScheduleTriggerKind = 'time' | 'cron' | 'event'

export type ScheduleReviewStatus = 'pending' | 'approved' | 'merged' | 'discarded' | null

export interface ScheduleEventConfig {
  eventType: ScheduleEventType
  cooldownMinutes?: number
  branchFilter?: string
}

export interface ScheduleTokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
}

/** When an automation runs. Times are the computer's local time, as the person typed them. */
export type ScheduleRule =
  /** One time only, at this moment (epoch ms). */
  | { kind: 'once'; at: number }
  /** At HH:MM on the chosen days of the week (0 = Sunday … 6 = Saturday); all seven is every day. */
  | { kind: 'daily'; time: string; days: number[] }
  /** Every N hours (1 to 24), counted from `anchor` (epoch ms). */
  | { kind: 'hours'; every: number; anchor: number }
  /** Standard 5-field local cron expression (`minute hour dom month dow`). */
  | { kind: 'cron'; expression: string }
  /** Event-driven trigger (`ci-failed`, `pr-review-requested`, `manual-cli`). */
  | { kind: 'event'; eventType: ScheduleEventType; cooldownMinutes?: number; branchFilter?: string }

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
  triggerKind?: ScheduleTriggerKind
  eventConfig?: ScheduleEventConfig | null
  /** Per-run timeout in ms (default 20 minutes). */
  timeoutMs?: number
  enabled: boolean
  /** The app was closed (or the computer asleep) at the time: run once when it is back, or let it pass. */
  catchUp: boolean
  createdAt: number
  updatedAt: number
  /** The next time it is due, or null when it will not run again (off, event trigger, or single time already past). */
  nextRunAt: number | null
  lastRunAt: number | null
  /** Runs that failed to start, in a row. */
  failures: number
  /** Why OXESpace turned it off by itself, when it did. */
  pausedReason: 'failures' | null
}

export type ScheduleRunOutcome =
  /** Legacy/direct run where a conversation was opened and the request sent. */
  | 'started'
  /** Waiting for a global concurrency slot under maxConcurrent. */
  | 'queued'
  /** Actively executing in a conversation/worktree. */
  | 'running'
  /** Waiting for human approval inside the conversation. */
  | 'waiting_approval'
  /** Completed and waiting in the Review Queue. */
  | 'needs_review'
  /** Reviewed and promoted via Pull Request. */
  | 'approved'
  /** Reviewed and applied/merged into main checkout. */
  | 'merged'
  /** Reviewed and discarded (worktree + local automation branch removed). */
  | 'discarded'
  /** The conversation could not be opened or execution failed; `detail` says why. */
  | 'failed'
  /** Exceeded timeoutMs and was cancelled via interrupt(). */
  | 'timed_out'
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
  worktreePath?: string | null
  branchName?: string | null
  baseSha?: string | null
  finishedAt?: number | null
  summaryMd?: string | null
  filesChanged?: number
  additions?: number
  deletions?: number
  prUrl?: string | null
  errorCode?: string | null
  eventKey?: string | null
  tokenUsage?: ScheduleTokenUsage | null
  reviewStatus?: ScheduleReviewStatus
}

export interface SchedulesState {
  /** "Pause all": nothing runs while this is on. */
  paused: boolean
  /** Global concurrent execution cap (default 2). */
  maxConcurrent?: number
  /** Count of runs currently in `needs_review` (`review_status = 'pending'`). */
  reviewPendingCount?: number
  schedules: Schedule[]
}

export interface ReviewDiffFile {
  path: string
  additions: number
  deletions: number
  binary?: boolean
  status?: 'added' | 'modified' | 'deleted' | 'renamed'
}

export interface ReviewQueueItem {
  run: ScheduleRun
  scheduleName: string
  projectId: string
  rootPath: string
  provider: ThreadProvider
  access: ScheduleAccess
}

export interface ReviewQueueSummary {
  count: number
  items: ReviewQueueItem[]
}

export interface ReviewRunDiff {
  runId: string
  scheduleId: string
  scheduleName: string
  branchName: string | null
  worktreePath: string | null
  summaryMd: string | null
  filesChanged: number
  additions: number
  deletions: number
  files: ReviewDiffFile[]
  unifiedDiff: string
  prUrl: string | null
}

export interface ReviewActionResult {
  run: ScheduleRun
  prUrl?: string | null
  message?: string
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
  timeoutMs?: number
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
  /** The runs kept for each schedule's history (active / needs_review runs are preserved). */
  history: 30,
  /** Global concurrency cap default & ceiling. */
  defaultMaxConcurrent: 2,
  maxConcurrentLimit: 10,
  /** Per-run timeout bounds (default 20 minutes). */
  defaultTimeoutMs: 20 * 60_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 4 * 3_600_000,
  /** Event cooldown ceiling (24 hours). */
  maxCooldownMinutes: 1440,
  /** Branch filter string max length. */
  branchFilterLength: 120
} as const

/** A run later than this was not "on time": the app was closed or the computer asleep, and it counts as missed. */
export const SCHEDULE_LATE_MS = 2 * 60_000
const HOUR = 3_600_000
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const EVENT_TYPES = new Set<ScheduleEventType>(['ci-failed', 'pr-review-requested', 'manual-cli'])

export type ScheduleRefusal =
  | 'name'
  | 'prompt'
  | 'provider'
  | 'project'
  | 'access'
  | 'time'
  | 'days'
  | 'every'
  | 'past'
  | 'unconfirmedWrite'
  | 'rule'
  | 'cron'
  | 'event'
  | 'cooldown'
  | 'branchFilter'
  | 'timeout'
  | 'maxConcurrent'
  | 'worktree'
  | 'dirtyCheckout'
  | 'notReviewable'
  | 'prFailed'

export function triggerKindOf(rule: ScheduleRule): ScheduleTriggerKind {
  if (rule.kind === 'cron') return 'cron'
  if (rule.kind === 'event') return 'event'
  return 'time'
}

export function eventConfigOf(rule: ScheduleRule): ScheduleEventConfig | null {
  if (rule.kind !== 'event') return null
  return {
    eventType: rule.eventType,
    ...(typeof rule.cooldownMinutes === 'number' ? { cooldownMinutes: rule.cooldownMinutes } : {}),
    ...(typeof rule.branchFilter === 'string' && rule.branchFilter.trim() ? { branchFilter: rule.branchFilter.trim() } : {})
  }
}

/** Why what the person filled in cannot be saved, or null when it can. `now` decides whether a single time is past. */
export function scheduleRefusal(input: unknown, now: number): ScheduleRefusal | null {
  const value = (input ?? {}) as Partial<ScheduleInput>
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > SCHEDULE_LIMITS.nameLength) return 'name'
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > SCHEDULE_LIMITS.promptLength) return 'prompt'
  if (value.provider !== 'claude' && value.provider !== 'codex' && value.provider !== 'antigravity') return 'provider'
  if (typeof value.projectId !== 'string' || !value.projectId || typeof value.rootPath !== 'string' || !value.rootPath) return 'project'
  if (value.access !== 'read-only' && value.access !== 'workspace-write') return 'access'
  if (value.access === 'workspace-write' && value.confirmedWrite !== true) return 'unconfirmedWrite'
  if (value.timeoutMs !== undefined) {
    if (!Number.isInteger(value.timeoutMs) || value.timeoutMs < SCHEDULE_LIMITS.minTimeoutMs || value.timeoutMs > SCHEDULE_LIMITS.maxTimeoutMs) return 'timeout'
  }
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
  if (rule.kind === 'cron') {
    if (typeof rule.expression !== 'string' || !isValidCronExpression(rule.expression)) return 'cron'
    return null
  }
  if (rule.kind === 'event') {
    if (!EVENT_TYPES.has(rule.eventType)) return 'event'
    if (rule.cooldownMinutes !== undefined && (!Number.isInteger(rule.cooldownMinutes) || rule.cooldownMinutes < 0 || rule.cooldownMinutes > SCHEDULE_LIMITS.maxCooldownMinutes)) return 'cooldown'
    if (rule.branchFilter !== undefined && (typeof rule.branchFilter !== 'string' || rule.branchFilter.length > SCHEDULE_LIMITS.branchFilterLength)) return 'branchFilter'
    return null
  }
  return 'rule'
}

/**
 * The first time the rule is due strictly after `after`, or null when there is none (event trigger, or single time past).
 */
export function nextRun(rule: ScheduleRule, after: number): number | null {
  if (rule.kind === 'event') return null
  if (rule.kind === 'cron') return nextCronRun(rule.expression, after)
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

/** Computes the next `count` local execution times strictly after `after` (for UI preview). */
export function nextRuns(rule: ScheduleRule, after: number, count = 3): number[] {
  if (!Number.isInteger(count) || count <= 0) return []
  if (rule.kind === 'cron') return nextCronRuns(rule.expression, after, count)
  if (rule.kind === 'event') return []
  const results: number[] = []
  let cursor = after
  for (let i = 0; i < count; i++) {
    const next = nextRun(rule, cursor)
    if (next === null) break
    results.push(next)
    cursor = next
  }
  return results
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
