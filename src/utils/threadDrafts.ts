/**
 * Thread composer drafts that survive an application restart.
 *
 * Drafts live in `localStorage`, next to the other renderer settings, as plain text.
 * Because that text can hold anything the user pasted, they are kept only briefly: a
 * draft is deleted once it has gone `MAX_DRAFT_AGE_MS` without being edited. They are
 * also bounded (count and length) so a pasted log cannot grow the profile without
 * limit, and blank drafts are not stored.
 *
 * Writes are debounced: the composer updates the store on every keystroke and persisting
 * each one would rewrite the whole record that often.
 */
export const DRAFTS_STORAGE_KEY = 'oxe.thread-drafts'
export const MAX_STORED_DRAFTS = 50
export const MAX_DRAFT_LENGTH = 20_000
/** A draft not edited for this long is deleted when drafts are next loaded or saved. */
export const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface StoredDrafts {
  drafts: Record<string, string>
  /** When each draft was last edited, in epoch milliseconds. */
  stamps: Record<string, number>
}

const EMPTY: StoredDrafts = { drafts: {}, stamps: {} }

/** Keeps only string drafts with content, newest last, within the count and length bounds. */
export function sanitizeDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .map(([id, text]): [string, string] => [id, text.slice(0, MAX_DRAFT_LENGTH)])
  return Object.fromEntries(entries.slice(-MAX_STORED_DRAFTS))
}

/**
 * Reads the stored form, `{ id: { text, at } }`, and drops expired, blank and malformed
 * entries. A bare string (the first stored format) is kept and given `at = now`, so
 * nothing written before expiry existed is lost or deleted early. A timestamp in the
 * future (the clock was moved back) counts as now.
 */
export function parseStoredDrafts(value: unknown, now: number = Date.now()): StoredDrafts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { drafts: {}, stamps: {} }
  const kept: Array<[string, string, number]> = []
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    let text: string
    let at: number
    if (typeof entry === 'string') {
      text = entry
      at = now
    } else if (entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string') {
      text = (entry as { text: string }).text
      const stamp = (entry as { at?: unknown }).at
      at = typeof stamp === 'number' && Number.isFinite(stamp) ? Math.min(stamp, now) : now
    } else {
      continue
    }
    if (!text.trim() || now - at > MAX_DRAFT_AGE_MS) continue
    kept.push([id, text.slice(0, MAX_DRAFT_LENGTH), at])
  }
  // Oldest first, so the count limit drops the stalest drafts.
  const newest = kept.sort((a, b) => a[2] - b[2]).slice(-MAX_STORED_DRAFTS)
  return {
    drafts: Object.fromEntries(newest.map(([id, text]) => [id, text])),
    stamps: Object.fromEntries(newest.map(([id, , at]) => [id, at]))
  }
}

function defaultStorage(): DraftStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function loadStoredDrafts(storage: DraftStorage | null = defaultStorage(), now: number = Date.now()): StoredDrafts {
  if (!storage) return { drafts: {}, stamps: {} }
  try {
    const raw = storage.getItem(DRAFTS_STORAGE_KEY)
    return raw ? parseStoredDrafts(JSON.parse(raw), now) : { drafts: {}, stamps: {} }
  } catch {
    return { drafts: {}, stamps: {} }
  }
}

export function loadDrafts(storage: DraftStorage | null = defaultStorage(), now: number = Date.now()): Record<string, string> {
  return loadStoredDrafts(storage, now).drafts
}

/** Writes the drafts that are still within bounds and age. A draft without a stamp counts as edited `now`. */
export function saveDrafts(
  drafts: Record<string, string>,
  storage: DraftStorage | null = defaultStorage(),
  stamps: Record<string, number> = {},
  now: number = Date.now()
): void {
  if (!storage) return
  try {
    const candidate = Object.fromEntries(Object.entries(drafts).map(([id, text]) => [id, { text, at: stamps[id] ?? now }]))
    const clean = parseStoredDrafts(candidate, now)
    const ids = Object.keys(clean.drafts)
    if (ids.length === 0) storage.removeItem(DRAFTS_STORAGE_KEY)
    else storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(ids.map(id => [id, { text: clean.drafts[id], at: clean.stamps[id] }]))))
  } catch {
    // A full or blocked profile must never break typing; the draft just stays in memory.
  }
}

/**
 * Debounced writer. It stamps a draft when its text changes and leaves the others
 * alone, so an untouched draft ages even though the whole record is rewritten.
 * `flush` writes the latest value immediately (used when the window closes).
 */
export function createDraftWriter(
  delayMs = 400,
  storage: DraftStorage | null = defaultStorage(),
  initial: StoredDrafts = EMPTY,
  clock: () => number = Date.now
): { schedule(drafts: Record<string, string>): void; flush(): void } {
  const stamps: Record<string, number> = { ...initial.stamps }
  let last: Record<string, string> = { ...initial.drafts }
  let pending: Record<string, string> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    if (pending) { saveDrafts(pending, storage, stamps, clock()); pending = null }
  }
  return {
    schedule(drafts) {
      const now = clock()
      for (const [id, text] of Object.entries(drafts)) if (last[id] !== text) stamps[id] = now
      for (const id of Object.keys(stamps)) if (!(id in drafts)) delete stamps[id]
      last = { ...drafts }
      pending = drafts
      if (!timer) timer = setTimeout(flush, delayMs)
    },
    flush
  }
}
