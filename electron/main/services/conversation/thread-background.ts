import type { BackgroundJob } from '../../../../shared/types/background'
import type { ThreadEvent } from '../../../../shared/types/thread'

/** How long a running background shell may go without any signal before its state becomes unknown (T77). */
export const BACKGROUND_SIGNAL_TIMEOUT_MS = 120_000

export interface BackgroundJobEntry {
  job: BackgroundJob
  tail: string[]
  lastSignalAt?: number
  alive?: boolean
}

export interface BackgroundShellsInput {
  events: readonly ThreadEvent[]
  jobs: readonly BackgroundJobEntry[]
  live: boolean
  now?: number
}

export interface BackgroundShell {
  id: string
  command: string
  startedBy: 'agent' | 'oxespace'
  state: 'running' | 'stopped' | 'unknown'
  exitCode?: number | null
  since: number
  tail: string[]
  canStop: boolean
}

type SubagentEvent = Extract<ThreadEvent, { type: 'subagent' }>

const TAIL_LINES = 5

function lastLines(text: string | undefined): string[] {
  if (!text) return []
  const trimmed = text.replace(/\r?\n$/, '')
  if (!trimmed) return []
  return trimmed.split(/\r?\n/).slice(-TAIL_LINES)
}

/** Ordering timestamp for picking the newest subagent event per id; future timestamps clamp to `now`. */
function eventOrderTime(event: SubagentEvent, now: number): number {
  const raw = event.signalAt ?? event.completedAt ?? event.startedAt ?? now
  return Number.isFinite(raw) ? Math.min(raw, now) : now
}

/** Last trusted signal timestamp for timeout evaluation; a clock-jumped future `signalAt` falls back to past bounds or `now`. */
function effectiveEventSignalAt(event: SubagentEvent, now: number): number {
  if (typeof event.signalAt === 'number' && Number.isFinite(event.signalAt) && event.signalAt <= now) {
    return event.signalAt
  }
  if (typeof event.completedAt === 'number' && Number.isFinite(event.completedAt) && event.completedAt <= now) {
    return event.completedAt
  }
  if (typeof event.startedAt === 'number' && Number.isFinite(event.startedAt) && event.startedAt <= now) {
    return event.startedAt
  }
  return now
}

function effectiveJobSignalAt(entry: BackgroundJobEntry, now: number): number {
  const raw = entry.lastSignalAt ?? entry.job.startedAtMs
  if (Number.isFinite(raw) && raw <= now) return raw
  if (Number.isFinite(entry.job.startedAtMs) && entry.job.startedAtMs <= now) return entry.job.startedAtMs
  return now
}

function latestAgentCommands(events: readonly ThreadEvent[], now: number): SubagentEvent[] {
  const winners = new Map<string, { event: SubagentEvent; at: number }>()
  for (const event of events) {
    if (event.type !== 'subagent' || event.action !== 'Background command') continue
    const at = eventOrderTime(event, now)
    const current = winners.get(event.id)
    if (!current || at >= current.at) {
      winners.set(event.id, { event, at })
    }
  }
  return [...winners.values()].map(entry => entry.event)
}

function agentShell(event: SubagentEvent, live: boolean, now: number): BackgroundShell {
  const command = event.prompt ?? ''
  const tail = lastLines(event.agents[0]?.message)
  const clamp = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(now, value) : fallback

  if (event.state === 'completed' || event.state === 'failed' || event.state === 'interrupted') {
    const since = clamp(event.completedAt ?? event.startedAt, now)
    return { id: event.id, command, startedBy: 'agent', state: 'stopped', since, tail, canStop: false }
  }
  if (event.state === 'unknown') {
    const since = clamp(event.completedAt ?? event.startedAt, now)
    return { id: event.id, command, startedBy: 'agent', state: 'unknown', since, tail, canStop: false }
  }
  const lastSignal = effectiveEventSignalAt(event, now)
  if (!live || now - lastSignal > BACKGROUND_SIGNAL_TIMEOUT_MS) {
    return { id: event.id, command, startedBy: 'agent', state: 'unknown', since: lastSignal, tail, canStop: false }
  }
  const since = clamp(event.startedAt, lastSignal)
  return { id: event.id, command, startedBy: 'agent', state: 'running', since, tail, canStop: false }
}

function oxespaceJobShell(entry: BackgroundJobEntry, now: number): BackgroundShell {
  const { job } = entry
  const tail = entry.tail.slice(-TAIL_LINES)
  const clamp = (value: number | null | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(now, value) : fallback

  if (entry.alive === false) {
    const since = clamp(job.finishedAtMs ?? entry.lastSignalAt ?? job.startedAtMs, now)
    return { id: job.id, command: job.command, startedBy: 'oxespace', state: 'stopped', since, tail, canStop: false }
  }
  if (job.status === 'exited' || job.status === 'failed' || job.status === 'killed') {
    const since = clamp(job.finishedAtMs ?? entry.lastSignalAt ?? job.startedAtMs, now)
    return {
      id: job.id,
      command: job.command,
      startedBy: 'oxespace',
      state: 'stopped',
      ...(typeof job.exitCode === 'number' ? { exitCode: job.exitCode } : {}),
      since,
      tail,
      canStop: false
    }
  }
  const lastSignal = effectiveJobSignalAt(entry, now)
  if (now - lastSignal > BACKGROUND_SIGNAL_TIMEOUT_MS) {
    return { id: job.id, command: job.command, startedBy: 'oxespace', state: 'unknown', since: lastSignal, tail, canStop: true }
  }
  const since = clamp(job.startedAtMs, lastSignal)
  return { id: job.id, command: job.command, startedBy: 'oxespace', state: 'running', since, tail, canStop: true }
}

function sortRunningFirst(shells: BackgroundShell[]): BackgroundShell[] {
  return [...shells].sort((a, b) => {
    const aRun = a.state === 'running' ? 0 : 1
    const bRun = b.state === 'running' ? 0 : 1
    if (aRun !== bRun) return aRun - bRun
    return b.since - a.since
  })
}

export function backgroundShells(input: BackgroundShellsInput): BackgroundShell[] {
  const now = input.now ?? Date.now()
  const agentShells = sortRunningFirst(latestAgentCommands(input.events, now).map(event => agentShell(event, input.live, now)))
  const jobShells = input.jobs.map(entry => oxespaceJobShell(entry, now))
  if (agentShells.length === 0) return jobShells
  if (jobShells.length === 0) return agentShells
  return sortRunningFirst([...agentShells, ...jobShells])
}

function earliestRunningDeadline(input: BackgroundShellsInput): { now: number; deadline: number | null } {
  const now = input.now ?? Date.now()
  let earliest: number | null = null
  const consider = (lastSignal: number) => {
    if (now - lastSignal > BACKGROUND_SIGNAL_TIMEOUT_MS) return
    const deadline = lastSignal + BACKGROUND_SIGNAL_TIMEOUT_MS + 1
    if (earliest === null || deadline < earliest) earliest = deadline
  }
  if (input.live) {
    for (const event of latestAgentCommands(input.events, now)) {
      if (event.state === 'running') consider(effectiveEventSignalAt(event, now))
    }
  }
  for (const entry of input.jobs) {
    if (entry.alive === false) continue
    if (entry.job.status === 'pending' || entry.job.status === 'running') {
      consider(effectiveJobSignalAt(entry, now))
    }
  }
  return { now, deadline: earliest }
}

export function watchBackground(input: { source: () => BackgroundShellsInput; onChange: () => void }): (() => void) & { refresh(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const arm = () => {
    clear()
    if (stopped) return
    const { now, deadline } = earliestRunningDeadline(input.source())
    if (deadline === null) return
    const delay = Math.max(1, deadline - now)
    timer = setTimeout(() => {
      timer = null
      if (stopped) return
      input.onChange()
      arm()
    }, delay)
  }

  arm()

  const stop = (() => {
    stopped = true
    clear()
  }) as (() => void) & { refresh(): void }

  stop.refresh = () => {
    if (!stopped) arm()
  }

  return stop
}
