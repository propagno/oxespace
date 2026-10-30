import { i18n } from '../i18n'

/**
 * Palette text in the interface language. Commands are rebuilt when the language changes: the static sources
 * re-register on `languageChanged`, and the hook sources (useCommandSource) re-render their host with it.
 */
export function tCommand(key: string, values?: Record<string, unknown>): string {
  // Commands can register before the translator has started, when t() gives back no text: never hand a caller
  // (`.split` on keywords) something that is not a string. They register again once the language is known.
  const text: unknown = (i18n.t as unknown as (key: string, options: object) => unknown)(`commands.${key}`, { ns: 'common', ...values })
  return typeof text === 'string' ? text : ''
}

/** Group headings the code writes in English; product names (OxeChat, OxeQuery…) are shown as they are. */
const CATEGORY_KEYS: Record<string, string> = {
  General: 'general', Workspace: 'workspace', Project: 'project', Development: 'development', 'AI & Agents': 'agents', System: 'system',
  View: 'view', Appearance: 'appearance', Layout: 'layout', Terminal: 'terminal', Settings: 'settings', Help: 'help'
}

/** A palette group's heading in the interface language. */
export function commandCategoryLabel(category: string): string {
  const key = CATEGORY_KEYS[category]
  return key ? tCommand(`category.${key}`) : category
}

/** Registers a static command source now and again whenever the interface language changes. */
export function registerTranslated(register: () => void): void {
  register()
  i18n.on('languageChanged', register)
}
