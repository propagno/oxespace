import { create } from 'zustand'

/**
 * The activity center's single source: what happened this session that a person may want to see
 * (a conversation waiting for a decision, an agent that finished, a job that failed, a quota or app
 * update), plus the live attention state the mode switch counts.
 *
 * It only records and navigates. Nothing here approves, answers or changes what it points at.
 */
export type ActivityKind = 'needs-you' | 'finished' | 'failed' | 'update' | 'quota'
export type ActivitySource = 'code' | 'thread' | 'background' | 'quota' | 'update' | 'mcp'

export type ActivityTarget =
  | { type: 'pane'; workspaceId: string; paneId: string }
  | { type: 'thread'; threadId: string; workspaceId?: string }
  | { type: 'background'; workspaceId: string; jobId: string }
  | { type: 'quota'; provider: 'claude' | 'codex' }
  | { type: 'update'; version: string }
  | { type: 'mcp'; serverId: string }

export interface ActivityItem {
  source: ActivitySource
  /** Stable per subject (a thread, a pane, a job), so a newer state replaces the older one. */
  id: string
  kind: ActivityKind
  target: ActivityTarget
  title: string
  detail?: string
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

export const ACTIVITY_LIMIT = 50

export type ActivityInput = Omit<ActivityItem, 'at' | 'read'> & { at?: number; read?: boolean }

interface ActivityState {
  /** Newest first, at most ACTIVITY_LIMIT. */
  items: ActivityItem[]
  live: Record<LiveScope, Record<string, LiveAttention>>
  /** Adds an entry, replacing the one for the same subject and moving it to the top. */
  record: (input: ActivityInput) => void
  /** Drops the subject's entry when it is of `kind` (by default, a request that no longer waits). */
  resolve: (source: ActivitySource, id: string, kind?: ActivityKind) => void
  markRead: (source: ActivitySource, id: string) => void
  markAllRead: () => void
  setLive: (scope: LiveScope, entries: Record<string, LiveAttention>) => void
  reset: () => void
}

const key = (item: Pick<ActivityItem, 'source' | 'id'>): string => `${item.source}:${item.id}`
const EMPTY_LIVE = (): ActivityState['live'] => ({ code: {}, thread: {} })

function sameEntries(a: Record<string, LiveAttention>, b: Record<string, LiveAttention>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(name => a[name] === b[name])
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  items: [],
  live: EMPTY_LIVE(),

  record: (input) => {
    const item: ActivityItem = { ...input, at: input.at ?? Date.now(), read: input.read ?? false }
    const id = key(item)
    set(state => ({ items: [item, ...state.items.filter(entry => key(entry) !== id)].slice(0, ACTIVITY_LIMIT) }))
  },

  resolve: (source, id, kind = 'needs-you') => {
    const items = get().items
    const next = items.filter(entry => !(entry.source === source && entry.id === id && entry.kind === kind))
    if (next.length !== items.length) set({ items: next })
  },

  markRead: (source, id) => {
    const items = get().items
    if (!items.some(entry => entry.source === source && entry.id === id && !entry.read)) return
    set({ items: items.map(entry => entry.source === source && entry.id === id ? { ...entry, read: true } : entry) })
  },

  markAllRead: () => {
    const items = get().items
    if (!items.some(entry => !entry.read)) return
    set({ items: items.map(entry => entry.read ? entry : { ...entry, read: true }) })
  },

  setLive: (scope, entries) => {
    const live = get().live
    if (sameEntries(live[scope], entries)) return
    set({ live: { ...live, [scope]: entries } })
  },

  reset: () => set({ items: [], live: EMPTY_LIVE() })
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

export type ActivityGroup = 'needs-you' | 'finished' | 'updates'

/** The three groups the activity center shows: waiting on a person, outcomes, and news about the app or quotas. */
export function activityGroup(kind: ActivityKind): ActivityGroup {
  if (kind === 'needs-you') return 'needs-you'
  if (kind === 'finished' || kind === 'failed') return 'finished'
  return 'updates'
}

// bisect only (F7.3): which fields change during a cold switch
useActivityStore.subscribe((next, prev) => { const w = window as unknown as { __stores?: Record<string, number> }; w.__stores ??= {}
  for (const key of Object.keys(next)) if ((next as Record<string, unknown>)[key] !== (prev as Record<string, unknown>)[key]) w.__stores['Activity.' + key] = (w.__stores['Activity.' + key] ?? 0) + 1 })
