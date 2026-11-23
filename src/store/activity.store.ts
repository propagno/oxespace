import { create } from 'zustand'
import type { ActivityApi, ActivityEntry, ActivityRecent } from '../../shared/types/activity'

/**
 * The activity center's single source: what happened this session that a person may want to see
 * (a conversation waiting for a decision, an agent that finished, a job that failed, a quota or app
 * update), plus the live attention state the mode switch counts.
 *
 * It only records and navigates. Nothing here approves, answers or changes what it points at.
 */
export type ActivityKind = 'needs-you' | 'finished' | 'failed' | 'update' | 'quota'
export type ActivitySource = 'code' | 'thread' | 'background' | 'quota' | 'update' | 'mcp' | 'query'

export type ActivityTarget =
  | { type: 'pane'; workspaceId: string; paneId: string }
  | { type: 'thread'; threadId: string; workspaceId?: string }
  | { type: 'background'; workspaceId: string; jobId: string }
  | { type: 'quota'; provider: 'claude' | 'codex' }
  | { type: 'update'; version: string }
  | { type: 'mcp'; serverId: string }

export interface ActivityPlace {
  project: string
  mode: 'chat' | 'code' | 'query'
}

export type ActivityOutcome = 'allowed' | 'denied' | 'answered'

export interface ActivityItem {
  source: ActivitySource
  /** Stable per subject (a thread, a pane, a job), so a newer state replaces the older one. */
  id: string
  kind: ActivityKind
  target: ActivityTarget
  title: string
  detail?: string
  place?: ActivityPlace
  outcome?: ActivityOutcome
  at: number
  read: boolean
}

/** Live state of one pane or conversation, as the mode switch badge counts it. */
export type LiveAttention = 'needs-you' | 'failed' | 'working'
export type LiveScope = 'code' | 'thread'

export interface AttentionCounts {
  /** Waiting for a person: an approval, a question, or an agent that stopped for input. */
  needsYou: number
  failed: number
  /** Agents busy on their own; informational, never an alert. */
  working: number
}

export interface AttentionSummary {
  code: AttentionCounts
  thread: AttentionCounts
}

/** When a pane or conversation entered "needs you" (Date.now()), and a number that is new for every wait. */
export interface AttentionWait {
  since: number
  seq: number
}

export const ACTIVITY_LIMIT = 50

export type ActivityInput = Omit<ActivityItem, 'at' | 'read'> & { at?: number; read?: boolean }

interface ActivityState {
  /** Newest first, at most ACTIVITY_LIMIT. */
  items: ActivityItem[]
  live: Record<LiveScope, Record<string, LiveAttention>>
  /** The entries of `live` that need a person, with when each started waiting: leaving the state drops it, entering again is a new wait. */
  waiting: Record<LiveScope, Record<string, AttentionWait>>
  /** Adds an entry, replacing the one for the same subject and moving it to the top. */
  record: (input: ActivityInput) => void
  /** Drops the subject's entry when it is of `kind` (by default, a request that no longer waits), also one main has yet to hand back. */
  resolve: (source: ActivitySource, id: string, kind?: ActivityKind) => void
  markRead: (source: ActivitySource, id: string) => void
  markAllRead: () => void
  setLive: (scope: LiveScope, entries: Record<string, LiveAttention>) => void
  /** Reads main's stored entries once (newest first, read by lastSeenAt); an entry recorded this session wins. */
  hydrate: () => Promise<void>
  reset: () => void
}

const key = (item: Pick<ActivityItem, 'source' | 'id'>): string => `${item.source}:${item.id}`
const EMPTY_LIVE = (): ActivityState['live'] => ({ code: {}, thread: {} })
const EMPTY_WAITING = (): ActivityState['waiting'] => ({ code: {}, thread: {} })
/** Never reset: a wait keeps its number, so a new wait is told apart from an old one with the same subject. */
let waitSeq = 0

/** The sources main keeps (shared/types/activity.ts); an OxeQuery request stays in the window. */
const STORED_SOURCES: ReadonlySet<ActivitySource> = new Set<ActivitySource>(['code', 'thread', 'background', 'quota', 'update', 'mcp'])
/** hydrate() reads main once; reset() forgets it, and bumps the generation so a read that settles after it changes nothing. */
let hydration: 'idle' | 'reading' | 'restored' | 'failed' = 'idle'
let generation = 0
/** What the person did before main's list was restored; it wins over that list. */
const resolvedEarly = new Set<string>()
let allReadEarlyAt = -Infinity
/** An item was read while main's list was on its way: whether it was the last unread is known once the list is here. */
let readWhileReading = false

function activityApi(): ActivityApi | undefined {
  try { return typeof window === 'undefined' ? undefined : window.oxe?.activity } catch { return undefined }
}

/** Fire and forget: main keeping the list is a bonus, so a missing method or a refused call changes nothing here. */
function toMain(call: (api: ActivityApi) => Promise<unknown> | undefined): void {
  const api = activityApi()
  if (!api) return
  try { void call(api)?.catch(() => undefined) } catch { /* the window works without main */ }
}

const storedKey = (item: Pick<ActivityItem, 'source' | 'id' | 'kind'>): string => `${key(item)}:${item.kind}`

/** A request still waiting; one with an outcome is history. */
const waits = (item: ActivityItem): boolean => item.kind === 'needs-you' && !item.outcome

function resolveInMain(source: ActivitySource, id: string, kind: ActivityKind): void {
  if (STORED_SOURCES.has(source)) toMain(api => api.resolve?.({ source: source as ActivityEntry['source'], id, kind }))
}

function newestAt(items: ActivityItem[]): number {
  return items.reduce((max, entry) => Math.max(max, entry.at), -Infinity)
}

/** Main keeps one time, not a flag per entry, so it only hears of reading once nothing unread is left. */
function seenWhenAllRead(items: ActivityItem[]): void {
  if (items.length > 0 && items.every(entry => entry.read)) toMain(api => api.seen?.(newestAt(items)))
}

/** Only main's fields: never place, outcome or read. */
function toEntry(item: ActivityItem): ActivityEntry {
  const entry: ActivityEntry = { source: item.source as ActivityEntry['source'], id: item.id, kind: item.kind, target: item.target, title: item.title, at: item.at }
  if (item.detail) entry.detail = item.detail
  return entry
}

function fromStored(entry: ActivityEntry, seenAt: number): ActivityItem {
  const item: ActivityItem = { source: entry.source, id: entry.id, kind: entry.kind, target: entry.target, title: entry.title, at: entry.at, read: entry.at <= seenAt }
  if (entry.detail) item.detail = entry.detail
  return item
}

function sameEntries(a: Record<string, LiveAttention>, b: Record<string, LiveAttention>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(name => a[name] === b[name])
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  items: [],
  live: EMPTY_LIVE(),
  waiting: EMPTY_WAITING(),

  record: (input) => {
    const item: ActivityItem = { ...input, at: input.at ?? Date.now(), read: input.read ?? false }
    const id = key(item)
    const replaced = get().items.find(entry => key(entry) === id)
    set(state => ({ items: [item, ...state.items.filter(entry => key(entry) !== id)].slice(0, ACTIVITY_LIMIT) }))
    if (!STORED_SOURCES.has(item.source)) return
    // Main has no outcome: an answered request stored as needs-you would wait again after a reload.
    const answeredRequest = item.kind === 'needs-you' && !!item.outcome
    if (!answeredRequest) toMain(api => api.record?.([toEntry(item)]))
    if (item.outcome || (item.kind !== 'needs-you' && replaced?.kind === 'needs-you')) resolveInMain(item.source, item.id, 'needs-you')
  },

  resolve: (source, id, kind = 'needs-you') => {
    const items = get().items
    const next = items.filter(entry => !(entry.source === source && entry.id === id && entry.kind === kind))
    const dropped = next.length < items.length
    const early = hydration !== 'restored'
    if (!dropped && !early) return
    if (early) resolvedEarly.add(storedKey({ source, id, kind }))
    if (dropped) set({ items: next })
    resolveInMain(source, id, kind)
  },

  markRead: (source, id) => {
    const items = get().items
    if (!items.some(entry => entry.source === source && entry.id === id && !entry.read)) return
    const next = items.map(entry => entry.source === source && entry.id === id ? { ...entry, read: true } : entry)
    set({ items: next })
    if (hydration === 'reading') readWhileReading = true
    else seenWhenAllRead(next)
  },

  markAllRead: () => {
    const items = get().items
    const early = hydration !== 'restored'
    if (items.length === 0 && !early) return
    // Before the stored list is here its newest entry is unknown, so everything up to now is read.
    const seenAt = early ? Math.max(Date.now(), newestAt(items)) : newestAt(items)
    if (early) allReadEarlyAt = seenAt
    toMain(api => api.seen?.(seenAt))
    if (!items.some(entry => !entry.read)) return
    set({ items: items.map(entry => entry.read ? entry : { ...entry, read: true }) })
  },

  setLive: (scope, entries) => {
    const { live, waiting } = get()
    if (sameEntries(live[scope], entries)) return
    const before = waiting[scope]
    const next: Record<string, AttentionWait> = {}
    for (const [id, state] of Object.entries(entries)) {
      if (state !== 'needs-you') continue
      // Still waiting keeps its start; a new entry into the state is a new wait (OXE-128/Q-4).
      next[id] = live[scope][id] === 'needs-you' && before[id] ? before[id] : { since: Date.now(), seq: ++waitSeq }
    }
    set({ live: { ...live, [scope]: entries }, waiting: { ...waiting, [scope]: next } })
  },

  hydrate: async () => {
    if (hydration !== 'idle') return
    const api = activityApi()
    if (!api?.recent) {
      hydration = 'failed'
      return
    }
    hydration = 'reading'
    const started = generation
    let stored: ActivityRecent | undefined
    try { stored = await api.recent() } catch { /* a refused read restores nothing */ }
    if (started !== generation) return
    if (!stored || !Array.isArray(stored.entries)) {
      hydration = 'failed'
      if (readWhileReading) seenWhenAllRead(get().items)
      return
    }
    hydration = 'restored'
    const seenAt = Math.max(typeof stored.lastSeenAt === 'number' ? stored.lastSeenAt : -Infinity, allReadEarlyAt)
    const entries = stored.entries.filter(entry => !resolvedEarly.has(storedKey(entry)))
    set(state => {
      const known = new Set(state.items.map(key))
      const restored: ActivityItem[] = []
      for (const entry of entries) {
        const id = key(entry)
        if (known.has(id)) continue
        known.add(id)
        restored.push(fromStored(entry, seenAt))
      }
      return { items: [...state.items, ...restored].sort((a, b) => b.at - a.at).slice(0, ACTIVITY_LIMIT) }
    })
    const items = get().items
    // A subject that moved on before its stored request arrived could not resolve it when it was recorded.
    for (const entry of entries) {
      if (entry.kind !== 'needs-you') continue
      const current = items.find(item => key(item) === key(entry))
      if (current && !waits(current)) resolveInMain(entry.source, entry.id, entry.kind)
    }
    if (readWhileReading) seenWhenAllRead(items)
  },

  reset: () => {
    generation += 1
    hydration = 'idle'
    resolvedEarly.clear()
    allReadEarlyAt = -Infinity
    readWhileReading = false
    set({ items: [], live: EMPTY_LIVE(), waiting: EMPTY_WAITING() })
  }
}))

function count(entries: Record<string, LiveAttention>): AttentionCounts {
  const counts: AttentionCounts = { needsYou: 0, failed: 0, working: 0 }
  for (const state of Object.values(entries)) {
    if (state === 'needs-you') counts.needsYou += 1
    else if (state === 'failed') counts.failed += 1
    else counts.working += 1
  }
  return counts
}

/** The mode switch's counts, from the live state alone. */
export function summarizeAttention(live: ActivityState['live']): AttentionSummary {
  return { code: count(live.code), thread: count(live.thread) }
}

export function unreadActivityCount(items: ActivityItem[]): number {
  return items.reduce((total, item) => total + (item.read ? 0 : 1), 0)
}

export type ActivityGroup = 'needs-you' | 'failed' | 'finished' | 'updates'

/** The four groups the activity center shows: waiting on a person, failures, outcomes, and news about the app or quotas. */
export function activityGroup(kind: ActivityKind): ActivityGroup {
  if (kind === 'needs-you') return 'needs-you'
  if (kind === 'failed') return 'failed'
  if (kind === 'finished') return 'finished'
  return 'updates'
}
