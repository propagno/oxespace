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

/**
 * The palette's categories (docs/design/commands.md): every label reads "<Category>: <Action>". The code names them in
 * English; product names (OxeChat, OxeQuery…) are shown as they are, the others through `commands.category.*`.
 */
export const COMMAND_CATEGORIES = ['Go to', 'View', 'Layout', 'Appearance', 'Workspace', 'Terminal', 'Git', 'Agents', 'Activity',
  'OxeChat', 'OxeQuery', 'OxePod', 'OxePost', 'Settings', 'Help'] as const
export type CommandCategory = typeof COMMAND_CATEGORIES[number]

const CATEGORY_KEYS: Record<string, string> = {
  General: 'general', 'Go to': 'goTo', View: 'view', Layout: 'layout', Appearance: 'appearance', Workspace: 'workspace', Terminal: 'terminal',
  Git: 'git', Agents: 'agents', Activity: 'activity', Settings: 'settings', Help: 'help'
}

/** A palette group's heading in the interface language. */
export function commandCategoryLabel(category: string): string {
  const key = CATEGORY_KEYS[category]
  return key ? tCommand(`category.${key}`) : category
}

/** What a command shows: its palette label, the bare action the application menus use, its group and its search words. */
export interface CommandText {
  category: CommandCategory
  label: string
  action: string
  keywords: string[]
}

/** The names a command had before, in the language on screen and in English, so a search for an old name still finds it. */
function formerNames(key: string, values?: Record<string, unknown>): string[] {
  const path = `commands.formerly.${key}`
  const names = new Set<string>()
  for (const lng of [i18n.language, 'en']) {
    if (!i18n.exists(path, { ns: 'common', lng, ...values })) continue
    const text: unknown = (i18n.t as unknown as (key: string, options: object) => unknown)(path, { ns: 'common', lng, ...values })
    // Before the translator starts there is no text yet; the source registers again on `languageChanged`.
    if (typeof text !== 'string') continue
    for (const name of text.split(' | ')) if (name.trim()) names.add(name.trim())
  }
  return [...names]
}

/**
 * Label, menu text and former names of one command, all from the `common` catalog: `commands.action.<key>` is the
 * action (the menus show it as it is), `commands.formerly.<key>` the old labels, " | " between them.
 */
export function commandText(category: CommandCategory, key: string, options: { values?: Record<string, unknown>; keywords?: string[] } = {}): CommandText {
  const action = tCommand(`action.${key}`, options.values)
  return { category, action, label: `${commandCategoryLabel(category)}: ${action}`, keywords: [...(options.keywords ?? []), ...formerNames(key, options.values)] }
}

/** Registers a static command source now and again whenever the interface language changes. */
export function registerTranslated(register: () => void): void {
  register()
  i18n.on('languageChanged', register)
}
