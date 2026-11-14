/**
 * The title a conversation gets from its first message. The text may start with markup the
 * app or an agent wrapped around it (`<artifact-content-author>…</artifact-content-author>`),
 * which made the sidebar show a raw tag; the title is the first thing a person would read.
 */
/**
 * A sentence that says how to answer, or only greets, is not what the conversation is about: "Do not use any tool.",
 * "Don't edit files.", "Sem usar ferramentas.", "Hi!". The title is the first sentence after those, when there is one.
 */
const NOT_THE_SUBJECT = /^(?:(?:please[, ]+)?(?:do not|don't|dont|never|without)\b|no (?:tools?|edits?|changes?|need)\b|(?:por favor[, ]+)?(?:não|nao|nunca|sem)\b|(?:hi|hello|hey|oi|olá|ola|bom dia|boa tarde|boa noite|thanks|thank you|obrigad[oa])\b[\s,!.]*$)/i

export function deriveThreadTitle(text: string, limit = 56): string {
  const withoutBlocks = text.replace(/<([A-Za-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, ' ')
  const source = withoutBlocks.trim() ? withoutBlocks : text
  const stripped = source.replace(/<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>/g, ' ')
  const line = stripped.split(/\r?\n/).map(entry => entry.replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
  const sentences = line.split(/(?<=[.!?])\s/).filter(Boolean)
  const sentence = sentences.find(entry => !NOT_THE_SUBJECT.test(entry)) ?? sentences[0] ?? line
  if (sentence.length <= limit) return sentence
  // A heading, not the whole prompt: cut at a word, and say that it was cut. A single long word is cut where it is.
  const head = sentence.slice(0, limit - 1)
  const space = head.lastIndexOf(' ')
  const body = sentence[limit - 1] === ' ' || space <= limit / 2 ? head : head.slice(0, space)
  return `${body.replace(/[\s,;:.\-–—]+$/, '')}…`
}

/**
 * The English placeholders unnamed conversations were stored with: 'New thread' before 1.4, 'New conversation' in 1.4
 * builds before the empty title. Main stores an empty title now and the window shows its own localized placeholder;
 * old rows read as empty, with no migration. Only the exact literals: a real title that merely contains one ("New
 * thread pool") is kept.
 */
export const LEGACY_UNNAMED_THREAD_TITLES: ReadonlySet<string> = new Set(['New thread', 'New conversation'])

/** A title as it leaves the database: the legacy placeholder reads as empty. */
export function readThreadTitle(title: string | null | undefined): string {
  return title && LEGACY_UNNAMED_THREAD_TITLES.has(title) ? '' : title ?? ''
}

/** True for a conversation nobody named yet, which its first message names. */
export function isUnnamedThreadTitle(title: string | null | undefined): boolean {
  return readThreadTitle(title) === ''
}

/** A conversation parsed from its row, with the legacy placeholder read as empty. */
export function parseThreadRow<T extends { title: string }>(json: string): T {
  const thread = JSON.parse(json) as T
  if (thread && typeof thread === 'object' && LEGACY_UNNAMED_THREAD_TITLES.has(thread.title)) thread.title = ''
  return thread
}
