/**
 * S7.1 · The two timers of the agents read model (docs/design/s7-mission-control.md §5.10, §13, §14), as pure rules.
 *
 * - Needs-you nudge: a request waiting `needsYouMs` while no OXESpace window is focused raises one desktop notification
 *   per request (the phone gets the same as a push, from `nudgeAfterMs`). Requests due within `NUDGE_BATCH_MS` of each
 *   other go out as one ("3 agents need you").
 * - No report after Stop: a row with no new report from its source `noReportMs` after a Stop shows `unknown`, never
 *   "Stopping…" forever.
 *
 * e2e shortens both through `OXESPACE_E2E_AGENTS_NEEDS_YOU_MS` and `OXESPACE_E2E_AGENTS_NO_REPORT_MS`, as
 * `OXESPACE_E2E_APPROVALS_TTL_MS` does; any other build ignores them. No fake clock (it broke the workbench, F28).
 */
import type { AgentState } from './agentState'

export const AGENT_TIMER_DEFAULTS = {
  /** §5.10: the setting's default (off, 1, 2 or 5 min). */
  needsYouMs: 120_000,
  /** §13: the "no stuck rows" window after Stop. */
  noReportMs: 10_000
} as const

/** The person's choices for the needs-you nudge (Settings › Notifications); `null` is off. */
export const AGENT_NUDGE_CHOICES_MS = [null, 60_000, 120_000, 300_000] as const
export type AgentNudgeChoice = typeof AGENT_NUDGE_CHOICES_MS[number]
/** The default choice: 2 min. */
export const AGENT_NUDGE_DEFAULT_MS: AgentNudgeChoice = 120_000

/** One of the choices, or null when the value is not one (a stored value from elsewhere, a bad call). */
export function readNudgeChoice(value: unknown): { ok: true; afterMs: AgentNudgeChoice } | { ok: false } {
  return (AGENT_NUDGE_CHOICES_MS as readonly unknown[]).includes(value) ? { ok: true, afterMs: value as AgentNudgeChoice } : { ok: false }
}

/** Requests due this close together are one notification. */
export const NUDGE_BATCH_MS = 10_000

/** Shortest timer e2e may ask for, so a typo cannot spin main. */
export const AGENT_TIMER_MIN_E2E_MS = 50

export interface AgentTimers { needsYouMs: number; noReportMs: number }

function e2eValue(raw: string | undefined, fallback: number): number {
  if (raw === undefined || !/^[0-9]{1,9}$/.test(raw.trim())) return fallback
  const value = Number(raw.trim())
  return value >= AGENT_TIMER_MIN_E2E_MS && value <= fallback ? value : fallback
}

/**
 * The timers in force. `e2e` is true only for an unpackaged build started with `OXESPACE_E2E_MOCK_NATIVE=1`; otherwise
 * the variables are ignored. An e2e value may only shorten a timer, never lengthen it or set it below 50 ms.
 */
export function readAgentTimers(env: Readonly<Record<string, string | undefined>>, e2e: boolean): AgentTimers {
  if (!e2e) return { ...AGENT_TIMER_DEFAULTS }
  return {
    needsYouMs: e2eValue(env.OXESPACE_E2E_AGENTS_NEEDS_YOU_MS, AGENT_TIMER_DEFAULTS.needsYouMs),
    noReportMs: e2eValue(env.OXESPACE_E2E_AGENTS_NO_REPORT_MS, AGENT_TIMER_DEFAULTS.noReportMs)
  }
}

/** Whether a build honours the e2e variables: never a packaged one. */
export const agentTimersE2e = (env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): boolean =>
  !isPackaged && env.OXESPACE_E2E_MOCK_NATIVE === '1'

export interface WaitingRequest { key: string; requestId: string; since: number }

/**
 * The requests to notify now, as batches: each waited at least `needsYouMs`, none was notified before, and no window
 * is focused. A batch holds the requests due within `NUDGE_BATCH_MS` of the first. `nudgeAfterMs` null is off.
 */
export function dueNudges(waiting: readonly WaitingRequest[], notified: ReadonlySet<string>, input: { now: number; nudgeAfterMs: number | null; focused: boolean }): WaitingRequest[][] {
  if (input.nudgeAfterMs === null || input.focused) return []
  const due = waiting.filter(request => !notified.has(request.requestId) && input.now - request.since >= input.nudgeAfterMs!)
    .sort((a, b) => a.since - b.since)
  const batches: WaitingRequest[][] = []
  for (const request of due) {
    const last = batches.at(-1)
    if (last && request.since - last[0].since <= NUDGE_BATCH_MS) last.push(request)
    else batches.push([request])
  }
  return batches
}

/**
 * A row's state once a Stop was asked at `stopAt`: the source's own state when it reported since, else `unknown` once
 * `noReportMs` passed. Before that, the reported state stands (the window shows "Stopping…" over it).
 */
export function stateAfterStop(reported: AgentState, input: { stopAt: number; lastReportAt: number; now: number; noReportMs: number }): AgentState {
  if (input.lastReportAt > input.stopAt) return reported
  return input.now - input.stopAt >= input.noReportMs ? 'unknown' : reported
}
