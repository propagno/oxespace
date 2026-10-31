/**
 * The title a conversation gets from its first message. The text may start with markup the
 * app or an agent wrapped around it (`<artifact-content-author>…</artifact-content-author>`),
 * which made the sidebar show a raw tag; the title is the first thing a person would read.
 */
export function deriveThreadTitle(text: string, limit = 80): string {
  const withoutBlocks = text.replace(/<([A-Za-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, ' ')
  const source = withoutBlocks.trim() ? withoutBlocks : text
  const stripped = source.replace(/<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>/g, ' ')
  const line = stripped.split(/\r?\n/).map(entry => entry.replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
  const sentence = line.split(/(?<=[.!?])\s/)[0] ?? line
  const title = (sentence.length > limit ? line : sentence).slice(0, limit).trim()
  return title
}

/**
 * The English placeholder unnamed conversations stored before 1.4. Main stores an empty title now and the window
 * shows its own localized placeholder; old rows read as empty, with no migration. Only the exact literal: a real
 * title that merely contains it ("New thread pool") is kept.
 */
export const LEGACY_UNNAMED_THREAD_TITLE = 'New thread'

/** A title as it leaves the database: the legacy placeholder reads as empty. */
export function readThreadTitle(title: string | null | undefined): string {
  return title === LEGACY_UNNAMED_THREAD_TITLE ? '' : title ?? ''
}

/** True for a conversation nobody named yet, which its first message names. */
export function isUnnamedThreadTitle(title: string | null | undefined): boolean {
  return readThreadTitle(title) === ''
}

/** A conversation parsed from its row, with the legacy placeholder read as empty. */
export function parseThreadRow<T extends { title: string }>(json: string): T {
  const thread = JSON.parse(json) as T
  if (thread && typeof thread === 'object' && thread.title === LEGACY_UNNAMED_THREAD_TITLE) thread.title = ''
  return thread
}
