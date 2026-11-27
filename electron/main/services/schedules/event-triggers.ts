import { SCHEDULE_LIMITS, type Schedule, type ScheduleEventType, type ScheduleRun } from '../../../../shared/schedule'
import type { ScheduleStore } from './schedule-store'
import type { Scheduler } from './scheduler'

export interface AutomationEventPayload {
  eventType: ScheduleEventType
  eventKey: string
  projectId?: string
  rootPath?: string
  branch?: string
  title?: string
  url?: string
  detail?: string
}

export type EventTriggerRejectReason =
  | 'duplicate'
  | 'cooldown'
  | 'branch-mismatch'
  | 'paused'
  | 'disabled'
  | 'limit'
  | 'type-mismatch'
  | 'unknown'

export interface EventTriggerDispatchResult {
  scheduleId: string
  accepted: boolean
  reason?: EventTriggerRejectReason
  run?: ScheduleRun
}

export interface EventWorkflowRunItem {
  databaseId: number
  status: string
  conclusion: string | null
  branch: string | null
  displayTitle?: string | null
  url?: string | null
}

export interface EventPullRequestItem {
  number: number
  title: string
  headRefName: string | null
  headRefOid?: string | null
  updatedAt?: string | null
  url?: string | null
}

export interface EventPollProvider {
  listWorkflowRuns?: (rootPath: string) => Promise<EventWorkflowRunItem[]>
  listReviewRequestedPrs?: (rootPath: string) => Promise<EventPullRequestItem[]>
}

export interface EventTriggerDispatcherDeps {
  store: ScheduleStore
  scheduler: Scheduler
  provider?: EventPollProvider
  now?: () => number
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function matchesBranchFilter(branch: string | undefined, filter: string | undefined): boolean {
  const trimmed = filter?.trim()
  if (!trimmed) return true
  if (!branch) return false
  if (trimmed.endsWith('*')) {
    return branch.startsWith(trimmed.slice(0, -1))
  }
  return branch === trimmed
}

/**
 * Dispatches CI failure (`ci-failed`), PR review request (`pr-review-requested`), and manual CLI (`manual-cli`)
 * triggers with strict `(schedule_id, event_key)` deduplication, cooldown, branch filtering, and daily limits.
 * Never creates, edits, or elevates any schedule.
 */
export class EventTriggerDispatcher {
  private readonly now: () => number

  constructor(private readonly deps: EventTriggerDispatcherDeps) {
    this.now = deps.now ?? Date.now
  }

  async dispatch(event: AutomationEventPayload): Promise<EventTriggerDispatchResult[]> {
    const schedules = this.deps.store.list().filter((schedule) => {
      if (schedule.rule.kind !== 'event' || schedule.rule.eventType !== event.eventType) return false
      if (event.projectId && schedule.projectId !== event.projectId) return false
      if (event.rootPath && normalizePath(schedule.rootPath) !== normalizePath(event.rootPath)) return false
      return true
    })

    const results: EventTriggerDispatchResult[] = []
    for (const schedule of schedules) {
      results.push(await this.evaluateAndTrigger(schedule, event.eventKey, event.branch, event.detail ?? event.title ?? event.url))
    }
    return results
  }

  /**
   * Local CLI trigger seam (`oxe automation trigger <id>`). Strictly triggers an existing enabled automation;
   * never creates, modifies, or elevates permissions of any schedule.
   */
  async triggerManualCli(scheduleId: string, eventKey?: string, detail?: string): Promise<EventTriggerDispatchResult> {
    const schedule = this.deps.store.get(scheduleId)
    if (!schedule) return { scheduleId, accepted: false, reason: 'unknown' }
    if (!schedule.enabled) return { scheduleId, accepted: false, reason: 'disabled' }
    if (this.deps.store.paused()) return { scheduleId, accepted: false, reason: 'paused' }
    const effectiveKey = eventKey?.trim() || `manual-cli:${this.now()}`
    return this.evaluateAndTrigger(schedule, effectiveKey, undefined, detail)
  }

  /** Polls configured CI and PR providers once across all enabled event schedules. */
  async pollOnce(): Promise<EventTriggerDispatchResult[]> {
    if (this.deps.store.paused()) return []
    const enabledEvents = this.deps.store.list().filter((s) => s.enabled && s.rule.kind === 'event')
    if (enabledEvents.length === 0) return []

    const results: EventTriggerDispatchResult[] = []
    const ciRoots = new Set<string>()
    const prRoots = new Set<string>()

    for (const schedule of enabledEvents) {
      if (schedule.rule.kind !== 'event') continue
      if (schedule.rule.eventType === 'ci-failed') ciRoots.add(schedule.rootPath)
      if (schedule.rule.eventType === 'pr-review-requested') prRoots.add(schedule.rootPath)
    }

    if (this.deps.provider?.listWorkflowRuns) {
      for (const rootPath of ciRoots) {
        const runs = await this.deps.provider.listWorkflowRuns(rootPath).catch(() => [])
        for (const wfRun of runs) {
          if (wfRun.status !== 'completed') continue
          if (wfRun.conclusion !== 'failure' && wfRun.conclusion !== 'timed_out') continue
          const dispatched = await this.dispatch({
            eventType: 'ci-failed',
            eventKey: `ci-failed:${wfRun.databaseId}`,
            rootPath,
            branch: wfRun.branch ?? undefined,
            title: wfRun.displayTitle ?? undefined,
            url: wfRun.url ?? undefined
          })
          results.push(...dispatched)
        }
      }
    }

    if (this.deps.provider?.listReviewRequestedPrs) {
      for (const rootPath of prRoots) {
        const prs = await this.deps.provider.listReviewRequestedPrs(rootPath).catch(() => [])
        for (const pr of prs) {
          const dispatched = await this.dispatch({
            eventType: 'pr-review-requested',
            eventKey: `pr-review:${pr.number}:${pr.headRefOid ?? pr.updatedAt ?? 'open'}`,
            rootPath,
            branch: pr.headRefName ?? undefined,
            title: pr.title,
            url: pr.url ?? undefined
          })
          results.push(...dispatched)
        }
      }
    }

    return results
  }

  private async evaluateAndTrigger(
    schedule: Schedule,
    eventKey: string,
    branch: string | undefined,
    detail: string | undefined
  ): Promise<EventTriggerDispatchResult> {
    if (this.deps.store.paused()) return { scheduleId: schedule.id, accepted: false, reason: 'paused' }
    if (!schedule.enabled) return { scheduleId: schedule.id, accepted: false, reason: 'disabled' }

    const rule = schedule.rule
    if (rule.kind === 'event' && !matchesBranchFilter(branch, rule.branchFilter)) {
      return { scheduleId: schedule.id, accepted: false, reason: 'branch-mismatch' }
    }

    if (this.deps.store.hasEventKey(schedule.id, eventKey)) {
      return { scheduleId: schedule.id, accepted: false, reason: 'duplicate' }
    }

    const now = this.now()
    if (rule.kind === 'event' && rule.cooldownMinutes && rule.cooldownMinutes > 0) {
      const lastAt = this.deps.store.lastEventRunAt(schedule.id)
      if (lastAt !== null && now - lastAt < rule.cooldownMinutes * 60_000) {
        return { scheduleId: schedule.id, accepted: false, reason: 'cooldown' }
      }
    }

    if (this.deps.store.startedToday(schedule.id, now) >= SCHEDULE_LIMITS.runsPerDay) {
      this.deps.store.record({
        scheduleId: schedule.id,
        dueAt: now,
        at: now,
        outcome: 'skipped-limit',
        threadId: null,
        detail: detail ?? null,
        eventKey
      })
      return { scheduleId: schedule.id, accepted: false, reason: 'limit' }
    }

    const run = await this.deps.scheduler.triggerEventRun(schedule.id, { eventKey, detail, dueAt: now })
    return { scheduleId: schedule.id, accepted: true, run }
  }
}
