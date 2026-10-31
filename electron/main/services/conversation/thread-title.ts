/** The title of a conversation before its first message names it. */
export const DEFAULT_THREAD_TITLE = 'New conversation'

/** Conversations created before 1.4 start with the old default, which still counts as no title yet. */
export function isDefaultThreadTitle(title: string): boolean {
  return title === DEFAULT_THREAD_TITLE || title === 'New thread'
}

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
  return title || DEFAULT_THREAD_TITLE
}
