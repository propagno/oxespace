/**
 * F30 · The activity center's entries, stored by the main process (UX-03).
 *
 * The window records what happened (a conversation waiting for a decision, an agent that finished, a job that failed,
 * a quota or app update) and reads back the newest ones, so the list survives a restart. Main keeps at most
 * `ACTIVITY_LIMITS.stored` entries, one per subject and kind, and the time the person last looked at the list.
 * Agents never read or write it (MCP capability `app.activity`, forbidden for 1.4).
 */
import type { MainMessage } from '../messages'

export const ACTIVITY_KINDS = ['needs-you', 'finished', 'failed', 'update', 'quota'] as const
export type ActivityKind = typeof ACTIVITY_KINDS[number]

export const ACTIVITY_SOURCES = ['code', 'thread', 'background', 'quota', 'update', 'mcp'] as const
export type ActivitySource = typeof ACTIVITY_SOURCES[number]

export const ACTIVITY_QUOTA_PROVIDERS = ['claude', 'codex'] as const

/** What an entry opens. Each source has its one target type (`code` opens a `pane`; the others share their name). */
export type ActivityTarget =
  | { type: 'pane'; workspaceId: string; paneId: string }
  | { type: 'thread'; threadId: string; workspaceId?: string }
  | { type: 'background'; workspaceId: string; jobId: string }
  | { type: 'quota'; provider: typeof ACTIVITY_QUOTA_PROVIDERS[number] }
  | { type: 'update'; version: string }
  | { type: 'mcp'; serverId: string }

export interface ActivityEntry {
  source: ActivitySource
  /** Stable per subject (a thread, a pane, a job): a newer entry of the same source, id and kind replaces the older. */
  id: string
  kind: ActivityKind
  target: ActivityTarget
  /** One line, trimmed, at most `ACTIVITY_LIMITS.title` characters. */
  title: string
  /** One line, trimmed, at most `ACTIVITY_LIMITS.detail` characters; absent when empty. */
  detail?: string
  /** When it happened (epoch ms, an integer); never more than `ACTIVITY_LIMITS.futureMs` ahead of main's clock. */
  at: number
}

/** What `activity:resolve` names: one entry, by the key a newer entry would replace it on. */
export type ActivityKey = Pick<ActivityEntry, 'source' | 'id' | 'kind'>

/** `activity:recent`: newest first (by `at`; on a tie, the one recorded last). */
export interface ActivityRecent {
  entries: ActivityEntry[]
  /** The newest time `activity:seen` stored, or null before the first. An entry is unread when its `at` is later. */
  lastSeenAt: number | null
}

/** Why a call was refused; each is also a message code (`activity.<reason>`, C3). A refused call stores nothing. */
export const ACTIVITY_REFUSALS = ['invalid', 'tooMany', 'titleTooLong', 'detailTooLong', 'hiddenCharacters', 'future', 'secret'] as const
export type ActivityRefusal = typeof ACTIVITY_REFUSALS[number]

export type ActivityRefused = { ok: false; refusal: ActivityRefusal; message: MainMessage }

/**
 * `activity:record`. `recorded` entries were stored; `ignored` ones were valid but not kept, because a newer entry of
 * the same subject and kind exists (stored, or later in the same call) or because they are older than the newest
 * `ACTIVITY_LIMITS.stored`.
 */
export type ActivityRecordResult = { ok: true; recorded: number; ignored: number } | ActivityRefused

/** `activity:resolve`. Idempotent: `removed` is false when no entry had that key. */
export type ActivityResolveResult = { ok: true; removed: boolean } | ActivityRefused

/** `activity:seen`. `lastSeenAt` is what is stored now: it never moves backwards, so an older time leaves it as it was. */
export type ActivitySeenResult = { ok: true; lastSeenAt: number } | ActivityRefused

export const ACTIVITY_LIMITS = {
  /** Entries kept by main, and entries one `activity:record` call may carry. */
  stored: 200,
  perCall: 200,
  /** Characters (code points) after trimming. */
  title: 200,
  detail: 500,
  /** Characters of an id (the entry's, or one in its target). */
  id: 200,
  /** How far ahead of main's clock an `at` may be. */
  futureMs: 60_000
} as const

/** `window.oxe.activity`; optional while the window may run against an older main. */
export interface ActivityApi {
  recent?(): Promise<ActivityRecent>
  record?(entries: ActivityEntry[]): Promise<ActivityRecordResult>
  seen?(at: number): Promise<ActivitySeenResult>
  /** Drops one entry (a request that no longer waits); exactly `{ source, id, kind }`. */
  resolve?(input: ActivityKey): Promise<ActivityResolveResult>
}
