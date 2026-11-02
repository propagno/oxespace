import { i18n } from '../../i18n'

// Main stores no title until the first message names the conversation. Before that change it stored the English
// 'New thread', which existing conversations still carry, so both mean "not named yet".
const UNNAMED = new Set(['', 'New thread'])

/** What a conversation is called on screen: its title, or "New conversation" in the interface's language. */
export function displayThreadTitle(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim()
  return UNNAMED.has(trimmed) ? i18n.t('thread:dialogs.newTitle') : trimmed
}

/** The title as the person named it, or '' when it was never named (what a rename field starts from). */
export function namedThreadTitle(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim()
  return UNNAMED.has(trimmed) ? '' : trimmed
}
