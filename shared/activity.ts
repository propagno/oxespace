/**
 * F30 · The one validator and merge of the activity center's entries, pure, used by the main process and by the E2E mock.
 *
 * Anything that is not exactly a list of `ActivityEntry` is refused with a C3 code, and a refused call stores nothing:
 * one bad entry refuses the whole call. That includes an entry whose text looks like a credential (`redactSecrets`
 * would change it): it is refused, never stored redacted, and so are the other entries of that call, so a window that
 * leaks a secret into a title finds out at once instead of losing it silently. The only normalization is the one the
 * contract names: titles and details trimmed, and an empty detail dropped.
 */
import { hasHiddenCharacters } from './hidden-characters'
import { mainMessage, type MainMessage } from './messages'
import { redactSecrets } from './secrets'
import {
  ACTIVITY_KINDS, ACTIVITY_LIMITS as LIMITS, ACTIVITY_QUOTA_PROVIDERS, ACTIVITY_SOURCES,
  type ActivityEntry, type ActivityKind, type ActivityRefusal, type ActivityRefused, type ActivitySource, type ActivityTarget
} from './types/activity'

/** C0 and C1 control characters (tab and newline included: titles and details are one line). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const ENTRY_KEYS = new Set(['source', 'id', 'kind', 'target', 'title', 'detail', 'at'])

/** The target type each source opens, and the keys (required, optional) of each target. */
const TARGET_OF: Record<ActivitySource, ActivityTarget['type']> = { code: 'pane', thread: 'thread', background: 'background', quota: 'quota', update: 'update', mcp: 'mcp' }
const TARGET_KEYS: Record<ActivityTarget['type'], { required: readonly string[]; optional: readonly string[] }> = {
  pane: { required: ['workspaceId', 'paneId'], optional: [] },
  thread: { required: ['threadId'], optional: ['workspaceId'] },
  background: { required: ['workspaceId', 'jobId'], optional: [] },
  quota: { required: ['provider'], optional: [] },
  update: { required: ['version'], optional: [] },
  mcp: { required: ['serverId'], optional: [] }
}
/** `update` and `quota` are both a source and a kind, and only go together; the other sources report a person's subject. */
const KINDS_OF: Record<ActivitySource, readonly ActivityKind[]> = {
  code: ['needs-you', 'finished', 'failed'], thread: ['needs-you', 'finished', 'failed'], background: ['needs-you', 'finished', 'failed'],
  mcp: ['needs-you', 'finished', 'failed'], quota: ['quota'], update: ['update']
}

export function activityRefusal(refusal: ActivityRefusal): ActivityRefused {
  const message: MainMessage = refusal === 'tooMany' ? mainMessage('activity.tooMany', { max: LIMITS.perCall })
    : refusal === 'titleTooLong' ? mainMessage('activity.titleTooLong', { max: LIMITS.title })
      : refusal === 'detailTooLong' ? mainMessage('activity.detailTooLong', { max: LIMITS.detail })
        : mainMessage(`activity.${refusal}`, {})
  return { ok: false, refusal, message }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const looksSecret = (text: string): boolean => redactSecrets(text) !== text
const hidden = (text: string): boolean => CONTROL.test(text) || hasHiddenCharacters(text)
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value)

type Checked<T> = { ok: true; value: T } | { ok: false; refusal: ActivityRefusal }
const refuse = (refusal: ActivityRefusal): { ok: false; refusal: ActivityRefusal } => ({ ok: false, refusal })

/** An id as the window generates it: non-empty, not padded, at most 200 characters, no control, hidden or secret-looking text. */
function identifier(value: unknown): Checked<string> {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > LIMITS.id) return refuse('invalid')
  if (hidden(value)) return refuse('hiddenCharacters')
  if (looksSecret(value)) return refuse('secret')
  return { ok: true, value }
}

/** Shown text: trimmed, then at most `max` characters, one line, nothing hidden and nothing that looks like a credential. */
function text(value: unknown, max: number, tooLong: ActivityRefusal): Checked<string> {
  if (typeof value !== 'string') return refuse('invalid')
  // Checked before trimming: `trim` also strips U+FEFF and line breaks, which must refuse, not vanish.
  if (hidden(value)) return refuse('hiddenCharacters')
  const trimmed = value.trim()
  if ([...trimmed].length > max) return refuse(tooLong)
  if (looksSecret(trimmed)) return refuse('secret')
  return { ok: true, value: trimmed }
}

/** A time main can trust: an integer of epoch ms, not before 1970 and at most a minute ahead of `now`. */
function time(value: unknown, now: number): Checked<number> {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return refuse('invalid')
  if (value > now + LIMITS.futureMs) return refuse('future')
  return { ok: true, value }
}

function target(value: unknown, source: ActivitySource): Checked<ActivityTarget> {
  if (!plainObject(value) || value.type !== TARGET_OF[source]) return refuse('invalid')
  const { required, optional } = TARGET_KEYS[TARGET_OF[source]]
  const keys = Object.keys(value).filter(key => key !== 'type')
  if (keys.some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !(key in value))) return refuse('invalid')
  const out: Record<string, string> = { type: TARGET_OF[source] }
  for (const key of keys) {
    if (key === 'provider') {
      if (!oneOf(value.provider, ACTIVITY_QUOTA_PROVIDERS)) return refuse('invalid')
      out.provider = value.provider
      continue
    }
    if (value[key] === undefined && optional.includes(key)) continue
    const checked = identifier(value[key])
    if (!checked.ok) return checked
    out[key] = checked.value
  }
  return { ok: true, value: out as unknown as ActivityTarget }
}

function entry(value: unknown, now: number): Checked<ActivityEntry> {
  if (!plainObject(value) || Object.keys(value).some(key => !ENTRY_KEYS.has(key))) return refuse('invalid')
  const { source, kind } = value
  if (!oneOf(source, ACTIVITY_SOURCES) || !oneOf(kind, ACTIVITY_KINDS) || !KINDS_OF[source].includes(kind)) return refuse('invalid')
  const id = identifier(value.id)
  if (!id.ok) return id
  const where = target(value.target, source)
  if (!where.ok) return where
  const title = text(value.title, LIMITS.title, 'titleTooLong')
  if (!title.ok) return title
  if (!title.value) return refuse('invalid')
  let detail: string | undefined
  if (value.detail !== undefined) {
    const checked = text(value.detail, LIMITS.detail, 'detailTooLong')
    if (!checked.ok) return checked
    detail = checked.value || undefined
  }
  const at = time(value.at, now)
  if (!at.ok) return at
  return { ok: true, value: { source, id: id.value, kind, target: where.value, title: title.value, ...(detail === undefined ? {} : { detail }), at: at.value } }
}

/**
 * Checks one `activity:record` payload against main's clock `now`. The first rule broken, in payload order, is the
 * refusal of the whole call.
 */
export function normalizeActivityEntries(input: unknown, now: number): { ok: true; entries: ActivityEntry[] } | ActivityRefused {
  if (!Array.isArray(input)) return activityRefusal('invalid')
  if (input.length > LIMITS.perCall) return activityRefusal('tooMany')
  const entries: ActivityEntry[] = []
  for (const value of input) {
    const checked = entry(value, now)
    if (!checked.ok) return activityRefusal(checked.refusal)
    entries.push(checked.value)
  }
  return { ok: true, entries }
}

/** Checks one `activity:seen` time against main's clock `now`. */
export function normalizeActivitySeen(input: unknown, now: number): { ok: true; at: number } | ActivityRefused {
  const checked = time(input, now)
  return checked.ok ? { ok: true, at: checked.value } : activityRefusal(checked.refusal)
}

export const activityKey = (item: Pick<ActivityEntry, 'source' | 'id' | 'kind'>): string => JSON.stringify([item.source, item.id, item.kind])

/**
 * Merges checked entries into the stored list (newest first). An entry replaces the stored one of the same source, id
 * and kind unless that one is newer; within the call, a later entry wins a tie. The result is newest first by `at`,
 * the entries just recorded ahead of older ones on a tie, cut to `ACTIVITY_LIMITS.stored`.
 */
export function mergeActivityEntries(stored: readonly ActivityEntry[], incoming: readonly ActivityEntry[]): { entries: ActivityEntry[]; recorded: number; ignored: number } {
  const current = new Map(stored.map(item => [activityKey(item), item]))
  const winners = new Map<string, ActivityEntry>()
  for (const item of incoming) {
    const key = activityKey(item)
    const rival = winners.get(key) ?? current.get(key)
    if (rival && rival.at > item.at) continue
    // Re-inserted, so the map's order is the order of the last recording.
    winners.delete(key)
    winners.set(key, item)
  }
  // Later in the call first, so a stable sort puts the newest recording ahead on a tie.
  const fresh = [...winners.values()].reverse()
  const kept = stored.filter(item => !winners.has(activityKey(item)))
  const entries = [...fresh, ...kept].sort((a, b) => b.at - a.at).slice(0, LIMITS.stored)
  const recorded = entries.reduce((total, item) => total + (winners.get(activityKey(item)) === item ? 1 : 0), 0)
  return { entries, recorded, ignored: incoming.length - recorded }
}
