/**
 * Thread composer drafts that survive an application restart.
 *
 * Drafts live in `localStorage`, next to the other renderer settings. They are bounded
 * (count and length) so a pasted log cannot grow the profile without limit, and blank
 * drafts are not stored. Writes are debounced: the composer updates the store on every
 * keystroke and persisting each one would rewrite the whole record that often.
 */
export const DRAFTS_STORAGE_KEY = 'oxe.thread-drafts'
export const MAX_STORED_DRAFTS = 50
export const MAX_DRAFT_LENGTH = 20_000

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Keeps only string drafts with content, newest last, within the bounds above. */
export function sanitizeDrafts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
    .map(([id, text]): [string, string] => [id, text.slice(0, MAX_DRAFT_LENGTH)])
  return Object.fromEntries(entries.slice(-MAX_STORED_DRAFTS))
}

function defaultStorage(): DraftStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function loadDrafts(storage: DraftStorage | null = defaultStorage()): Record<string, string> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(DRAFTS_STORAGE_KEY)
    return raw ? sanitizeDrafts(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export function saveDrafts(drafts: Record<string, string>, storage: DraftStorage | null = defaultStorage()): void {
  if (!storage) return
  try {
    const clean = sanitizeDrafts(drafts)
    if (Object.keys(clean).length === 0) storage.removeItem(DRAFTS_STORAGE_KEY)
    else storage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // A full or blocked profile must never break typing; the draft just stays in memory.
  }
}

/** Debounced writer. `flush` writes the latest value immediately (used when the window closes). */
export function createDraftWriter(delayMs = 400, storage: DraftStorage | null = defaultStorage()): {
  schedule(drafts: Record<string, string>): void
  flush(): void
} {
  let pending: Record<string, string> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer) { clearTimeout(timer); timer = null }
    if (pending) { saveDrafts(pending, storage); pending = null }
  }
  return {
    schedule(drafts) {
      pending = drafts
      if (!timer) timer = setTimeout(flush, delayMs)
    },
    flush
  }
}
