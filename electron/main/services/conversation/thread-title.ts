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
  return title || 'New thread'
}
