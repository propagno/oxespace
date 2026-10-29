/**
 * The interface languages. English is the source catalog; Brazilian Portuguese
 * is a full translation of it (tests/i18n-catalog.test.ts keeps them aligned).
 * Catalogs live in shared/locales/<language>/<namespace>.json and are read by
 * both the renderer and the main process.
 */
export const LANGUAGES = ['en', 'pt-BR'] as const
export type Language = (typeof LANGUAGES)[number]
/** What the person chose in Settings: follow the operating system, or one language. */
export type LanguagePreference = 'system' | Language

/** Namespaces, one JSON file each. `main` is only loaded by the main process. */
export const NAMESPACES = ['common', 'code', 'thread', 'oxequery', 'settings', 'main'] as const
export type Namespace = (typeof NAMESPACES)[number]

/** Any Portuguese locale (pt, pt-BR, pt_PT…) opens in Brazilian Portuguese; everything else in English. */
export function resolveLanguage(locale: string | null | undefined): Language {
  return /^pt(?:[-_]|$)/i.test(locale?.trim() ?? '') ? 'pt-BR' : 'en'
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || (LANGUAGES as readonly unknown[]).includes(value)
}

/** The language to show for a preference, given the operating system's locale. */
export function languageFor(preference: LanguagePreference, systemLocale: string | null | undefined): Language {
  return preference === 'system' ? resolveLanguage(systemLocale) : preference
}
